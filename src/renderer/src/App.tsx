import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import {
  AIChatMessageRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  AnnotationRecord,
  DocumentSearchResult,
  DocumentRecord,
  OpenPdfResult,
  ProviderKeyStatus,
  DictionarySourceRecord,
  VocabularyRecord
} from '../../shared/types'
import {
  extractAIReasoning,
  makeConversationTitle,
  stripAIReasoningBlock
} from './aiText'
import {
  aiDefaultAnnotationColor,
  extractAIAssistedAnnotations
} from './aiAnnotations'
import { AIRunState, promptLabels } from './aiPanelTypes'
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
  const [aiRun, setAiRun] = useState<AIRunState | null>(null)
  const aiRunRef = useRef<AIRunState | null>(null)
  const readerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const suppressSelectionRef = useRef(false)
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
    aiRunRef.current = aiRun
  }, [aiRun])

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
    return window.readingPartner.onAIStreamEvent((event) => {
      void handleAIStreamEvent(event)
    })
  }, [])

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
    selectionText: selection?.text ?? null,
    vocabulary,
    refreshDictionarySources,
    setActiveTab,
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
    clearSelection: () => setSelection(null)
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

  const handleAIStreamEvent = async (event: AIStreamEvent): Promise<void> => {
    if (event.type === 'start') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, model: event.model, status: 'running', error: null, reasoningOutput: '' }
          : current
      )
      return
    }

    if (event.type === 'delta') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? event.channel === 'reasoning'
            ? { ...current, reasoningOutput: `${current.reasoningOutput}${event.text}` }
            : { ...current, output: `${current.output}${event.text}` }
          : current
      )
      return
    }

    if (event.type === 'error') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'error', error: event.message }
          : current
      )
      setStatus(`AI 调用失败：${event.message}`)
      return
    }

    if (event.type === 'cancelled') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'cancelled', error: null }
          : current
      )
      setStatus('已取消 AI 请求')
      return
    }

    const currentRun = aiRunRef.current
    const {
      displayOutput,
      annotations: assistedAnnotationDrafts
    } = extractAIAssistedAnnotations(
      event.artifact.outputMarkdown,
      event.artifact.pageNumber ?? pageNumber,
      pageCount,
      annotationColorPresets.map((preset) => preset.value)
    )
    const finalReasoning = extractAIReasoning(displayOutput).reasoning
    const visibleOutputForNote = stripAIReasoningBlock(displayOutput)

    if (currentRun?.source === 'chat' && currentRun.conversationId) {
      await refreshAIConversationAfterRun(currentRun.conversationId, event.artifact.documentId)
      const createdAnnotations = await createAIAssistedAnnotations(
        event.artifact.documentId,
        assistedAnnotationDrafts,
        event.artifact.model
      )

      registerAIOperation(event.requestId, createdAnnotations, currentRun.conversationId)
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'done', output: visibleOutputForNote, reasoningOutput: finalReasoning }
          : current
      )
      setStatus(
        createdAnnotations.length > 0
          ? `共读对话已更新，并创建 ${createdAnnotations.length} 条 AI 辅助批注`
          : '共读对话已更新'
      )
      return
    }

    if (currentRun?.source === 'vocabulary' && currentRun.vocabularyId) {
      const updated = await window.readingPartner.updateVocabularyDefinition({
        id: currentRun.vocabularyId,
        definition: visibleOutputForNote
      })
      setVocabulary((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      const createdAnnotations = await createAIAssistedAnnotations(
        event.artifact.documentId,
        assistedAnnotationDrafts,
        event.artifact.model
      )
      registerAIOperation(event.requestId, createdAnnotations)
    } else {
      const createdAnnotations: AnnotationRecord[] = []
      const note = await window.readingPartner.createAnnotation({
        documentId: event.artifact.documentId,
        type: 'note',
        pageNumber: event.artifact.pageNumber ?? 1,
        selectedText: event.artifact.inputText,
        color: aiDefaultAnnotationColor,
        note: `AI ${promptLabels[event.artifact.promptType]}\n模型：${event.artifact.model}\n\n${visibleOutputForNote}`,
        authorName: 'AI'
      })
      createdAnnotations.push(note)

      createdAnnotations.push(
        ...(await createAIAssistedAnnotations(
          event.artifact.documentId,
          assistedAnnotationDrafts,
          event.artifact.model
        ))
      )

      setAnnotations((items) => [...items, note])
      registerAIOperation(event.requestId, createdAnnotations)
    }

    setAiRun((current) =>
      current && current.requestId === event.requestId
        ? { ...current, status: 'done', output: visibleOutputForNote, reasoningOutput: finalReasoning }
        : current
    )
    setStatus(
      currentRun?.source === 'vocabulary'
        ? 'AI 释义已写入词汇本'
        : assistedAnnotationDrafts.length > 0
          ? `AI 结果已保存为笔记，并创建 ${assistedAnnotationDrafts.length} 条辅助批注`
          : 'AI 结果已保存为笔记'
    )
  }

  const loadDocument = async (document: DocumentRecord): Promise<void> => {
    setStatus(`正在打开 ${document.title}`)
    setPdfError(null)
    const data = await window.readingPartner.readPdf(document.id)
    const nextUrl = toPdfBlobUrl(data)
    setActiveDocument(document)
    requestReaderViewportReset()
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
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
    setActiveDocument(result.document)
    requestReaderViewportReset()
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
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

  const runAIAction = async (promptType: AIPromptType, text = selection?.text): Promise<void> => {
    if (!activeDocument || !text) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    setAiRun({
      requestId,
      promptType,
      inputText: text,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'selection'
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} ${promptLabels[promptType]}选区`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      promptType,
      selectedText: text
    })
  }

  const cancelCurrentAIRun = async (): Promise<void> => {
    const currentRun = aiRunRef.current

    if (!currentRun || currentRun.status !== 'running') {
      return
    }

    await window.readingPartner.cancelAIRequest(currentRun.requestId)
    setAiRun((current) =>
      current && current.requestId === currentRun.requestId
        ? { ...current, status: 'cancelled', error: null }
        : current
    )
    setStatus('已取消 AI 请求')
  }

  const askDocumentQuestion = async (question: string): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = question.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    setAiRun({
      requestId,
      promptType: 'ask_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'document_qa'
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 回答文档问题`)

    await window.readingPartner.askDocumentQuestion({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      question: trimmed
    })
  }

  const sendChatMessage = async (message: string): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = message.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const conversation =
      activeConversation ??
      (await createAIConversation(chatTitleDraft.trim() || makeConversationTitle(trimmed)))

    if (!conversation) {
      return
    }

    const selectedText = selection?.text ?? null
    const requestId = crypto.randomUUID()
    const optimisticMessage: AIChatMessageRecord = {
      id: `pending:${requestId}`,
      conversationId: conversation.id,
      role: 'user',
      content: trimmed,
      selectedText,
      pageNumber,
      providerId: null,
      model: null,
      artifactId: null,
      createdAt: new Date().toISOString()
    }

    appendOptimisticChatMessage(optimisticMessage)
    setIsChatDrawerOpen(true)
    setChatDraft('')
    setChatTitleDraft('')
    setAiRun({
      requestId,
      promptType: 'chat_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'chat',
      conversationId: conversation.id
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} 继续共读对话`)

    await window.readingPartner.runAIChat({
      requestId,
      providerId: readyProvider.id,
      conversationId: conversation.id,
      documentId: activeDocument.id,
      pageNumber,
      message: trimmed,
      selectedText
    })
  }

  const defineVocabularyWithAI = async (item: VocabularyRecord): Promise<void> => {
    if (!activeDocument) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    const inputText = [
      `Term: ${item.word}`,
      item.sourceSentence ? `Source sentence: ${item.sourceSentence}` : null,
      item.definition ? `Current definition: ${item.definition}` : null
    ]
      .filter(Boolean)
      .join('\n')

    setAiRun({
      requestId,
      promptType: 'define_vocabulary',
      inputText,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'vocabulary',
      vocabularyId: item.id
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 生成词汇释义`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber: item.pageNumber ?? pageNumber,
      promptType: 'define_vocabulary',
      selectedText: inputText
    })
  }

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
            setPdfError(null)
            setPageCount(numPages)
            setStatus(`共 ${numPages} 页`)
            if (activeDocument) {
              void ensureDocumentTextIndex(activeDocument, numPages)
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
