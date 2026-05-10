import type { CSSProperties } from 'react'
import type { OcrPageLayout } from '../../../shared/types'

type OcrTextLayerProps = {
  layout: OcrPageLayout | null
  scale: number
}

export function OcrTextLayer({ layout, scale }: OcrTextLayerProps): JSX.Element | null {
  if (!layout || layout.lines.length === 0) {
    return null
  }

  return (
    <div className="ocr-text-layer" aria-label="OCR text layer">
      {layout.lines.map((line, index) => {
        const style: CSSProperties = {
          left: line.left * scale,
          top: line.top * scale,
          width: line.width * scale,
          height: line.height * scale,
          fontSize: Math.max(6, line.height * scale * 0.92),
          lineHeight: `${Math.max(6, line.height * scale)}px`
        }

        return (
          <span className="ocr-text-line" key={`${layout.pageNumber}-${index}`} style={style}>
            {line.text}
          </span>
        )
      })}
    </div>
  )
}

