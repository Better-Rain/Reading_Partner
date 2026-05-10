import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Files,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  ScanText,
  X
} from 'lucide-react'
import type { AnnotationColorPreset } from './NotesPanel'
import type { AnnotationInteractionMode } from './AnnotationOverlay'

type ReaderToolbarProps = {
  annotationInteractionMode: AnnotationInteractionMode
  colorPresets: AnnotationColorPreset[]
  hasDocument: boolean
  isOcrRunning: boolean
  isPanMode: boolean
  pageCount: number
  pageNumber: number
  selectedAnnotationColor: string
  status: string
  isTextIndexing: boolean
  title: string
  onAnnotationInteractionModeChange: (mode: AnnotationInteractionMode) => void
  onCancelOcr: () => void
  onColorChange: (color: string) => void
  onNextPage: () => void
  onOcrCurrentPage: () => void
  onOcrDocument: () => void
  onPageNumberChange: (pageNumber: number) => void
  onPreviousPage: () => void
  onCancelTextIndex: () => void
  onTogglePanMode: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function ReaderToolbar({
  annotationInteractionMode,
  colorPresets,
  hasDocument,
  isOcrRunning,
  isPanMode,
  pageCount,
  pageNumber,
  selectedAnnotationColor,
  status,
  isTextIndexing,
  title,
  onAnnotationInteractionModeChange,
  onCancelOcr,
  onColorChange,
  onNextPage,
  onOcrCurrentPage,
  onOcrDocument,
  onPageNumberChange,
  onPreviousPage,
  onCancelTextIndex,
  onTogglePanMode,
  onZoomIn,
  onZoomOut
}: ReaderToolbarProps): JSX.Element {
  const statusViewportRef = useRef<HTMLSpanElement | null>(null)
  const statusTextRef = useRef<HTMLSpanElement | null>(null)
  const [statusOverflows, setStatusOverflows] = useState(false)

  useEffect(() => {
    const viewport = statusViewportRef.current
    const text = statusTextRef.current

    if (!viewport || !text) {
      return
    }

    const updateOverflow = (): void => {
      setStatusOverflows(text.scrollWidth > viewport.clientWidth + 2)
    }
    const observer = new ResizeObserver(updateOverflow)

    updateOverflow()
    observer.observe(viewport)
    observer.observe(text)

    return () => observer.disconnect()
  }, [status])

  return (
    <header className="reader-toolbar">
      <div className="reader-toolbar-title">
        <strong>{title}</strong>
        <span
          className={statusOverflows ? 'reader-toolbar-status is-overflowing' : 'reader-toolbar-status'}
          ref={statusViewportRef}
          title={status}
        >
          <span className="reader-toolbar-status-track">
            <span className="reader-toolbar-status-text" ref={statusTextRef}>
              {status}
            </span>
            {statusOverflows && (
              <span className="reader-toolbar-status-text" aria-hidden="true">
                {status}
              </span>
            )}
          </span>
        </span>
      </div>
      <div className="toolbar-controls">
        <div className="annotation-mode-toggle" aria-label="批注交互模式">
          <button
            className={annotationInteractionMode === 'inspect' ? 'active' : ''}
            disabled={!hasDocument}
            title="查看批注"
            onClick={() => onAnnotationInteractionModeChange('inspect')}
          >
            <Eye size={15} />
            查看
          </button>
          <button
            className={annotationInteractionMode === 'select' ? 'active' : ''}
            disabled={!hasDocument}
            title="文本选择"
            onClick={() => onAnnotationInteractionModeChange('select')}
          >
            <MousePointer2 size={15} />
            选择
          </button>
        </div>
        <div className="reader-color-palette" aria-label="批注颜色">
          {colorPresets.map((preset) => (
            <button
              className={selectedAnnotationColor === preset.value ? 'color-swatch active' : 'color-swatch'}
              disabled={!hasDocument}
              key={preset.value}
              onClick={() => onColorChange(preset.value)}
              style={{ backgroundColor: preset.value }}
              title={`批注颜色：${preset.label}`}
            />
          ))}
        </div>
        <button
          className="icon-button"
          disabled={!hasDocument || pageNumber <= 1}
          title="上一页"
          onClick={onPreviousPage}
        >
          <ChevronLeft size={18} />
        </button>
        <label className="page-input">
          <input
            disabled={!hasDocument}
            max={pageCount || 1}
            min={1}
            type="number"
            value={pageNumber}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) {
                onPageNumberChange(Math.min(Math.max(1, next), pageCount || 1))
              }
            }}
          />
          <span>/ {pageCount || '-'}</span>
        </label>
        <button
          className="icon-button"
          disabled={!hasDocument || pageNumber >= pageCount}
          title="下一页"
          onClick={onNextPage}
        >
          <ChevronRight size={18} />
        </button>
        <button className="icon-button" disabled={!hasDocument} title="缩小" onClick={onZoomOut}>
          <Minus size={18} />
        </button>
        <button className="icon-button" disabled={!hasDocument} title="放大" onClick={onZoomIn}>
          <Plus size={18} />
        </button>
        <button
          className={isPanMode ? 'icon-button active' : 'icon-button'}
          disabled={!hasDocument}
          title="手型拖动 (D)"
          onClick={onTogglePanMode}
        >
          <Hand size={18} />
        </button>
        <button
          className={isOcrRunning ? 'icon-button active' : 'icon-button'}
          disabled={!hasDocument || isOcrRunning || isTextIndexing}
          title="OCR 当前页"
          onClick={onOcrCurrentPage}
        >
          <ScanText size={18} />
        </button>
        <button
          className={isOcrRunning ? 'icon-button active' : 'icon-button'}
          disabled={!hasDocument || isOcrRunning || isTextIndexing}
          title="OCR 全文"
          onClick={onOcrDocument}
        >
          <Files size={18} />
        </button>
        {isOcrRunning && (
          <button className="icon-button" title="取消 OCR" onClick={onCancelOcr}>
            <X size={18} />
          </button>
        )}
        {isTextIndexing && (
          <button className="icon-button" title="取消文本索引" onClick={onCancelTextIndex}>
            <X size={18} />
          </button>
        )}
      </div>
    </header>
  )
}
