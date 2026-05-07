import { Bookmark, FileText, Upload } from 'lucide-react'
import type { DocumentRecord } from '../../../shared/types'
import { formatTime } from './NotesPanel'

type LibraryPanelProps = {
  activeDocumentId: string | null
  currentPageAnnotationCount: number
  documents: DocumentRecord[]
  pageNumber: number
  onLoadDocument: (document: DocumentRecord) => void
  onOpenPdf: () => void
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function LibraryPanel({
  activeDocumentId,
  currentPageAnnotationCount,
  documents,
  pageNumber,
  onLoadDocument,
  onOpenPdf
}: LibraryPanelProps): JSX.Element {
  return (
    <aside className="library-panel">
      <div className="brand">
        <div className="brand-mark">RP</div>
        <div>
          <h1>Reading Partner</h1>
          <p>AI assisted PDF workspace</p>
        </div>
      </div>

      <button className="primary-action" onClick={onOpenPdf}>
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
                className={document.id === activeDocumentId ? 'document-item active' : 'document-item'}
                key={document.id}
                onClick={() => onLoadDocument(document)}
                title={document.title}
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
          <strong>{activeDocumentId ? `第 ${pageNumber} 页` : '未打开文档'}</strong>
          <span>{currentPageAnnotationCount} 条批注</span>
        </div>
      </section>
    </aside>
  )
}
