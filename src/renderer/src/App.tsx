import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import { Document, Page } from 'react-pdf'
import {
  Bookmark,
  BookMarked,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Highlighter,
  Hand,
  Languages,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import {
  AIChatMessageRecord,
  AIConversationRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  AnnotationRecord,
  DictionaryEntryRecord,
  DocumentSearchResult,
  DocumentRecord,
  OpenPdfResult,
  ProviderKeyStatus,
  DictionarySourceRecord,
  VocabularyRecord
} from '../../shared/types'
import {
  extractAIReasoning,
  stripAIReasoningBlock
} from './aiText'
import {
  aiDefaultAnnotationColor,
  extractAIAssistedAnnotations,
  type AIAssistedAnnotation
} from './aiAnnotations'
import { AIOperationRecord, AIRunState, promptLabels } from './aiPanelTypes'
import { AnnotationRect, normalizeAnnotationRects } from './annotationGeometry'
import { AiPanel } from './components/AiPanel'
import {
  AnnotationInteractionMode,
  AnnotationOverlay,
  TemporarySearchHighlight
} from './components/AnnotationOverlay'
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
import { SettingsPanel } from './components/SettingsPanel'
import { VocabularyPanel } from './components/VocabularyPanel'
import { makeDefinitionFromDictionary } from './vocabularyUtils'
import {
  buildTextLayerSearchIndex,
  findSearchMatch,
  rectsFromTextLayerMatch
} from './pdfSearchHighlight'
import { PanState, useReaderPan } from './hooks/useReaderPan'
import { useReaderShortcuts } from './hooks/useReaderShortcuts'

type PanelTab = 'notes' | 'search' | 'ai' | 'vocab' | 'settings'
type SelectionState = {
  text: string
  x: number
  y: number
  rects: AnnotationRect[]
}

type ActiveSearchTarget = {
  nonce: number
  query: string
  result: DocumentSearchResult
}

type AnnotationUndoAction =
  | {
      kind: 'create'
      annotation: AnnotationRecord
    }
  | {
      kind: 'delete'
      annotation: AnnotationRecord
    }
  | {
      kind: 'update'
      before: AnnotationRecord
      after: AnnotationRecord
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

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const makeConversationTitle = (message: string): string => {
  const normalized = message
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return '共读对话'
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized
}

const getStoredReaderName = (): string => {
  const value = window.localStorage.getItem('reading-partner.reader-name')?.trim()
  return value || '本机读者'
}

const toPdfBlobUrl = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const stableCopy = bytes.slice()
  return URL.createObjectURL(new Blob([stableCopy], { type: 'application/pdf' }))
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
  const [aiConversations, setAiConversations] = useState<AIConversationRecord[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<AIChatMessageRecord[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatTitleDraft, setChatTitleDraft] = useState('')
  const [readerName, setReaderName] = useState(getStoredReaderName)
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationUndoAction[]>([])
  const [aiOperations, setAiOperations] = useState<AIOperationRecord[]>([])
  const [annotationFilters, setAnnotationFilters] =
    useState<AnnotationFilterState>(defaultAnnotationFilters)
  const [status, setStatus] = useState('打开一本 PDF 开始阅读')
  const [aiRun, setAiRun] = useState<AIRunState | null>(null)
  const aiRunRef = useRef<AIRunState | null>(null)
  const readerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const pendingReaderViewportResetRef = useRef(false)
  const panStateRef = useRef<PanState | null>(null)
  const suppressSelectionRef = useRef(false)

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

  const activeConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, aiConversations]
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

  useEffect(() => {
    if (!activeSearchTarget || activeSearchTarget.result.pageNumber !== pageNumber) {
      return
    }

    let cancelled = false
    let retryTimer: number | null = null

    const locateSearchTarget = (attempt = 0): void => {
      if (cancelled) {
        return
      }

      const pageElement = readerSurfaceRef.current?.querySelector<HTMLElement>('.react-pdf__Page')
      const textLayer = pageElement?.querySelector<HTMLElement>('.react-pdf__Page__textContent')

      if (!pageElement || !textLayer || textLayer.textContent?.trim().length === 0) {
        if (attempt < 14) {
          retryTimer = window.setTimeout(() => locateSearchTarget(attempt + 1), 80)
        }
        return
      }

      const index = buildTextLayerSearchIndex(textLayer)
      const match = findSearchMatch(index, activeSearchTarget.result, activeSearchTarget.query)
      const rects = match ? rectsFromTextLayerMatch(index, match, pageElement, scale) : []

      if (rects.length > 0) {
        setTemporarySearchHighlight({
          id: `search-${activeSearchTarget.result.id}-${activeSearchTarget.nonce}`,
          pageNumber: activeSearchTarget.result.pageNumber,
          text: activeSearchTarget.result.snippet,
          rects
        })
        setStatus(`已定位第 ${activeSearchTarget.result.pageNumber} 页的搜索片段`)
        return
      }

      if (attempt < 14) {
        retryTimer = window.setTimeout(() => locateSearchTarget(attempt + 1), 80)
      } else {
        setTemporarySearchHighlight(null)
        setStatus(`已跳转到第 ${activeSearchTarget.result.pageNumber} 页，但未能自动定位文字坐标`)
      }
    }

    setTemporarySearchHighlight(null)
    retryTimer = window.setTimeout(() => locateSearchTarget(), 0)

    return () => {
      cancelled = true

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [activeSearchTarget, pageNumber, scale])

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

  const clearSearch = (): void => {
    setSearchQuery('')
    setSearchResults([])
    setIsSearching(false)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
  }

  const pushAnnotationUndo = (action: AnnotationUndoAction): void => {
    setAnnotationUndoStack((items) => [...items.slice(-39), action])
  }

  const normalizeAIAssistedNote = (note: string): string => {
    let normalized = note.trim()

    for (let index = 0; index < 3; index += 1) {
      normalized = normalized
        .replace(/^(AI\s*)?(段落批注|词汇批注|辅助批注)[：:\s]+/i, '')
        .trim()
    }

    return normalized || note.trim()
  }

  const createAIAssistedAnnotations = async (
    documentId: string,
    drafts: AIAssistedAnnotation[],
    model: string
  ): Promise<AnnotationRecord[]> => {
    if (drafts.length === 0) {
      return []
    }

    const created = await Promise.all(
      drafts.map((draft) =>
        window.readingPartner.createAnnotation({
          documentId,
          type: 'note',
          pageNumber: draft.pageNumber,
          selectedText: draft.selectedText,
          color: draft.color,
          note: `模型：${model}\n\n${normalizeAIAssistedNote(draft.note)}`,
          authorName: 'AI'
        })
      )
    )

    setAnnotations((items) => [...items, ...created])
    return created
  }

  const registerAIOperation = (
    requestId: string,
    annotationsForOperation: AnnotationRecord[],
    conversationId?: string
  ): void => {
    if (annotationsForOperation.length === 0) {
      return
    }

    setAiOperations((items) => [
      {
        id: crypto.randomUUID(),
        requestId,
        createdAt: new Date().toISOString(),
        annotations: annotationsForOperation,
        status: 'pending',
        ...(conversationId ? { conversationId } : {})
      },
      ...items
    ])
  }

  const keepAIOperation = (operationId: string): void => {
    setAiOperations((items) =>
      items.map((item) => (item.id === operationId ? { ...item, status: 'kept' } : item))
    )
    setStatus('已保留 AI 创建的批注')
  }

  const revertAIOperation = async (operationId: string): Promise<void> => {
    const operation = aiOperations.find((item) => item.id === operationId)

    if (!operation || operation.status === 'reverted') {
      return
    }

    await Promise.all(
      operation.annotations.map((annotation) => window.readingPartner.deleteAnnotation(annotation.id))
    )
    const deletedIds = new Set(operation.annotations.map((annotation) => annotation.id))
    setAnnotations((items) => items.filter((item) => !deletedIds.has(item.id)))
    setAiOperations((items) =>
      items.map((item) => (item.id === operationId ? { ...item, status: 'reverted' } : item))
    )
    setStatus('已撤销 AI 创建的批注')
  }

  const resetReaderViewport = (): void => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const surface = readerSurfaceRef.current

        if (!surface) {
          return
        }

        surface.scrollLeft = Math.max(0, (surface.scrollWidth - surface.clientWidth) / 2)
        surface.scrollTop = 0
      })
    })
  }

  const requestReaderViewportReset = (): void => {
    pendingReaderViewportResetRef.current = true
  }

  const resetReaderViewportAfterRender = (): void => {
    if (!pendingReaderViewportResetRef.current) {
      return
    }

    pendingReaderViewportResetRef.current = false
    resetReaderViewport()
  }

  const refreshAIConversations = async (documentId: string): Promise<void> => {
    const conversations = await window.readingPartner.listAIConversations(documentId)
    setAiConversations(conversations)

    const nextActive = conversations[0] ?? null
    setActiveConversationId(nextActive?.id ?? null)
    setChatMessages(
      nextActive ? await window.readingPartner.listAIChatMessages(nextActive.id) : []
    )
  }

  const selectAIConversation = async (conversationId: string): Promise<void> => {
    setActiveConversationId(conversationId)
    setChatMessages(await window.readingPartner.listAIChatMessages(conversationId))
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
  }

  const startNewAIConversation = (): void => {
    if (!activeDocument) {
      return
    }

    setActiveConversationId(null)
    setChatMessages([])
    setChatDraft('')
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
    setActiveTab('ai')
    setStatus('正在创建新对话，发送第一条消息后保存')
  }

  const createAIConversation = async (title?: string): Promise<AIConversationRecord | null> => {
    if (!activeDocument) {
      return null
    }

    const conversation = await window.readingPartner.createAIConversation(
      activeDocument.id,
      '共读对话'
    )
    const titledConversation = title?.trim()
      ? await window.readingPartner.updateAIConversationTitle({ id: conversation.id, title: title.trim() })
      : conversation
    setAiConversations((items) => [titledConversation, ...items])
    setActiveConversationId(titledConversation.id)
    setChatMessages([])
    setIsChatDrawerOpen(true)
    setStatus('已创建共读对话')

    return titledConversation
  }

  const updateAIConversationTitle = async (conversationId: string, title: string): Promise<void> => {
    const trimmed = title.trim()

    if (!trimmed) {
      return
    }

    const updated = await window.readingPartner.updateAIConversationTitle({
      id: conversationId,
      title: trimmed
    })
    setAiConversations((items) => items.map((item) => (item.id === conversationId ? updated : item)))
    setStatus('已更新对话名称')
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

  const ensureDocumentTextIndex = async (
    document: DocumentRecord,
    expectedPageCount: number
  ): Promise<void> => {
    try {
      const current = await window.readingPartner.getDocumentTextIndexStatus(document.id)

      if (
        current.pageCount === expectedPageCount &&
        current.pagesIndexed >= expectedPageCount
      ) {
        setStatus(`共 ${expectedPageCount} 页，文本索引已就绪`)
        return
      }

      setStatus(`共 ${expectedPageCount} 页，正在抽取文本索引...`)
      const result = await window.readingPartner.indexDocumentText(document.id)
      setActiveDocument((active) =>
        active?.id === result.documentId ? { ...active, pageCount: result.pageCount } : active
      )
      await refreshLibrary()
      setStatus(
        result.skipped
          ? `共 ${result.pageCount ?? expectedPageCount} 页，文本索引已就绪`
          : `文本索引完成：${result.pagesIndexed} 页 / ${result.chunksIndexed} 个片段`
      )
    } catch (error) {
      setStatus(`文本索引失败：${error instanceof Error ? error.message : String(error)}`)
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
      const [messages, conversations] = await Promise.all([
        window.readingPartner.listAIChatMessages(currentRun.conversationId),
        window.readingPartner.listAIConversations(event.artifact.documentId)
      ])
      const createdAnnotations = await createAIAssistedAnnotations(
        event.artifact.documentId,
        assistedAnnotationDrafts,
        event.artifact.model
      )

      registerAIOperation(event.requestId, createdAnnotations, currentRun.conversationId)

      setChatMessages(messages)
      setAiConversations(conversations)
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
    setAnnotationUndoStack([])
    setAiOperations([])
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
    setAnnotationUndoStack([])
    setAiOperations([])
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

  const createAnnotation = async (
    type: AnnotationRecord['type'],
    note?: string,
    color = selectedAnnotationColor
  ): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const created = await window.readingPartner.createAnnotation({
      documentId: activeDocument.id,
      type,
      pageNumber,
      selectedText: selection?.text ?? null,
      color: type === 'bookmark' ? null : color,
      note: note ?? null,
      rectsJson: type !== 'bookmark' && selection?.rects.length ? JSON.stringify(selection.rects) : null,
      authorName: readerName.trim() || 'Reader'
    })

    setAnnotations((items) => [...items, created])
    pushAnnotationUndo({ kind: 'create', annotation: created })
    setSelection(null)
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
    setDraftNote('')
    setStatus(type === 'bookmark' ? '已添加书签' : '已保存批注')
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

    setChatMessages((items) => [...items, optimisticMessage])
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

  const deleteAnnotation = async (id: string): Promise<void> => {
    const deleted = annotations.find((item) => item.id === id)
    await window.readingPartner.deleteAnnotation(id)
    setAnnotations((items) => items.filter((item) => item.id !== id))
    if (deleted) {
      pushAnnotationUndo({ kind: 'delete', annotation: deleted })
    }
  }

  const updateAnnotation = async (id: string, note: string, color?: string | null): Promise<void> => {
    const before = annotations.find((item) => item.id === id)
    const updated = await window.readingPartner.updateAnnotation({
      id,
      note: note.trim() || null,
      color
    })
    setAnnotations((items) => items.map((item) => (item.id === id ? updated : item)))
    if (before) {
      pushAnnotationUndo({ kind: 'update', before, after: updated })
    }
    setStatus('已更新批注')
  }

  const undoLastAnnotationAction = async (): Promise<void> => {
    const action = annotationUndoStack.at(-1)

    if (!action) {
      setStatus('没有可撤销的批注操作')
      return
    }

    setAnnotationUndoStack((items) => items.slice(0, -1))

    if (action.kind === 'create') {
      await window.readingPartner.deleteAnnotation(action.annotation.id)
      setAnnotations((items) => items.filter((item) => item.id !== action.annotation.id))
      setStatus('已撤销新增批注')
      return
    }

    if (action.kind === 'delete') {
      const restored = await window.readingPartner.restoreAnnotation(action.annotation)
      setAnnotations((items) =>
        [...items.filter((item) => item.id !== restored.id), restored].sort(
          (first, second) =>
            first.pageNumber - second.pageNumber || first.createdAt.localeCompare(second.createdAt)
        )
      )
      setStatus('已撤销删除批注')
      return
    }

    const restored = await window.readingPartner.restoreAnnotation(action.before)
    setAnnotations((items) => items.map((item) => (item.id === restored.id ? restored : item)))
    setStatus('已撤销批注编辑')
  }

  const exportReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.exportReadingMarksDialog(activeDocument.id)

    if (result) {
      setStatus(`已导出 ${result.annotationCount} 条阅读记录`)
    }
  }

  const importReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.importReadingMarksDialog(activeDocument.id)

    if (result) {
      await refreshAnnotations(activeDocument.id)
      setAnnotationUndoStack([])
      setStatus(`已导入 ${result.annotationCount} 条阅读记录`)
    }
  }

  const createVocabularyFromSelection = async (): Promise<void> => {
    if (!activeDocument || !selection?.text) {
      return
    }

    try {
      const word = selection.text.replace(/\s+/g, ' ').trim()
      const lookup = await window.readingPartner.lookupDictionary(word)
      const definition = lookup.entry ? makeDefinitionFromDictionary(lookup.entry) : '待补充释义'
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word,
        definition,
        sourceSentence: selection.text,
        pageNumber
      })

      setVocabulary((items) => [created, ...items])
      setSelection(null)
      setActiveTab('vocab')
      setStatus(lookup.entry ? '已用本地词典释义加入词汇本' : '已加入词汇本，未命中本地词典')
    } catch (error) {
      setStatus(`加入词汇本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const addDictionaryEntryToVocabulary = async (entry: DictionaryEntryRecord): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const exists = vocabulary.some(
      (item) => item.word.trim().toLocaleLowerCase() === entry.word.trim().toLocaleLowerCase()
    )

    if (exists) {
      setStatus(`“${entry.word}” 已在当前 PDF 生词本中`)
      return
    }

    try {
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word: entry.word,
        definition: makeDefinitionFromDictionary(entry),
        pageNumber: null
      })

      setVocabulary((items) => [created, ...items])
      setStatus(`已将“${entry.word}”加入当前 PDF 生词本`)
    } catch (error) {
      setStatus(`加入生词本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const importDictionary = async (): Promise<void> => {
    try {
      const result = await window.readingPartner.importDictionaryCsvDialog()

      if (!result) {
        return
      }

      setStatus(`词典导入完成：${result.imported} 条，跳过 ${result.skipped} 条`)
      await refreshDictionarySources()
    } catch (error) {
      setStatus(`词典导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const deleteVocabulary = async (id: string): Promise<void> => {
    try {
      await window.readingPartner.deleteVocabulary(id)
      setVocabulary((items) => items.filter((item) => item.id !== id))
      setStatus('已删除词汇')
    } catch (error) {
      setStatus(`删除词汇失败：${error instanceof Error ? error.message : String(error)}`)
    }
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
      <header className="window-titlebar">
        <div className="window-titlebar-brand">
          <span className="window-title-dot" />
          <strong>Reading Partner</strong>
        </div>
        <div className="window-controls">
          <button title="最小化" onClick={() => void window.readingPartner.minimizeWindow()}>
            <Minus size={14} />
          </button>
          <button title={isWindowMaximized ? '还原' : '最大化'} onClick={() => void toggleWindowMaximize()}>
            <Maximize2 size={14} />
          </button>
          <button className="close" title="关闭" onClick={() => void window.readingPartner.closeWindow()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="app-layout">
      <aside className="library-panel">
        <div className="brand">
          <div className="brand-mark">RP</div>
          <div>
            <h1>Reading Partner</h1>
            <p>AI assisted PDF workspace</p>
          </div>
        </div>

        <button className="primary-action" onClick={() => void openPdf()}>
          <Upload size={18} />
          打开 PDF
        </button>

        <section className="panel-section">
          <div className="section-heading">
            <FileText size={16} />
            文档库
          </div>
          <div className="document-list">
            {documents.length === 0 ? (
              <p className="muted">还没有导入文档。</p>
            ) : (
              documents.map((document) => (
                <button
                  className={document.id === activeDocument?.id ? 'document-item active' : 'document-item'}
                  key={document.id}
                  onClick={() => void loadDocument(document)}
                >
                  <span>{document.title}</span>
                  <small>
                    {formatBytes(document.fileSize)} · {formatTime(document.lastOpenedAt)}
                  </small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading">
            <Bookmark size={16} />
            当前页
          </div>
          <div className="page-summary">
            <strong>{activeDocument ? `第 ${pageNumber} 页` : '未打开文档'}</strong>
            <span>{currentPageAnnotations.length} 条批注</span>
          </div>
        </section>
      </aside>

      <main className="reader-column">
        <header className="reader-toolbar">
          <div>
            <strong>{activeDocument?.title ?? '未选择 PDF'}</strong>
            <span>{status}</span>
          </div>
          <div className="toolbar-controls">
            <div className="annotation-mode-toggle" aria-label="批注交互模式">
              <button
                className={annotationInteractionMode === 'inspect' ? 'active' : ''}
                disabled={!activeDocument}
                title="查看批注"
                onClick={() => setAnnotationInteractionMode('inspect')}
              >
                <Eye size={15} />
                查看
              </button>
              <button
                className={annotationInteractionMode === 'select' ? 'active' : ''}
                disabled={!activeDocument}
                title="文本选择"
                onClick={() => setAnnotationInteractionMode('select')}
              >
                <MousePointer2 size={15} />
                选择
              </button>
            </div>
            <div className="reader-color-palette" aria-label="批注颜色">
              {annotationColorPresets.map((preset) => (
                <button
                  className={selectedAnnotationColor === preset.value ? 'color-swatch active' : 'color-swatch'}
                  disabled={!activeDocument}
                  key={preset.value}
                  onClick={() => setSelectedAnnotationColor(preset.value)}
                  style={{ backgroundColor: preset.value }}
                  title={`批注颜色：${preset.label}`}
                />
              ))}
            </div>
            <button
              className="icon-button"
              disabled={!activeDocument || pageNumber <= 1}
              title="上一页"
              onClick={() => {
                requestReaderViewportReset()
                setPageNumber((value) => Math.max(1, value - 1))
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <label className="page-input">
              <input
                disabled={!activeDocument}
                max={pageCount || 1}
                min={1}
                type="number"
                value={pageNumber}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) {
                    requestReaderViewportReset()
                    setPageNumber(Math.min(Math.max(1, next), pageCount || 1))
                  }
                }}
              />
              <span>/ {pageCount || '-'}</span>
            </label>
            <button
              className="icon-button"
              disabled={!activeDocument || pageNumber >= pageCount}
              title="下一页"
              onClick={() => {
                requestReaderViewportReset()
                setPageNumber((value) => Math.min(pageCount, value + 1))
              }}
            >
              <ChevronRight size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!activeDocument}
              title="缩小"
              onClick={() => zoomBy(-scaleStep)}
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!activeDocument}
              title="放大"
              onClick={() => zoomBy(scaleStep)}
            >
              <Plus size={18} />
            </button>
            <button
              className={isPanMode ? 'icon-button active' : 'icon-button'}
              disabled={!activeDocument}
              title="手型拖动 (D)"
              onClick={() => setIsPanMode((value) => !value)}
            >
              <Hand size={18} />
            </button>
          </div>
        </header>

        <div
          className={[
            'reader-surface',
            isPanMode ? 'pan-enabled' : '',
            isPanning ? 'is-panning' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          ref={readerSurfaceRef}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault()
            }
          }}
          onMouseUp={() => {
            if (suppressSelectionRef.current) {
              return
            }

            captureSelection()
          }}
          onMouseDown={handleReaderMouseDown}
          onMouseLeave={() => {
            if (!isPanning) {
              stopReaderPan()
            }
          }}
          onWheel={handleReaderWheel}
        >
          {pdfFile ? (
            <div className="pdf-stage">
              <Document
                file={pdfFile}
                error={
                  <div className="empty-state error-state">
                    <FileText size={44} />
                    <h2>PDF 打开失败</h2>
                    <p>{pdfError ?? 'PDF.js 无法加载这个文件。'}</p>
                  </div>
                }
                loading={<div className="empty-state">正在解析 PDF...</div>}
                onLoadError={(error) => {
                  setPdfError(error.message)
                  setStatus(`PDF 打开失败：${error.message}`)
                }}
                onLoadSuccess={({ numPages }) => {
                  setPdfError(null)
                  setPageCount(numPages)
                  setStatus(`共 ${numPages} 页`)
                  if (activeDocument) {
                    void ensureDocumentTextIndex(activeDocument, numPages)
                  }
                }}
                onSourceError={(error) => {
                  setPdfError(error.message)
                  setStatus(`PDF 来源读取失败：${error.message}`)
                }}
              >
                <div className="pdf-page-frame">
                  <Page
                    pageNumber={pageNumber}
                    renderAnnotationLayer
                    renderTextLayer
                    scale={scale}
                    onLoadError={(error) => {
                      setPdfError(error.message)
                      setStatus(`PDF 页面渲染失败：${error.message}`)
                    }}
                    onRenderSuccess={resetReaderViewportAfterRender}
                  />
                  <AnnotationOverlay
                    annotations={visibleCurrentPageAnnotations}
                    interactionMode={annotationInteractionMode}
                    scale={scale}
                    temporaryHighlight={currentPageSearchHighlight}
                  />
                </div>
              </Document>
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={44} />
              <h2>打开一本 PDF</h2>
              <p>导入文献后，可以在这里阅读、划词、高亮、批注，并把 AI 解释保存回笔记。</p>
              <button className="primary-action compact" onClick={() => void openPdf()}>
                <Upload size={18} />
                选择 PDF
              </button>
            </div>
          )}
        </div>

        {selection && (
          <div
            className={isSelectionNoteEditorOpen ? 'selection-toolbar has-note-editor' : 'selection-toolbar'}
            style={{
              left: selection.x,
              top: selection.y
            }}
          >
            <button title="高亮 (H)" onClick={() => void createAnnotation('highlight')}>
              <Highlighter size={16} />
              高亮
            </button>
            <button title="批注 (N)" onClick={() => setIsSelectionNoteEditorOpen((value) => !value)}>
              <StickyNote size={16} />
              批注
            </button>
            <button title="翻译" onClick={() => void runAIAction('translate_selection')}>
              <Languages size={16} />
              翻译
            </button>
            <button title="解释" onClick={() => void runAIAction('explain_selection')}>
              <Sparkles size={16} />
              解释
            </button>
            <button title="加入词汇本" onClick={() => void createVocabularyFromSelection()}>
              <BookMarked size={16} />
              生词
            </button>
            {isSelectionNoteEditorOpen && (
              <div className="selection-note-editor">
                <textarea
                  autoFocus
                  placeholder="写下这段原文的批注..."
                  value={selectionNoteDraft}
                  onChange={(event) => setSelectionNoteDraft(event.target.value)}
                />
                <div className="selection-note-actions">
                  <button
                    title="保存批注"
                    onClick={() =>
                      void createAnnotation('note', selectionNoteDraft.trim() || '待补充笔记')
                    }
                  >
                    <Check size={15} />
                    保存
                  </button>
                  <button
                    title="取消"
                    onClick={() => {
                      setSelectionNoteDraft('')
                      setIsSelectionNoteEditorOpen(false)
                    }}
                  >
                    <X size={15} />
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <aside className="inspector-panel">
        <nav className="tab-bar">
          <button className={activeTab === 'notes' ? 'active' : ''} onClick={() => setActiveTab('notes')}>
            <StickyNote size={16} />
            笔记
          </button>
          <button className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>
            <Search size={16} />
            搜索
          </button>
          <button className={activeTab === 'ai' ? 'active' : ''} onClick={() => setActiveTab('ai')}>
            <Bot size={16} />
            AI
          </button>
          <button className={activeTab === 'vocab' ? 'active' : ''} onClick={() => setActiveTab('vocab')}>
            <BookMarked size={16} />
            词汇
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} />
            配置
          </button>
        </nav>

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
