import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import {
  AIProviderRecord,
  AnnotationRecord,
  DocumentSearchResult,
  DocumentRecord,
  OpenPdfResult,
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
import { getStoredReaderName, toPdfBlobUrl } from './readerLocalState'

type PanelTab = InspectorTab
type SelectionState = {
  text: string
  x: number
  y: number
  rects: AnnotationRect[]
}

const minScale = 0.75
const maxScale = 3
const scaleStep = 0.12

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
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.08)
  const [isPanMode, setIsPanMode] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
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
  const readerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const suppressSelectionRef = useRef(false)
  const loadedPdfRef = useRef<{ documentId: string | null; pageCount: number } | null>(null)
  const { requestReaderViewportReset, resetReaderViewportAfterRender } =
    useReaderViewportReset(readerSurfaceRef)

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.pageNumber === pageNumber),
    [annotations, pageNumber]
  )
  const visibleCurrentPageAnnotations = useMemo(
    () =>
      annotationFilters.showOnPdf
        ? currentPageAnnotations.filter((annotation) =>
            annotationFilters.syncToPdf
              ? matchesAnnotationFilters(annotation, annotationFilters, pageNumber, {
                  includePageScope: false,
                  includeQuery: true
                })
              : true
          )
        : [],
    [annotationFilters, currentPageAnnotations, pageNumber]
  )
  const currentPageSearchHighlight = useMemo(
    () =>
      temporarySearchHighlight?.pageNumber === pageNumber
        ? temporarySearchHighlight
        : null,
    [pageNumber, temporarySearchHighlight]
  )

  const pdfFile = useMemo<Source | null>(() => (pdfUrl ? { url: pdfUrl } : null), [pdfUrl])

  const configuredProviderIds = useMemo(
    () => new Set(keyStatus.filter((item) => item.configured).map((item) => item.providerId)),
    [keyStatus]
  )

  const readyProvider = useMemo(
    () => providers.find((provider) => provider.enabled && configuredProviderIds.has(provider.id)) ?? null,
    [configuredProviderIds, providers]
  )

  useEffect(() => {
    void refreshLibrary()
    void refreshProviders()
    void refreshDictionarySources()
  }, [])

  useEffect(() => {
    window.localStorage.setItem('reading-partner.reader-name', readerName.trim() || '本机读者')
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

  const refreshAnnotations = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listAnnotations(documentId)
    setAnnotations(list)
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
    readerName,
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

  const loadDocument = async (document: DocumentRecord): Promise<void> => {
    setStatus(`正在打开 ${document.title}`)
    setPdfError(null)
    loadedPdfRef.current = null
    const data = await window.readingPartner.readPdf(document.id)
    const nextUrl = toPdfBlobUrl(data)
    const initialPageNumber = getInitialPageNumber(document)
    setActiveDocument(document)
    requestReaderViewportReset()
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
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
    await Promise.all([
      refreshAnnotations(document.id),
      refreshVocabulary(document.id),
      refreshAIConversations(document.id)
    ])
    setStatus(`已打开 ${document.title}`)
  }

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

  const captureSelection = (): void => {
    const selected = window.getSelection()
    const text = selected?.toString().trim()

    if (!text || text.length < 2 || !activeDocument) {
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

  return (
    <div className="app-shell">
      <WindowTitlebar
        isMaximized={isWindowMaximized}
        onClose={() => void window.readingPartner.closeWindow()}
        onMinimize={() => void window.readingPartner.minimizeWindow()}
        onToggleMaximize={() => void toggleWindowMaximize()}
      />
      <div className="app-layout">
      <LibraryPanel
        activeDocumentId={activeDocument?.id ?? null}
        currentPageAnnotationCount={currentPageAnnotations.length}
        documents={documents}
        pageNumber={pageNumber}
        onLoadDocument={(document) => void loadDocument(document)}
        onOpenPdf={() => void openPdf()}
      />

      <main className="reader-column">
        <ReaderToolbar
          annotationInteractionMode={annotationInteractionMode}
          colorPresets={annotationColorPresets}
          hasDocument={Boolean(activeDocument)}
          isTextIndexing={Boolean(textIndexRun && textIndexRun.documentId === activeDocument?.id)}
          isPanMode={isPanMode}
          pageCount={pageCount}
          pageNumber={pageNumber}
          selectedAnnotationColor={selectedAnnotationColor}
          status={status}
          title={activeDocument?.title ?? '未选择 PDF'}
          onAnnotationInteractionModeChange={setAnnotationInteractionMode}
          onColorChange={setSelectedAnnotationColor}
          onCancelTextIndex={() => void cancelCurrentDocumentTextIndex()}
          onNextPage={() => {
            requestReaderViewportReset()
            setPageNumber((value) => Math.min(pageCount, value + 1))
          }}
          onPageNumberChange={(nextPageNumber) => {
            requestReaderViewportReset()
            setPageNumber(nextPageNumber)
          }}
          onPreviousPage={() => {
            requestReaderViewportReset()
            setPageNumber((value) => Math.max(1, value - 1))
          }}
          onTogglePanMode={() => setIsPanMode((value) => !value)}
          onZoomIn={() => zoomBy(scaleStep)}
          onZoomOut={() => zoomBy(-scaleStep)}
        />

        <ReaderSurface
          annotations={visibleCurrentPageAnnotations}
          file={pdfFile}
          interactionMode={annotationInteractionMode}
          isPanMode={isPanMode}
          isPanning={isPanning}
          pageNumber={pageNumber}
          pdfError={pdfError}
          readerSurfaceRef={readerSurfaceRef}
          scale={scale}
          temporaryHighlight={currentPageSearchHighlight}
          onCaptureSelection={() => {
            if (!suppressSelectionRef.current) {
              captureSelection()
            }
          }}
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
            onNoteDraftChange={setSelectionNoteDraft}
            onToggleNoteEditor={() => setIsSelectionNoteEditorOpen((value) => !value)}
            onTranslate={() => void runAIAction('translate_selection')}
          />
        )}
      </main>

      <aside className="inspector-panel">
        <InspectorTabBar activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'notes' && (
          <NotesPanel
            annotations={annotations}
            currentPageNumber={pageNumber}
            filters={annotationFilters}
            colorPresets={annotationColorPresets}
            draftNote={draftNote}
            hasDocument={Boolean(activeDocument)}
            readerName={readerName}
            onBookmark={() => void createAnnotation('bookmark')}
            onDelete={(id) => void deleteAnnotation(id)}
            onDraftNoteChange={setDraftNote}
            onExportReadingMarks={() => void exportReadingMarks()}
            onImportReadingMarks={() => void importReadingMarks()}
            onFiltersChange={setAnnotationFilters}
            onJump={(annotation) => {
              requestReaderViewportReset()
              setPageNumber(annotation.pageNumber)
              setStatus(`已跳转到第 ${annotation.pageNumber} 页`)
            }}
            onSaveNote={() => void createAnnotation('note', draftNote || '空白页边注')}
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
              setPageNumber(result.pageNumber)
              setStatus(`已跳转到第 ${result.pageNumber} 页，正在定位搜索片段`)
            }}
            onQueryChange={(value) => {
              setSearchQuery(value)
              setActiveSearchTarget(null)
              setTemporarySearchHighlight(null)
            }}
            onSearch={() => void searchDocument()}
            onClear={clearSearch}
          />
        )}

        {activeTab === 'ai' && (
          <AiPanel
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
            onAskDocument={(question) => void askDocumentQuestion(question)}
            onCancelRun={() => void cancelCurrentAIRun()}
            onChatDraftChange={setChatDraft}
            onChatTitleDraftChange={setChatTitleDraft}
            onCloseConversation={() => setIsChatDrawerOpen(false)}
            onCreateConversation={startNewAIConversation}
            onKeepAIOperation={keepAIOperation}
            onRevertAIOperation={(operationId) => void revertAIOperation(operationId)}
            onResendChatMessage={(message) => void resendChatMessage(message)}
            onSendChat={(message) => void sendChatMessage(message)}
            onSelectConversation={(conversationId) => void selectAIConversation(conversationId)}
            onQuestionChange={setQaQuestion}
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
          />
        )}
      </aside>
      </div>
    </div>
  )
}

export default App
