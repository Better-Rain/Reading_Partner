import type { RefObject, MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import { Document, Page } from 'react-pdf'
import { FileText, Upload } from 'lucide-react'
import type { AnnotationRecord } from '../../../shared/types'
import {
  AnnotationInteractionMode,
  AnnotationOverlay,
  TemporarySearchHighlight
} from './AnnotationOverlay'

type ReaderSurfaceProps = {
  annotations: AnnotationRecord[]
  file: Source | null
  interactionMode: AnnotationInteractionMode
  isPanMode: boolean
  isPanning: boolean
  pageNumber: number
  pdfError: string | null
  readerSurfaceRef: RefObject<HTMLDivElement | null>
  scale: number
  temporaryHighlight: TemporarySearchHighlight | null
  onCaptureSelection: () => void
  onDocumentLoadError: (message: string) => void
  onDocumentLoadSuccess: (pageCount: number) => void
  onDocumentSourceError: (message: string) => void
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onOpenPdf: () => void
  onPageLoadError: (message: string) => void
  onPageRenderSuccess: () => void
  onStopPan: () => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
}

export function ReaderSurface({
  annotations,
  file,
  interactionMode,
  isPanMode,
  isPanning,
  pageNumber,
  pdfError,
  readerSurfaceRef,
  scale,
  temporaryHighlight,
  onCaptureSelection,
  onDocumentLoadError,
  onDocumentLoadSuccess,
  onDocumentSourceError,
  onMouseDown,
  onOpenPdf,
  onPageLoadError,
  onPageRenderSuccess,
  onStopPan,
  onWheel
}: ReaderSurfaceProps): JSX.Element {
  return (
    <div
      className={['reader-surface', isPanMode ? 'pan-enabled' : '', isPanning ? 'is-panning' : '']
        .filter(Boolean)
        .join(' ')}
      ref={readerSurfaceRef}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
        }
      }}
      onMouseUp={onCaptureSelection}
      onMouseDown={onMouseDown}
      onMouseLeave={() => {
        if (!isPanning) {
          onStopPan()
        }
      }}
      onWheel={onWheel}
    >
      {file ? (
        <div className="pdf-stage">
          <Document
            file={file}
            error={
              <div className="empty-state error-state">
                <FileText size={44} />
                <h2>PDF 打开失败</h2>
                <p>{pdfError ?? 'PDF.js 无法加载这个文件。'}</p>
              </div>
            }
            loading={<div className="empty-state">正在解析 PDF...</div>}
            onLoadError={(error) => onDocumentLoadError(error.message)}
            onLoadSuccess={({ numPages }) => onDocumentLoadSuccess(numPages)}
            onSourceError={(error) => onDocumentSourceError(error.message)}
          >
            <div className="pdf-page-frame">
              <Page
                pageNumber={pageNumber}
                renderAnnotationLayer
                renderTextLayer
                scale={scale}
                onLoadError={(error) => onPageLoadError(error.message)}
                onRenderSuccess={onPageRenderSuccess}
              />
              <AnnotationOverlay
                annotations={annotations}
                interactionMode={interactionMode}
                scale={scale}
                temporaryHighlight={temporaryHighlight}
              />
            </div>
          </Document>
        </div>
      ) : (
        <div className="empty-state">
          <FileText size={44} />
          <h2>打开一本 PDF</h2>
          <p>导入文献后，可以在这里阅读、划词、高亮、批注，并把 AI 解释保存回笔记。</p>
          <button className="primary-action compact" onClick={onOpenPdf}>
            <Upload size={18} />
            选择 PDF
          </button>
        </div>
      )}
    </div>
  )
}
