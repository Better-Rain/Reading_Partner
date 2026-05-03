import { useEffect, useMemo, useState } from 'react'
import type { WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import { Document, Page } from 'react-pdf'
import {
  Bookmark,
  BookMarked,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  KeyRound,
  Languages,
  MessageSquarePlus,
  Minus,
  Plus,
  Settings,
  Sparkles,
  StickyNote,
  Trash2,
  Upload
} from 'lucide-react'
import {
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  AnnotationRecord,
  DocumentRecord,
  OpenPdfResult,
  ProviderKeyStatus,
  VocabularyRecord
} from '../../shared/types'

type PanelTab = 'notes' | 'ai' | 'vocab' | 'settings'

type SelectionState = {
  text: string
  x: number
  y: number
}

type AIRunState = {
  requestId: string
  promptType: AIPromptType
  inputText: string
  providerLabel: string
  model: string
  output: string
  status: 'idle' | 'running' | 'done' | 'error'
  error: string | null
}

const promptLabels: Record<AIPromptType, string> = {
  translate_selection: '翻译',
  explain_selection: '解释',
  summarize_selection: '总结'
}

const minScale = 0.75
const maxScale = 1.8
const scaleStep = 0.1

const clampScale = (value: number): number =>
  Math.min(maxScale, Math.max(minScale, Number(value.toFixed(2))))

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso))

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
  const [providers, setProviders] = useState<AIProviderRecord[]>([])
  const [keyStatus, setKeyStatus] = useState<ProviderKeyStatus[]>([])
  const [activeTab, setActiveTab] = useState<PanelTab>('notes')
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.08)
  const [draftNote, setDraftNote] = useState('')
  const [status, setStatus] = useState('打开一本 PDF 开始阅读')
  const [aiRun, setAiRun] = useState<AIRunState | null>(null)

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.pageNumber === pageNumber),
    [annotations, pageNumber]
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
  }, [])

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

  const refreshAnnotations = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listAnnotations(documentId)
    setAnnotations(list)
  }

  const refreshVocabulary = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listVocabulary(documentId)
    setVocabulary(list)
  }

  const handleAIStreamEvent = async (event: AIStreamEvent): Promise<void> => {
    if (event.type === 'start') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, model: event.model, status: 'running', error: null }
          : current
      )
      return
    }

    if (event.type === 'delta') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, output: `${current.output}${event.text}` }
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

    const note = await window.readingPartner.createAnnotation({
      documentId: event.artifact.documentId,
      type: 'note',
      pageNumber: event.artifact.pageNumber ?? 1,
      selectedText: event.artifact.inputText,
      color: '#c7d2fe',
      note: `AI ${promptLabels[event.artifact.promptType]}\n\n${event.artifact.outputMarkdown}`
    })

    setAnnotations((items) => [...items, note])
    setAiRun((current) =>
      current && current.requestId === event.requestId
        ? { ...current, status: 'done', output: event.artifact.outputMarkdown }
        : current
    )
    setStatus('AI 结果已保存为笔记')
  }

  const loadDocument = async (document: DocumentRecord): Promise<void> => {
    setStatus(`正在打开 ${document.title}`)
    setPdfError(null)
    const data = await window.readingPartner.readPdf(document.id)
    const nextUrl = toPdfBlobUrl(data)
    setActiveDocument(document)
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
    setSelection(null)
    await Promise.all([refreshAnnotations(document.id), refreshVocabulary(document.id)])
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
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
    setSelection(null)
    await Promise.all([
      refreshLibrary(),
      refreshAnnotations(result.document.id),
      refreshVocabulary(result.document.id)
    ])
    setStatus(`已导入 ${result.document.title}`)
  }

  const captureSelection = (): void => {
    const selected = window.getSelection()
    const text = selected?.toString().trim()

    if (!text || text.length < 2 || !activeDocument) {
      setSelection(null)
      return
    }

    const range = selected?.rangeCount ? selected.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()

    setSelection({
      text,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? Math.max(96, rect.top - 12) : 120
    })
  }

  const createAnnotation = async (
    type: AnnotationRecord['type'],
    note?: string,
    color = '#f8d86a'
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
      note: note ?? null
    })

    setAnnotations((items) => [...items, created])
    setSelection(null)
    setDraftNote('')
    setStatus(type === 'bookmark' ? '已添加书签' : '已保存批注')
  }

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
      status: 'running',
      error: null
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

  const deleteAnnotation = async (id: string): Promise<void> => {
    await window.readingPartner.deleteAnnotation(id)
    setAnnotations((items) => items.filter((item) => item.id !== id))
  }

  const createVocabularyFromSelection = async (): Promise<void> => {
    if (!activeDocument || !selection?.text) {
      return
    }

    try {
      const word = selection.text.replace(/\s+/g, ' ').trim()
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word,
        definition: '待补充释义',
        sourceSentence: selection.text,
        pageNumber
      })

      setVocabulary((items) => [created, ...items])
      setSelection(null)
      setActiveTab('vocab')
      setStatus('已加入词汇本')
    } catch (error) {
      setStatus(`加入词汇本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const createVocabulary = async (word: string, definition: string): Promise<void> => {
    if (!activeDocument) {
      return
    }

    try {
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word,
        definition,
        pageNumber
      })

      setVocabulary((items) => [created, ...items])
      setStatus('已保存词汇')
    } catch (error) {
      setStatus(`保存词汇失败：${error instanceof Error ? error.message : String(error)}`)
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

  return (
    <div className="app-shell">
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
            <button
              className="icon-button"
              disabled={!activeDocument || pageNumber <= 1}
              title="上一页"
              onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
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
              onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}
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
          </div>
        </header>

        <div className="reader-surface" onMouseUp={captureSelection} onWheel={handleReaderWheel}>
          {pdfFile ? (
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
                />
              </div>
            </Document>
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
            className="selection-toolbar"
            style={{
              left: selection.x,
              top: selection.y
            }}
          >
            <button title="高亮" onClick={() => void createAnnotation('highlight')}>
              <Highlighter size={16} />
              高亮
            </button>
            <button title="批注" onClick={() => void createAnnotation('note', draftNote || '待补充笔记')}>
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
          </div>
        )}
      </main>

      <aside className="inspector-panel">
        <nav className="tab-bar">
          <button className={activeTab === 'notes' ? 'active' : ''} onClick={() => setActiveTab('notes')}>
            <StickyNote size={16} />
            笔记
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
            draftNote={draftNote}
            hasDocument={Boolean(activeDocument)}
            onBookmark={() => void createAnnotation('bookmark')}
            onDelete={(id) => void deleteAnnotation(id)}
            onDraftNoteChange={setDraftNote}
            onSaveNote={() => void createAnnotation('note', draftNote || '空白页边注')}
          />
        )}

        {activeTab === 'ai' && (
          <AiPanel
            aiRun={aiRun}
            readyProvider={readyProvider}
            selection={selection?.text ?? null}
            onRun={(promptType) => void runAIAction(promptType)}
          />
        )}

        {activeTab === 'vocab' && (
          <VocabularyPanel
            hasDocument={Boolean(activeDocument)}
            vocabulary={vocabulary}
            onCreate={(word, definition) => void createVocabulary(word, definition)}
            onDelete={(id) => void deleteVocabulary(id)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            configuredProviderIds={configuredProviderIds}
            providers={providers}
            onClearKey={(providerId) => void clearProviderKey(providerId)}
            onSaveKey={(providerId, apiKey) => void saveProviderKey(providerId, apiKey)}
            onToggle={(provider, enabled) => void updateProvider(provider, enabled)}
          />
        )}
      </aside>
    </div>
  )
}

type NotesPanelProps = {
  annotations: AnnotationRecord[]
  draftNote: string
  hasDocument: boolean
  onBookmark: () => void
  onDelete: (id: string) => void
  onDraftNoteChange: (value: string) => void
  onSaveNote: () => void
}

function NotesPanel({
  annotations,
  draftNote,
  hasDocument,
  onBookmark,
  onDelete,
  onDraftNoteChange,
  onSaveNote
}: NotesPanelProps): JSX.Element {
  return (
    <div className="inspector-content">
      <div className="note-composer">
        <textarea
          disabled={!hasDocument}
          placeholder="写一条页边注..."
          value={draftNote}
          onChange={(event) => onDraftNoteChange(event.target.value)}
        />
        <div className="note-actions">
          <button disabled={!hasDocument} onClick={onSaveNote}>
            <MessageSquarePlus size={16} />
            保存笔记
          </button>
          <button disabled={!hasDocument} onClick={onBookmark}>
            <Bookmark size={16} />
            书签
          </button>
        </div>
      </div>

      <div className="annotation-list">
        {annotations.length === 0 ? (
          <p className="muted">高亮、批注和书签会出现在这里。</p>
        ) : (
          annotations.map((annotation) => (
            <article className="annotation-item" key={annotation.id}>
              <div className="annotation-meta">
                <span>{annotation.type}</span>
                <span>第 {annotation.pageNumber} 页</span>
              </div>
              {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
              {annotation.note && <p>{annotation.note}</p>}
              <button className="text-button" onClick={() => onDelete(annotation.id)}>
                <Trash2 size={14} />
                删除
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

type AiPanelProps = {
  aiRun: AIRunState | null
  readyProvider: AIProviderRecord | null
  selection: string | null
  onRun: (promptType: AIPromptType) => void
}

function AiPanel({ aiRun, readyProvider, selection, onRun }: AiPanelProps): JSX.Element {
  return (
    <div className="inspector-content">
      <div className="ai-ready">
        <Bot size={26} />
        <div>
          <h2>AI 阅读助手</h2>
          <p>
            {readyProvider
              ? `当前使用 ${readyProvider.label} / ${readyProvider.defaultModel}`
              : '请先在配置页为启用的 Provider 保存 API Key。'}
          </p>
        </div>
      </div>

      <div className="selected-preview">
        <strong>当前选区</strong>
        <p>{selection ?? aiRun?.inputText ?? '在 PDF 中选中一段文字后，可从浮动工具条触发 AI 动作。'}</p>
      </div>

      <div className="prompt-grid">
        <button disabled={!selection || !readyProvider} onClick={() => onRun('translate_selection')}>
          翻译选区
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('explain_selection')}>
          解释概念
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('summarize_selection')}>
          总结段落
        </button>
        <button disabled={!aiRun?.output}>已保存为笔记</button>
      </div>

      {aiRun && (
        <div className="ai-output">
          <div className="ai-output-heading">
            <strong>{promptLabels[aiRun.promptType]}</strong>
            <span>{aiRun.status === 'running' ? '生成中' : aiRun.status}</span>
          </div>
          {aiRun.error ? <p className="error-text">{aiRun.error}</p> : <pre>{aiRun.output || '等待模型返回...'}</pre>}
        </div>
      )}
    </div>
  )
}

type VocabularyPanelProps = {
  hasDocument: boolean
  vocabulary: VocabularyRecord[]
  onCreate: (word: string, definition: string) => void
  onDelete: (id: string) => void
}

function VocabularyPanel({
  hasDocument,
  vocabulary,
  onCreate,
  onDelete
}: VocabularyPanelProps): JSX.Element {
  const [word, setWord] = useState('')
  const [definition, setDefinition] = useState('')

  const save = (): void => {
    const nextWord = word.trim()
    const nextDefinition = definition.trim()

    if (!nextWord || !nextDefinition) {
      return
    }

    onCreate(nextWord, nextDefinition)
    setWord('')
    setDefinition('')
  }

  return (
    <div className="inspector-content">
      <div className="vocab-composer">
        <input
          disabled={!hasDocument}
          placeholder="单词或短语"
          value={word}
          onChange={(event) => setWord(event.target.value)}
        />
        <textarea
          disabled={!hasDocument}
          placeholder="释义、用法或你的理解"
          value={definition}
          onChange={(event) => setDefinition(event.target.value)}
        />
        <button disabled={!hasDocument || !word.trim() || !definition.trim()} onClick={save}>
          <BookMarked size={16} />
          保存词汇
        </button>
      </div>

      <div className="vocabulary-list">
        {vocabulary.length === 0 ? (
          <p className="muted">选中 PDF 里的单词或短语后点“生词”，也可以在这里手动添加。</p>
        ) : (
          vocabulary.map((item) => (
            <article className="vocabulary-item" key={item.id}>
              <div className="vocabulary-heading">
                <strong>{item.word}</strong>
                {item.pageNumber && <span>第 {item.pageNumber} 页</span>}
              </div>
              <p>{item.definition}</p>
              {item.sourceSentence && <blockquote>{item.sourceSentence}</blockquote>}
              <button className="text-button" onClick={() => onDelete(item.id)}>
                <Trash2 size={14} />
                删除
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

type SettingsPanelProps = {
  configuredProviderIds: Set<string>
  providers: AIProviderRecord[]
  onClearKey: (providerId: string) => void
  onSaveKey: (providerId: string, apiKey: string) => void
  onToggle: (provider: AIProviderRecord, enabled: boolean) => void
}

function SettingsPanel({
  configuredProviderIds,
  providers,
  onClearKey,
  onSaveKey,
  onToggle
}: SettingsPanelProps): JSX.Element {
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})

  return (
    <div className="inspector-content">
      <div className="settings-intro">
        <h2>AI Provider</h2>
        <p>API Key 会在主进程通过 Electron safeStorage 加密保存，页面只显示是否已配置。</p>
      </div>

      <div className="provider-list">
        {providers.map((provider) => {
          const configured = configuredProviderIds.has(provider.id)

          return (
            <article className="provider-item" key={provider.id}>
              <div className="provider-heading">
                <div>
                  <strong>{provider.label}</strong>
                  <span>{provider.defaultModel}</span>
                </div>
                <label className="switch">
                  <input
                    checked={provider.enabled}
                    type="checkbox"
                    onChange={(event) => onToggle(provider, event.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <code>{provider.baseUrl}</code>
              <div className="provider-tags">
                {provider.supportsThinking && <span>thinking</span>}
                {provider.supportsLongContext && <span>long context</span>}
                <span className={configured ? 'tag-ok' : 'tag-warn'}>
                  <KeyRound size={12} />
                  {configured ? 'key saved' : 'no key'}
                </span>
              </div>
              <div className="key-row">
                <input
                  placeholder={configured ? '输入新 Key 可覆盖当前保存值' : '粘贴 API Key'}
                  type="password"
                  value={draftKeys[provider.id] ?? ''}
                  onChange={(event) =>
                    setDraftKeys((items) => ({ ...items, [provider.id]: event.target.value }))
                  }
                />
                <button
                  disabled={!draftKeys[provider.id]?.trim()}
                  onClick={() => {
                    onSaveKey(provider.id, draftKeys[provider.id] ?? '')
                    setDraftKeys((items) => ({ ...items, [provider.id]: '' }))
                  }}
                >
                  保存
                </button>
                <button disabled={!configured} onClick={() => onClearKey(provider.id)}>
                  清除
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default App
