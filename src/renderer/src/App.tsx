import { useEffect, useMemo, useState } from 'react'
import { Document, Page } from 'react-pdf'
import {
  Bookmark,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
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
  AnnotationRecord,
  DocumentRecord,
  OpenPdfResult
} from '../../shared/types'

type PanelTab = 'notes' | 'ai' | 'settings'

type SelectionState = {
  text: string
  x: number
  y: number
}

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

const decodePdfData = (data: ArrayBuffer): Uint8Array => new Uint8Array(data)

function App(): JSX.Element {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const [providers, setProviders] = useState<AIProviderRecord[]>([])
  const [activeTab, setActiveTab] = useState<PanelTab>('notes')
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.08)
  const [draftNote, setDraftNote] = useState('')
  const [status, setStatus] = useState('打开一本 PDF 开始阅读')

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.pageNumber === pageNumber),
    [annotations, pageNumber]
  )

  useEffect(() => {
    void refreshLibrary()
    void refreshProviders()
  }, [])

  const refreshLibrary = async (): Promise<void> => {
    const list = await window.readingPartner.listDocuments()
    setDocuments(list)
  }

  const refreshProviders = async (): Promise<void> => {
    const list = await window.readingPartner.listAIProviders()
    setProviders(list)
  }

  const refreshAnnotations = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listAnnotations(documentId)
    setAnnotations(list)
  }

  const loadDocument = async (document: DocumentRecord): Promise<void> => {
    setStatus(`正在打开 ${document.title}`)
    const data = await window.readingPartner.readPdf(document.id)
    setActiveDocument(document)
    setPdfData(decodePdfData(data))
    setPageNumber(1)
    setSelection(null)
    await refreshAnnotations(document.id)
    setStatus(`已打开 ${document.title}`)
  }

  const openPdf = async (): Promise<void> => {
    const result: OpenPdfResult | null = await window.readingPartner.openPdfDialog()

    if (!result) {
      return
    }

    setActiveDocument(result.document)
    setPdfData(decodePdfData(result.data))
    setPageNumber(1)
    setSelection(null)
    await Promise.all([refreshLibrary(), refreshAnnotations(result.document.id)])
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

    const sourceText = selection?.text ?? null
    const created = await window.readingPartner.createAnnotation({
      documentId: activeDocument.id,
      type,
      pageNumber,
      selectedText: sourceText,
      color: type === 'bookmark' ? null : color,
      note: note ?? null
    })

    setAnnotations((items) => [...items, created])
    setSelection(null)
    setDraftNote('')
    setStatus(type === 'bookmark' ? '已添加书签' : '已保存批注')
  }

  const createAiPlaceholder = async (promptType: string): Promise<void> => {
    if (!activeDocument || !selection) {
      return
    }

    const labelMap: Record<string, string> = {
      translate: '翻译',
      explain: '解释',
      summarize: '总结'
    }

    const created = await window.readingPartner.createAnnotation({
      documentId: activeDocument.id,
      type: 'note',
      pageNumber,
      selectedText: selection.text,
      color: '#c7d2fe',
      note: `AI ${labelMap[promptType] ?? '处理'}待接入：${selection.text.slice(0, 160)}`
    })

    setAnnotations((items) => [...items, created])
    setActiveTab('ai')
    setSelection(null)
    setStatus('已创建 AI 动作占位笔记，下一阶段接入流式模型调用')
  }

  const deleteAnnotation = async (id: string): Promise<void> => {
    await window.readingPartner.deleteAnnotation(id)
    setAnnotations((items) => items.filter((item) => item.id !== id))
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
              onClick={() => setScale((value) => Math.max(0.75, value - 0.1))}
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!activeDocument}
              title="放大"
              onClick={() => setScale((value) => Math.min(1.8, value + 0.1))}
            >
              <Plus size={18} />
            </button>
          </div>
        </header>

        <div className="reader-surface" onMouseUp={captureSelection}>
          {pdfData ? (
            <Document
              file={{ data: pdfData }}
              loading={<div className="empty-state">正在解析 PDF...</div>}
              onLoadSuccess={({ numPages }) => {
                setPageCount(numPages)
                setStatus(`共 ${numPages} 页`)
              }}
            >
              <div className="pdf-page-frame">
                <Page
                  pageNumber={pageNumber}
                  renderAnnotationLayer
                  renderTextLayer
                  scale={scale}
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
            <button title="翻译" onClick={() => void createAiPlaceholder('translate')}>
              <Languages size={16} />
              翻译
            </button>
            <button title="解释" onClick={() => void createAiPlaceholder('explain')}>
              <Sparkles size={16} />
              解释
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

        {activeTab === 'ai' && <AiPanel selection={selection?.text ?? null} />}

        {activeTab === 'settings' && (
          <SettingsPanel providers={providers} onToggle={(provider, enabled) => void updateProvider(provider, enabled)} />
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

function AiPanel({ selection }: { selection: string | null }): JSX.Element {
  return (
    <div className="inspector-content">
      <div className="ai-ready">
        <Bot size={26} />
        <div>
          <h2>AI 阅读助手</h2>
          <p>当前版本已经预留选区翻译、解释、总结的动作入口。下一步会把调用放到主进程并支持流式输出。</p>
        </div>
      </div>
      <div className="selected-preview">
        <strong>当前选区</strong>
        <p>{selection ?? '在 PDF 中选中一段文字后，可从浮动工具条触发 AI 动作。'}</p>
      </div>
      <div className="prompt-grid">
        <button disabled={!selection}>翻译选区</button>
        <button disabled={!selection}>解释概念</button>
        <button disabled={!selection}>总结段落</button>
        <button disabled={!selection}>生成笔记</button>
      </div>
    </div>
  )
}

type SettingsPanelProps = {
  providers: AIProviderRecord[]
  onToggle: (provider: AIProviderRecord, enabled: boolean) => void
}

function SettingsPanel({ providers, onToggle }: SettingsPanelProps): JSX.Element {
  return (
    <div className="inspector-content">
      <div className="settings-intro">
        <h2>AI Provider</h2>
        <p>这里先保存国内常用 OpenAI-compatible Provider 的基础配置。API Key 安全存储和真实请求在下一阶段接入。</p>
      </div>

      <div className="provider-list">
        {providers.map((provider) => (
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
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export default App

