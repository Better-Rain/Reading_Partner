import type { ReadingLink } from '../../shared/readingLinks'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { pdfjs } from 'react-pdf'
import {
  AIProviderRecord,
  AnnotationRecord,
  DocumentSearchResult,
  DocumentRecord,
  OpenPdfResult,
  OcrPageLayout,
  ProviderKeyStatus,
  DictionarySourceRecord,
  VocabularyRecord
} from '../../shared/types'
import { AnnotationRect, normalizeAnnotationRects } from './annotationGeometry'
import { AiPanel } from './components/AiPanel'
import {
  AnnotationInteractionMode,
  TemporarySearchHighlight
} from './components/AnnotationOverlay'
import { InspectorTabBar, type InspectorTab } from './components/InspectorTabBar'
import { LibraryBoard } from './components/LibraryBoard'
import { LibraryPanel } from './components/LibraryPanel'
import {
  AnnotationColorPreset,
  AnnotationFilterState,
  NotesPanel,
  defaultAnnotationFilters,
  formatTime,
  getAnnotationPreview,
  matchesAnnotationFilters
} from './components/NotesPanel'
import { SearchPanel } from './components/SearchPanel'
import { SelectionToolbar } from './components/SelectionToolbar'
import { ReaderSurface } from './components/ReaderSurface'
import { ReaderToolbar } from './components/ReaderToolbar'
import { SettingsPanel } from './components/SettingsPanel'
import { VocabularyPanel } from './components/VocabularyPanel'
import { WindowTitlebar } from './components/WindowTitlebar'
import { PanState, useReaderPan } from './hooks/useReaderPan'
import { useReaderShortcuts } from './hooks/useReaderShortcuts'
import {
  ActiveSearchTarget,
  useSearchHighlightLocator
} from './hooks/useSearchHighlightLocator'
import { useReaderViewportReset } from './hooks/useReaderViewportReset'
import { useDocumentTextIndex } from './hooks/useDocumentTextIndex'
import { useAnnotationUndo } from './hooks/useAnnotationUndo'
import { useAIOperations } from './hooks/useAIOperations'
import { useAIConversations } from './hooks/useAIConversations'
import { useVocabularyActions } from './hooks/useVocabularyActions'
import { useAnnotationActions } from './hooks/useAnnotationActions'
import { useAIRunActions } from './hooks/useAIRunActions'
import { readerNameKey, getStoredReaderName, toPdfBlobUrl } from './readerLocalState'

type PanelTab = InspectorTab
type SelectionState = {
  text: string
  x: number
  y: number
  rects: AnnotationRect[]
}

type PdfJsViewport = {
  width: number
  height: number
}

type PdfJsRenderTask = {
  promise: Promise<void>
}

type PdfJsPage = {
  cleanup: () => void
  getViewport: (options: { scale: number }) => PdfJsViewport
  render: (options: {
    canvasContext: CanvasRenderingContext2D
    viewport: PdfJsViewport
  }) => PdfJsRenderTask
}

type PdfJsDocument = {
  destroy: () => Promise<void>
  getPage: (pageNumber: number) => Promise<PdfJsPage>
  numPages: number
}

const minScale = 0.75
const maxScale = 3
const scaleStep = 0.12
const ocrRenderScale = 2

const annotationColorPresets: AnnotationColorPreset[] = [
  { label: '黄色', value: '#f8d86a' },
  { label: '绿色', value: '#9be38f' },
  { label: '蓝色', value: '#7db7ff' },
  { label: '粉色', value: '#ff9cc7' },
  { label: '紫色', value: '#c5a3ff' }
]

const clampScale = (value: number): number =>
  Math.min(maxScale, Math.max(minScale, Number(value.toFixed(2))))

const roundRectValue = (value: number): number => Number(value.toFixed(2))

const clampPageNumber = (value: number, pageLimit?: number | null): number => {
  const normalized = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  const limit =
    typeof pageLimit === 'number' && Number.isFinite(pageLimit) && pageLimit > 0
      ? Math.floor(pageLimit)
      : null

  return limit ? Math.min(normalized, limit) : normalized
}

const getInitialPageNumber = (document: DocumentRecord): number =>
  clampPageNumber(document.lastPageNumber, document.pageCount)

const useEventCallback = <T extends (...args: any[]) => unknown>(callback: T): T => {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  return useMemo(
    () =>
      ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    []
  )
}

function App(): JSX.Element {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const [vocabulary, setVocabulary] = useState<VocabularyRecord[]>([])
  const [dictionarySources, setDictionarySources] = useState<DictionarySourceRecord[]>([])
  const [providers, setProviders] = useState<AIProviderRecord[]>([])
  const [keyStatus, setKeyStatus] = useState<ProviderKeyStatus[]>([])
  const [activeTab, setActiveTab] = useState<PanelTab>('notes')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeSearchTarget, setActiveSearchTarget] = useState<ActiveSearchTarget | null>(null)
  const [temporarySearchHighlight, setTemporarySearchHighlight] =
    useState<TemporarySearchHighlight | null>(null)
  const [ocrPageLayout, setOcrPageLayout] = useState<OcrPageLayout | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(() => Math.min(1.08, window.innerWidth / 660))
  const [boardTools, setBoardTools] = useState<HTMLDivElement | null>(null)
  const [boardChatHost, setBoardChatHost] = useState<HTMLDivElement | null>(null)
  const [boardVisible, setBoardVisible] = useState(true)
  const [boardEntry, setBoardEntry] = useState<{ scope: string | null; chat: string } | null>(null)
  const [mobileTab, setMobileTab] = useState<'library' | 'reader' | 'tools'>('library')
  const [readingOrigin, setReadingOrigin] = useState<{ messageId: string; conversationId: string; documentId: string; notice: string | undefined } | null>(null)
  const [annotationFocus, setAnnotationFocus] = useState<AnnotationRecord | null>(null)
  const dismissAnnotationFocus = useEventCallback(() => setAnnotationFocus(null))
  useEffect(() => {
    if (annotationFocus && (annotationFocus.pageNumber !== pageNumber || annotationFocus.documentId !== activeDocument?.id)) {
      setAnnotationFocus(null)
    }
  }, [activeDocument?.id, annotationFocus, pageNumber])
  const [isPanMode, setIsPanMode] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(false)
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false)
  const [annotationInteractionMode, setAnnotationInteractionMode] =
    useState<AnnotationInteractionMode>('inspect')
  const [selectedAnnotationColor, setSelectedAnnotationColor] = useState(annotationColorPresets[0].value)
  const [draftNote, setDraftNote] = useState('')
  const [selectionNoteDraft, setSelectionNoteDraft] = useState('')
  const [isSelectionNoteEditorOpen, setIsSelectionNoteEditorOpen] = useState(false)
  const [qaQuestion, setQaQuestion] = useState('')
  const [readerName, setReaderName] = useState(getStoredReaderName)
  const [annotationFilters, setAnnotationFilters] =
    useState<AnnotationFilterState>(defaultAnnotationFilters)
  const [status, setStatus] = useState('打开一本 PDF 开始阅读')
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const readerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const suppressSelectionRef = useRef(false)
  const cancelOcrRef = useRef(false)
  const loadedPdfRef = useRef<{ documentId: string | null; pageCount: number } | null>(null)
  const { requestReaderViewportReset, resetReaderViewportAfterRender } =
    useReaderViewportReset(readerSurfaceRef)

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.pageNumber === pageNumber),
    [annotations, pageNumber]
  )
  const visibleCurrentPageAnnotations = useMemo(
    () => currentPageAnnotations.filter(annotation =>
      annotation.id === annotationFocus?.id || (annotationFilters.showOnPdf &&
        (!annotationFilters.syncToPdf || matchesAnnotationFilters(annotation, annotationFilters, pageNumber, {
          includePageScope: false, includeQuery: true
        })))
    ),
    [annotationFilters, annotationFocus, currentPageAnnotations, pageNumber]
  )
  const currentPageSearchHighlight = useMemo(
    () =>
      temporarySearchHighlight?.pageNumber === pageNumber
        ? temporarySearchHighlight
        : null,
    [pageNumber, temporarySearchHighlight]
  )
  const pdfFile = useMemo(() => {
    if (!pdfUrl) return null
    if (!pdfUrl.startsWith('/pdf/')) return { url: pdfUrl }
    return {
      url: new URL(pdfUrl, location.origin).href,
      httpHeaders: { 'X-RP-Session': document.querySelector<HTMLMetaElement>('meta[name="rp-session"]')?.content ?? '' },
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 256 * 1024
    }
  }, [pdfUrl])

  const configuredProviderIds = useMemo(
    () => new Set(keyStatus.filter((item) => item.configured).map((item) => item.providerId)),
    [keyStatus]
  )

  const readyProvider = useMemo(
    () => providers.find((provider) => provider.enabled && configuredProviderIds.has(provider.id)) ?? null,
    [configuredProviderIds, providers]
  )

  useEffect(() => {
    let mounted = true
    void window.readingPartner.listDocuments().then(async list => {
      if (!mounted) return
      setDocuments(list)
      await openAccountLink(list)
    }).catch(error => setStatus(String(error)))
    void refreshProviders()
    void refreshDictionarySources()
    if(location.protocol !== 'https:') return () => { mounted = false }
    const refresh = () => { if(!document.hidden) void refreshLibrary().catch(console.error) }
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    return () => {mounted = false;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  }, [])

  useEffect(() => {
    window.localStorage.setItem(readerNameKey(), readerName.trim() || '本机读者')
  }, [readerName])

  useReaderPan(panStateRef, readerSurfaceRef, suppressSelectionRef, setIsPanning)
  useSearchHighlightLocator({
    activeSearchTarget,
    pageNumber,
    readerSurfaceRef,
    scale,
    onHighlightChange: setTemporarySearchHighlight,
    onStatusChange: setStatus
  })

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  useEffect(() => {
    if (
      !activeDocument ||
      !Number.isFinite(pageNumber) ||
      pageNumber < 1 ||
      (pageCount > 0 && pageNumber > pageCount)
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      void window.readingPartner
        .saveDocumentProgress(activeDocument.id, pageNumber)
        .then((updated) => {
          setActiveDocument((current) => (current?.id === updated.id ? updated : current))
          setDocuments((items) =>
            items.map((item) => (item.id === updated.id ? updated : item))
          )
        })
        .catch((error) => {
          console.error('Failed to save reading progress', error)
        })
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [activeDocument?.id, pageCount, pageNumber])

  useEffect(() => {
    if (!activeDocument) {
      setOcrPageLayout(null)
      return
    }

    let cancelled = false
    void window.readingPartner
      .getDocumentPageOcrLayout(activeDocument.id, pageNumber)
      .then((layout) => {
        if (!cancelled) {
          setOcrPageLayout(layout)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOcrPageLayout(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeDocument?.id, pageNumber])

  const refreshLibrary = async (): Promise<void> => {
    const list = await window.readingPartner.listDocuments()
    setDocuments(list)
  }

  const refreshProviders = async (): Promise<void> => {
    const [providerList, statusList] = await Promise.all([
      window.readingPartner.listAIProviders(),
      window.readingPartner.listAIProviderKeyStatus()
    ])
    setProviders(providerList)
    setKeyStatus(statusList)
  }

  const refreshDictionarySources = async (): Promise<void> => {
    const sources = await window.readingPartner.listDictionarySources()
    setDictionarySources(sources)
  }

  const refreshAnnotations = async (documentId: string): Promise<AnnotationRecord[]> => {
    const list = await window.readingPartner.listAnnotations(documentId)
    setAnnotations(list)
    return list
  }

  const refreshVocabulary = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listVocabulary(documentId)
    setVocabulary(list)
  }

  const {
    textIndexRun,
    ensureDocumentTextIndex,
    cancelCurrentDocumentTextIndex
  } = useDocumentTextIndex({
    refreshLibrary,
    setActiveDocument,
    setStatus
  })
  const isTextIndexingActive = Boolean(textIndexRun && textIndexRun.documentId === activeDocument?.id)
  const {
    pushAnnotationUndo,
    resetAnnotationUndoStack,
    undoLastAnnotationAction
  } = useAnnotationUndo({
    setAnnotations,
    setStatus
  })
  const {
    aiOperations,
    createAIAssistedAnnotations,
    registerAIOperation,
    keepAIOperation,
    revertAIOperation,
    resetAIOperations
  } = useAIOperations({
    setAnnotations,
    setStatus
  })
  const {
    aiConversations,
    activeConversation,
    activeConversationId,
    isChatDrawerOpen,
    chatMessages,
    chatDraft,
    chatTitleDraft,
    setChatDraft,
    setChatTitleDraft,
    setIsChatDrawerOpen,
    refreshAIConversations,
    selectAIConversation,
    startNewAIConversation,
    createAIConversation,
    updateAIConversationTitle,
    refreshAIConversationAfterRun,
    appendOptimisticChatMessage
  } = useAIConversations({
    activeDocument,
    setActiveTab,
    setStatus
  })
  const {
    createVocabularyFromSelection,
    addDictionaryEntryToVocabulary,
    importDictionary,
    deleteVocabulary
  } = useVocabularyActions({
    activeDocument,
    pageNumber,
    readerName,
    selectedAnnotationColor,
    selectionRects: selection?.rects ?? [],
    selectionText: selection?.text ?? null,
    vocabulary,
    refreshDictionarySources,
    setAnnotations,
    setSelection,
    setStatus,
    setVocabulary
  })
  const {
    createAnnotation,
    deleteAnnotation,
    updateAnnotation,
    exportReadingMarks,
    importReadingMarks
  } = useAnnotationActions({
    activeDocument,
    annotations,
    pageNumber,
    readerName,
    selectedAnnotationColor,
    selectionText: selection?.text ?? null,
    selectionRects: selection?.rects ?? [],
    pushAnnotationUndo,
    refreshAnnotations,
    resetAnnotationUndoStack,
    setAnnotations,
    setDraftNote,
    setIsSelectionNoteEditorOpen,
    setSelectionNoteDraft,
    setStatus,
    setVocabulary,
    clearSelection: () => setSelection(null)
  })
  const {
    aiRun,
    askDocumentQuestion,
    cancelCurrentAIRun,
    defineVocabularyWithAI,
    resendChatMessage,
    runAIAction,
    sendChatMessage
  } = useAIRunActions({
    activeConversation,
    activeDocument,
    annotationColors: annotationColorPresets.map((preset) => preset.value),
    chatTitleDraft,
    pageCount,
    pageNumber,
    readyProvider,
    selectedAnnotationColor,
    selectionRects: selection?.rects ?? [],
    selectionText: selection?.text ?? null,
    appendOptimisticChatMessage,
    createAIAssistedAnnotations,
    createAIConversation,
    refreshAIConversationAfterRun,
    registerAIOperation,
    setActiveTab,
    setAnnotations,
    setChatDraft,
    setChatTitleDraft,
    setIsChatDrawerOpen,
    setSelection,
    setStatus,
    setVocabulary
  })

  const openAnnotation = (annotation: AnnotationRecord): void => {
    setTemporarySearchHighlight(null)
    setActiveSearchTarget(null)
    setBoardVisible(false)
    setMobileTab('reader')
    setAnnotationInteractionMode('inspect')
    setPageNumber(annotation.pageNumber)
    setAnnotationFocus({ ...annotation })
  }

  const openReadingLink = (target: ReadingLink, messageId: string): void => {
    if (!activeDocument || !activeConversationId) return
    const note = target.kind === 'note' ? annotations.find(item => item.id === target.id && item.documentId === activeDocument.id) : undefined
    const page = target.kind === 'page' ? target.page : note?.pageNumber
    const quote = target.kind === 'page' ? target.quote : note?.selectedText
    const validPage = page && page >= 1 && page <= pageCount ? page : null
    const notice = validPage ? undefined : target.kind === 'note' ? '这条批注已撤销或删除' : '此页码不在当前文档中'
    setReadingOrigin({ messageId, conversationId: activeConversationId, documentId: activeDocument.id, notice })
    if (note && validPage) {
      openAnnotation(note)
      return
    }
    setAnnotationFocus(null)
    setBoardVisible(false)
    setMobileTab('reader')
    setTemporarySearchHighlight(null)
    setActiveSearchTarget(null)
    if (!validPage) return
    setPageNumber(validPage)
    if (quote) {
      setActiveSearchTarget({ nonce: Date.now(), exactQuote: true, query: quote, result: {
        id: messageId, documentId: activeDocument.id, pageNumber: validPage, chunkIndex: 0, text: quote, snippet: quote, score: 0
      } })
    } else if (validPage !== pageNumber) requestReaderViewportReset()
    else readerSurfaceRef.current?.scrollTo({top: 0})
    setStatus(`已打开第 ${validPage} 页`)
  }

  const returnToChat = (): void => {
    if (!readingOrigin) return
    setIsInspectorCollapsed(false)
    setActiveTab('ai')
    setIsChatDrawerOpen(true)
    setMobileTab('tools')
    requestAnimationFrame(() => {
      const message = document.getElementById(`chat-${readingOrigin.messageId}`)
      message?.focus({ preventScroll: true })
      message?.scrollIntoView({ block: 'center' })
    })
    setReadingOrigin(null)
    setAnnotationFocus(null)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
  }

  const clearSearch = (): void => {
    setSearchQuery('')
    setSearchResults([])
    setIsSearching(false)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
  }

  const searchDocument = async (query = searchQuery): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = query.trim()

    if (!trimmed) {
      setSearchResults([])
      setActiveSearchTarget(null)
      setTemporarySearchHighlight(null)
      return
    }

    setSearchQuery(trimmed)
    setIsSearching(true)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
    setStatus(`正在搜索：${trimmed}`)

    try {
      const results = await window.readingPartner.searchDocumentText(activeDocument.id, trimmed)
      setSearchResults(results)
      setStatus(results.length > 0 ? `找到 ${results.length} 条结果` : `没有找到：${trimmed}`)
    } catch (error) {
      setStatus(`搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSearching(false)
    }
  }

  const loadDocument = async (document: DocumentRecord, targetPage?: number, entry?: URLSearchParams): Promise<void> => {
    if (location.protocol === 'https:' && !entry) {
      const latest = await window.readingPartner.listDocuments()
      setDocuments(latest)
      document = latest.find(item => item.id === document.id) ?? document
    }
    setStatus(`正在打开 ${document.title}`)
    setPdfError(null)
    loadedPdfRef.current = null
    const nextUrl = location.protocol === 'https:'
      ? `/pdf/${encodeURIComponent(document.id)}`
      : toPdfBlobUrl(await window.readingPartner.readPdf(document.id))
    const initialPageNumber = clampPageNumber(targetPage ?? document.lastPageNumber, document.pageCount)
    setActiveDocument(document)
    requestReaderViewportReset()
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setBoardVisible(false)
    setMobileTab('reader')
    setPageNumber(initialPageNumber)
    setSelection(null)
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
    resetAnnotationUndoStack()
    resetAIOperations()
    clearSearch()
    setQaQuestion('')
    setChatDraft('')
    setChatTitleDraft('')
    setIsChatDrawerOpen(false)
    const [notes, , conversations] = await Promise.all([
      refreshAnnotations(document.id),
      refreshVocabulary(document.id),
      refreshAIConversations(document.id)
    ])
    setStatus(`已打开 ${document.title}`)
    if (entry?.has('note')) {
      const note = notes.find(item => item.id === entry.get('note'))
      if (note) openAnnotation(note)
      else setStatus('这条批注已删除，已打开原页')
    } else if (entry?.has('chat')) {
      const chat = conversations.find(item => item.id === entry.get('chat'))
      if (chat) {
        await selectAIConversation(chat.id)
        showCompanion()
      } else setStatus('找不到这段共读对话')
    }
  }

  const showCompanion = () => {
    setActiveTab('ai')
    setIsInspectorCollapsed(false)
    setMobileTab('tools')
  }

  const openAccountLink = useEventCallback(async (list: DocumentRecord[]) => {
    const entry = new URLSearchParams(location.search)
    if (!entry.has('book') && !entry.has('board')) return
    history.replaceState(history.state, '', location.pathname)
    if (entry.has('book')) {
      const book = list.find(item => item.id === entry.get('book'))
      if (!book) { setStatus('这本书已不在书库中'); return }
      const page = Number(entry.get('page'))
      await loadDocument(book, Number.isSafeInteger(page) && page > 0 ? page : undefined, entry)
    } else {
      const scope = entry.get('board') || null
      const chat = entry.get('chat')
      if (chat && (await window.readingPartner.listBoardConversations(scope)).some(item => item.id === chat)) {
        setBoardEntry({ scope, chat })
        showCompanion()
      } else setStatus('找不到这段书库共读对话')
    }
  })

  const openPdf = async (): Promise<void> => {
    const result: OpenPdfResult | null = await window.readingPartner.openPdfDialog()

    if (!result) {
      return
    }

    const nextUrl = toPdfBlobUrl(result.data)
    setPdfError(null)
    loadedPdfRef.current = null
    const initialPageNumber = getInitialPageNumber(result.document)
    setActiveDocument(result.document)
    requestReaderViewportReset()
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setBoardVisible(false)
    setMobileTab('reader')
    setPageNumber(initialPageNumber)
    setSelection(null)
    resetAnnotationUndoStack()
    resetAIOperations()
    clearSearch()
    setQaQuestion('')
    setChatDraft('')
    await Promise.all([
      refreshLibrary(),
      refreshAnnotations(result.document.id),
      refreshVocabulary(result.document.id),
      refreshAIConversations(result.document.id)
    ])
    setStatus(`已导入 ${result.document.title}`)
  }

  const loadOcrPdfDocument = async (): Promise<PdfJsDocument> => {
    if (!pdfFile) {
      throw new Error('PDF 尚未加载')
    }

    const task = pdfjs.getDocument(pdfFile) as { promise: Promise<PdfJsDocument> }
    return task.promise
  }

  const renderOcrPageImage = async (
    pdfDocument: PdfJsDocument,
    targetPageNumber: number
  ): Promise<string> => {
    const page = await pdfDocument.getPage(targetPageNumber)
    const viewport = page.getViewport({ scale: ocrRenderScale })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      page.cleanup()
      throw new Error('无法创建 OCR 渲染画布')
    }

    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))

    try {
      await page.render({
        canvasContext: context,
        viewport
      }).promise

      return canvas.toDataURL('image/png')
    } finally {
      canvas.width = 1
      canvas.height = 1
      page.cleanup()
    }
  }

  const runOcrForRenderedPage = async (
    pdfDocument: PdfJsDocument,
    targetPageNumber: number
  ) => {
    if (!activeDocument) {
      throw new Error('请先打开 PDF')
    }

    return window.readingPartner.ocrPageText({
      documentId: activeDocument.id,
      imageScale: ocrRenderScale,
      pageNumber: targetPageNumber,
      imageDataUrl: await renderOcrPageImage(pdfDocument, targetPageNumber)
    })
  }

  const finishOcrRun = async (): Promise<void> => {
    await refreshLibrary()
    if (!activeDocument) {
      return
    }

    const updated = await window.readingPartner.getDocumentTextIndexStatus(activeDocument.id)
    setActiveDocument((current) =>
      current?.id === activeDocument.id
        ? { ...current, pageCount: updated.pageCount ?? current.pageCount }
        : current
    )
  }

  const runCurrentPageOcr = async (): Promise<void> => {
    if (!activeDocument) {
      setStatus('请先打开 PDF')
      return
    }

    if (textIndexRun?.documentId === activeDocument.id) {
      setStatus('请等待当前文本索引任务完成后再 OCR')
      return
    }

    let pdfDocument: PdfJsDocument | null = null
    try {
      setIsOcrRunning(true)
      cancelOcrRef.current = false
      setStatus(`正在 OCR 第 ${pageNumber} 页...`)
      pdfDocument = await loadOcrPdfDocument()
      const result = await runOcrForRenderedPage(pdfDocument, pageNumber)

      await finishOcrRun()
      setOcrPageLayout(result.layout)
      setStatus(
        `OCR 完成：第 ${result.pageNumber} 页，${result.charCount} 字 / ${result.pageChunkCount} 个片段`
      )
    } catch (error) {
      setStatus(`OCR 失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await pdfDocument?.destroy().catch(() => undefined)
      setIsOcrRunning(false)
    }
  }

  const runDocumentOcr = async (): Promise<void> => {
    if (!activeDocument) {
      setStatus('请先打开 PDF')
      return
    }

    if (textIndexRun?.documentId === activeDocument.id) {
      setStatus('请等待当前文本索引任务完成后再 OCR')
      return
    }

    let pdfDocument: PdfJsDocument | null = null
    let completed = 0

    try {
      setIsOcrRunning(true)
      cancelOcrRef.current = false
      pdfDocument = await loadOcrPdfDocument()
      const totalPages = pdfDocument.numPages || pageCount || activeDocument.pageCount || 1

      for (let nextPageNumber = 1; nextPageNumber <= totalPages; nextPageNumber += 1) {
        if (cancelOcrRef.current) {
          break
        }

        setStatus(`全文 OCR：${nextPageNumber} / ${totalPages} 页...`)
        const result = await runOcrForRenderedPage(pdfDocument, nextPageNumber)
        if (nextPageNumber === pageNumber) {
          setOcrPageLayout(result.layout)
        }
        completed += 1
        setStatus(
          `全文 OCR：${nextPageNumber} / ${totalPages} 页，已写入 ${result.charCount} 字`
        )
      }

      await finishOcrRun()
      setStatus(
        cancelOcrRef.current
          ? `已取消全文 OCR，已完成 ${completed} 页`
          : `全文 OCR 完成：${completed} 页`
      )
    } catch (error) {
      setStatus(`全文 OCR 失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await pdfDocument?.destroy().catch(() => undefined)
      cancelOcrRef.current = false
      setIsOcrRunning(false)
    }
  }

  const cancelOcr = (): void => {
    if (!isOcrRunning) {
      return
    }

    cancelOcrRef.current = true
    setStatus('正在取消 OCR，当前页结束后停止...')
  }

  const captureSelection = (): void => {
    const selected = window.getSelection()
    const text = selected?.toString().trim()

    if (!text || text.length < 2 || !activeDocument) {
      const textLayer = readerSurfaceRef.current?.querySelector<HTMLElement>(
        '.react-pdf__Page__textContent'
      )

      if (activeDocument && textLayer && (textLayer.textContent?.trim().length ?? 0) === 0) {
        setStatus('当前页没有可选文字层；这通常是扫描图片版 PDF，需要 OCR 后才能划词。')
      }
      setSelection(null)
      setSelectionNoteDraft('')
      setIsSelectionNoteEditorOpen(false)
      return
    }

    const range = selected?.rangeCount ? selected.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    const pageElement = readerSurfaceRef.current?.querySelector<HTMLElement>('.react-pdf__Page')
    const pageRect = pageElement?.getBoundingClientRect()
    const capturedRects =
      range && pageRect
        ? Array.from(range.getClientRects())
            .map((item) => {
              const left = Math.max(item.left, pageRect.left)
              const top = Math.max(item.top, pageRect.top)
              const right = Math.min(item.right, pageRect.right)
              const bottom = Math.min(item.bottom, pageRect.bottom)
              const width = right - left
              const height = bottom - top

              if (width <= 1 || height <= 1) {
                return null
              }

              return {
                left: roundRectValue((left - pageRect.left) / scale),
                top: roundRectValue((top - pageRect.top) / scale),
                width: roundRectValue(width / scale),
                height: roundRectValue(height / scale)
              }
            })
            .filter((item): item is AnnotationRect => Boolean(item))
        : []
    const rects = normalizeAnnotationRects(capturedRects)

    setSelection({
      text,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? Math.max(96, rect.top - 12) : 120,
      rects
    })
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
  }

  useReaderShortcuts({
    enabled: !boardVisible,
    hasDocument: Boolean(activeDocument),
    hasSelection: Boolean(selection),
    onCreateHighlight: () => void createAnnotation('highlight'),
    onOpenNoteEditor: () => setIsSelectionNoteEditorOpen(true),
    onTogglePanMode: () => setIsPanMode((value) => !value),
    onUndoAnnotation: () => void undoLastAnnotationAction()
  })

  const zoomBy = (delta: number): void => {
    setScale((value) => clampScale(value + delta))
  }

  const handleReaderWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey || !activeDocument) {
      return
    }

    event.preventDefault()
    zoomBy(event.deltaY < 0 ? scaleStep : -scaleStep)
  }

  const stopReaderPan = (): void => {
    panStateRef.current = null
    setIsPanning(false)
  }

  const handleReaderMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!activeDocument) {
      return
    }

    const shouldPan = event.button === 1 || (isPanMode && event.button === 0)

    if (!shouldPan) {
      return
    }

    event.preventDefault()
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop
    }
    suppressSelectionRef.current = true
    setSelection(null)
    setIsPanning(true)
  }

  const updateProvider = async (provider: AIProviderRecord, enabled: boolean): Promise<void> => {
    const updated = await window.readingPartner.upsertAIProvider({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKeyRef: provider.apiKeyRef,
      supportsThinking: provider.supportsThinking,
      supportsLongContext: provider.supportsLongContext,
      enabled
    })

    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
  }

  const updateProviderModel = async (
    provider: AIProviderRecord,
    defaultModel: string
  ): Promise<void> => {
    const normalizedModel = defaultModel.trim()

    if (!normalizedModel) {
      return
    }

    const updated = await window.readingPartner.upsertAIProvider({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      defaultModel: normalizedModel,
      apiKeyRef: provider.apiKeyRef,
      supportsThinking: provider.supportsThinking,
      supportsLongContext: provider.supportsLongContext,
      enabled: provider.enabled
    })

    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    setStatus(`已将 ${provider.label} 模型改为 ${updated.defaultModel}`)
  }

  const saveProviderKey = async (providerId: string, apiKey: string): Promise<void> => {
    const updated = await window.readingPartner.setAIProviderApiKey(providerId, apiKey)
    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    await refreshProviders()
    setStatus('API Key 已加密保存')
  }

  const clearProviderKey = async (providerId: string): Promise<void> => {
    const updated = await window.readingPartner.clearAIProviderApiKey(providerId)
    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    await refreshProviders()
    setStatus('API Key 已清除')
  }

  const toggleWindowMaximize = async (): Promise<void> => {
    const maximized = await window.readingPartner.toggleMaximizeWindow()
    setIsWindowMaximized(maximized)
  }

  const handleLibraryLoadDocument = useEventCallback((document: DocumentRecord) => {
    void loadDocument(document).catch(error => { setStatus(String(error)); window.alert(String(error)) })
  })
  const handleOpenPdf = useEventCallback(() => {
    void openPdf().catch(error => { setStatus(String(error)); window.alert(String(error)) })
  })
  const handleToggleLibraryCollapsed = useEventCallback(() => {
    setIsLibraryCollapsed((value) => !value)
  })
  const handleAnnotationInteractionModeChange = useEventCallback(
    (mode: AnnotationInteractionMode) => {
      setAnnotationInteractionMode(mode)
    }
  )
  const handleColorChange = useEventCallback((color: string) => {
    setSelectedAnnotationColor(color)
  })
  const handleCancelTextIndex = useEventCallback(() => {
    void cancelCurrentDocumentTextIndex()
  })
  const handleCancelOcr = useEventCallback(() => {
    cancelOcr()
  })
  const handleRunDocumentOcr = useEventCallback(() => {
    void runDocumentOcr()
  })
  const handleRunCurrentPageOcr = useEventCallback(() => {
    void runCurrentPageOcr()
  })
  const handleNextPage = useEventCallback(() => {
    requestReaderViewportReset()
    setPageNumber((value) => Math.min(pageCount, value + 1))
  })
  const handlePageNumberChange = useEventCallback((nextPageNumber: number) => {
    requestReaderViewportReset()
    setPageNumber(nextPageNumber)
  })
  const handlePreviousPage = useEventCallback(() => {
    requestReaderViewportReset()
    setPageNumber((value) => Math.max(1, value - 1))
  })
  const handleTogglePanMode = useEventCallback(() => {
    setIsPanMode((value) => !value)
  })
  const handleZoomIn = useEventCallback(() => {
    zoomBy(scaleStep)
  })
  const handleZoomOut = useEventCallback(() => {
    zoomBy(-scaleStep)
  })
  const handleCaptureSelection = useEventCallback(() => {
    if (!suppressSelectionRef.current) {
      captureSelection()
    }
  })

  return (
    <div className="app-shell" data-mobile-tab={mobileTab}>
      <nav className="mobile-nav" aria-label="阅读分区">{([['library','书库'],['reader','阅读'],['tools','笔记与工具']] as const).map(([tab,label]) =>
        <button key={tab} aria-pressed={mobileTab===tab} onClick={() => {setMobileTab(tab); if(tab==='library'){setIsLibraryCollapsed(false); void refreshLibrary()} if(tab==='tools')setIsInspectorCollapsed(false)}}>{label}</button>)}</nav>
      <WindowTitlebar
        isMaximized={isWindowMaximized}
        onClose={() => void window.readingPartner.closeWindow()}
        onMinimize={() => void window.readingPartner.minimizeWindow()}
        onToggleMaximize={() => void toggleWindowMaximize()}
      />
      <div
        className={[
          'app-layout',
          isLibraryCollapsed ? 'is-library-collapsed' : '',
          isInspectorCollapsed ? 'is-inspector-collapsed' : ''
        ]
          .filter(Boolean)
          .join(' ')}
      >
      <LibraryPanel
        onOverview={() => { setBoardVisible(true); setMobileTab('reader'); void refreshLibrary() }}
        activeDocumentId={activeDocument?.id ?? null}
        currentPageAnnotationCount={currentPageAnnotations.length}
        documents={documents}
        isCollapsed={isLibraryCollapsed}
        pageNumber={pageNumber}
        onLoadDocument={handleLibraryLoadDocument}
        onOpenPdf={handleOpenPdf}
        onToggleCollapsed={handleToggleLibraryCollapsed}
      />

      <main className="reader-column" id="reader" data-overview={boardVisible}>

        {readingOrigin && readingOrigin.documentId === activeDocument?.id && readingOrigin.conversationId === activeConversationId && isChatDrawerOpen && activeTab === 'ai' && (
          <section className="reading-origin" aria-label="聊天引用">
            <button className="text-button" onClick={returnToChat}>返回对话</button>
            {readingOrigin.notice && <span role="status">{readingOrigin.notice}</span>}
          </section>
        )}
        <ReaderToolbar
          boardToolsRef={boardVisible ? setBoardTools : null}
          annotationInteractionMode={annotationInteractionMode}
          colorPresets={annotationColorPresets}
          hasDocument={!boardVisible && Boolean(activeDocument)}
          canZoom={boardVisible || Boolean(activeDocument)}
          isOcrRunning={isOcrRunning}
          isTextIndexing={isTextIndexingActive}
          isPanMode={isPanMode}
          pageCount={pageCount}
          pageNumber={pageNumber}
          selectedAnnotationColor={selectedAnnotationColor}
          status={boardVisible ? `${documents.length} 本书` : status}
          title={boardVisible ? '书库线索板' : activeDocument?.title ?? '未选择 PDF'}
          onAnnotationInteractionModeChange={handleAnnotationInteractionModeChange}
          onColorChange={handleColorChange}
          onCancelTextIndex={handleCancelTextIndex}
          onCancelOcr={handleCancelOcr}
          onOcrDocument={handleRunDocumentOcr}
          onOcrCurrentPage={handleRunCurrentPageOcr}
          onNextPage={handleNextPage}
          onPageNumberChange={handlePageNumberChange}
          onPreviousPage={handlePreviousPage}
          onTogglePanMode={handleTogglePanMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />

      <LibraryBoard key={boardEntry?.chat ?? 'library'} initialChat={boardEntry} chatHost={boardChatHost} onShowChat={showCompanion} visible={boardVisible} toolbar={boardTools} presets={annotationColorPresets} documents={documents} provider={readyProvider ?? null}
        canResume={Boolean(activeDocument)} onClose={() => setBoardVisible(false)} onOpen={(doc, page) => {
          setBoardVisible(false)
          setMobileTab('reader')
          void loadDocument(doc, page).catch(error => { setStatus(String(error)); window.alert(String(error)) })
        }}/>

        <ReaderSurface
          annotationFocus={annotationFocus}
          onDismissFocus={dismissAnnotationFocus}
          annotations={visibleCurrentPageAnnotations}
          file={pdfFile}
          interactionMode={annotationInteractionMode}
          isPanMode={isPanMode}
          isPanning={isPanning}
          ocrLayout={ocrPageLayout}
          pageNumber={pageNumber}
          pdfError={pdfError}
          readerSurfaceRef={readerSurfaceRef}
          scale={scale}
          temporaryHighlight={currentPageSearchHighlight}
          onCaptureSelection={handleCaptureSelection}
          onDocumentLoadError={(message) => {
            setPdfError(message)
            setStatus(`PDF 打开失败：${message}`)
          }}
          onDocumentLoadSuccess={(numPages) => {
            const safePageCount = Number.isFinite(numPages) && numPages > 0 ? Math.floor(numPages) : 1
            const documentId = activeDocument?.id ?? null
            const previousLoad = loadedPdfRef.current
            const isSamePdfLoad =
              previousLoad?.documentId === documentId && previousLoad.pageCount === safePageCount

            if (pdfError) {
              setPdfError(null)
            }
            setPageCount((current) => (current === safePageCount ? current : safePageCount))

            const normalizedPageNumber = clampPageNumber(pageNumber, safePageCount)
            if (normalizedPageNumber !== pageNumber) {
              requestReaderViewportReset()
              setPageNumber(normalizedPageNumber)
            }

            if (isSamePdfLoad) {
              return
            }

            loadedPdfRef.current = { documentId, pageCount: safePageCount }
            setStatus(`共 ${safePageCount} 页`)
            if (activeDocument) {
              void ensureDocumentTextIndex(activeDocument, safePageCount)
            }
          }}
          onDocumentSourceError={(message) => {
            setPdfError(message)
            setStatus(`PDF 来源读取失败：${message}`)
          }}
          onMouseDown={handleReaderMouseDown}
          onOpenPdf={() => void openPdf()}
          onPageLoadError={(message) => {
            setPdfError(message)
            setStatus(`PDF 页面渲染失败：${message}`)
          }}
          onPageRenderSuccess={resetReaderViewportAfterRender}
          onStopPan={stopReaderPan}
          onWheel={handleReaderWheel}
        />

        {selection && (
          <SelectionToolbar
            isNoteEditorOpen={isSelectionNoteEditorOpen}
            noteDraft={selectionNoteDraft}
            x={selection.x}
            y={selection.y}
            onCancelNote={() => {
              setSelectionNoteDraft('')
              setIsSelectionNoteEditorOpen(false)
            }}
            onCreateHighlight={() => void createAnnotation('highlight')}
            onCreateNote={(note) => void createAnnotation('note', note)}
            onCreateVocabulary={() => void createVocabularyFromSelection()}
            onExplain={() => void runAIAction('explain_selection')}
            onToggleNoteEditor={() => setIsSelectionNoteEditorOpen((value) => !value)}
            onTranslate={() => void runAIAction('translate_selection')}
          />
        )}
      </main>

      <aside className={isInspectorCollapsed ? 'inspector-panel is-collapsed' : 'inspector-panel'}>
        <button
          className="panel-collapse-button"
          title={isInspectorCollapsed ? '展开右侧功能区' : '折叠右侧功能区'}
          onClick={() => setIsInspectorCollapsed((value) => !value)}
        >
          {isInspectorCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
        </button>

        {!isInspectorCollapsed && (
          <>
        <InspectorTabBar activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'notes' && (
          <NotesPanel
            key={activeDocument?.id}
            annotations={annotations}
            currentPageNumber={pageNumber}
            filters={annotationFilters}
            colorPresets={annotationColorPresets}
            draftNote={draftNote}
            hasDocument={Boolean(activeDocument)}
            readerName={readerName}
            onBookmark={() => void createAnnotation('bookmark')}
            onDelete={(id) => void deleteAnnotation(id)}
            onExportReadingMarks={() => void exportReadingMarks()}
            onImportReadingMarks={() => void importReadingMarks()}
            onFiltersChange={setAnnotationFilters}
            onJump={openAnnotation}
            onSaveNote={(note) => void createAnnotation('note', note || '空白页边注')}
            onUpdateAnnotation={(id, note, color) => void updateAnnotation(id, note, color)}
          />
        )}

        {activeTab === 'search' && (
          <SearchPanel
            hasDocument={Boolean(activeDocument)}
            isSearching={isSearching}
            query={searchQuery}
            results={searchResults}
            onJump={(result) => {
              setTemporarySearchHighlight(null)
              setActiveSearchTarget({
                nonce: Date.now(),
                query: searchQuery,
                result
              })
              requestReaderViewportReset()
              setBoardVisible(false)
              setMobileTab('reader')
              setPageNumber(result.pageNumber)
              setStatus(`已跳转到第 ${result.pageNumber} 页，正在定位搜索片段`)
            }}
            onSearch={(query) => void searchDocument(query)}
            onClear={clearSearch}
          />
        )}

        {activeTab === 'ai' && boardVisible && <div ref={setBoardChatHost} className="board-chat-host"/>}
        {activeTab === 'ai' && !boardVisible && (
          <AiPanel
            onReadingLink={openReadingLink}
            aiRun={aiRun}
            aiOperations={aiOperations}
            chatDraft={chatDraft}
            chatTitleDraft={chatTitleDraft}
            chatMessages={chatMessages}
            conversations={aiConversations}
            hasDocument={Boolean(activeDocument)}
            isConversationOpen={isChatDrawerOpen}
            question={qaQuestion}
            readyProvider={readyProvider}
            selection={selection?.text ?? null}
            activeConversationId={activeConversationId}
            onAskDocument={(question, annotatePage) => void askDocumentQuestion(question, annotatePage)}
            onCancelRun={() => void cancelCurrentAIRun()}
            onCloseConversation={() => setIsChatDrawerOpen(false)}
            onCreateConversation={startNewAIConversation}
            onKeepAIOperation={keepAIOperation}
            onRevertAIOperation={(operationId) => void revertAIOperation(operationId)}
            onResendChatMessage={(message, content) => void resendChatMessage(message, content)}
            onSendChat={(message, title) => void sendChatMessage(message, title)}
            onSelectConversation={(conversationId) => void selectAIConversation(conversationId)}
            onRun={(promptType) => void runAIAction(promptType)}
            onUpdateConversationTitle={(conversationId, title) =>
              void updateAIConversationTitle(conversationId, title)
            }
          />
        )}

        {activeTab === 'vocab' && (
          <VocabularyPanel
            hasDocument={Boolean(activeDocument)}
            dictionarySources={dictionarySources}
            vocabulary={vocabulary}
            onAddDictionaryEntry={(entry) => void addDictionaryEntryToVocabulary(entry)}
            onDefine={(item) => void defineVocabularyWithAI(item)}
            onDelete={(id) => void deleteVocabulary(id)}
            onImportDictionary={() => void importDictionary()}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            configuredProviderIds={configuredProviderIds}
            providers={providers}
            readerName={readerName}
            onClearKey={(providerId) => void clearProviderKey(providerId)}
            onReaderNameChange={setReaderName}
            onSaveKey={(providerId, apiKey) => void saveProviderKey(providerId, apiKey)}
            onToggle={(provider, enabled) => void updateProvider(provider, enabled)}
            onUpdateModel={(provider, defaultModel) => void updateProviderModel(provider, defaultModel)}
          />
        )}
          </>
        )}
      </aside>
      </div>
    </div>
  )
}

export default App
