import { annotationScopes } from '../../../shared/types'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { X } from 'lucide-react'
import type { AnnotationRecord } from '../../../shared/types'
import type { AnnotationRect } from '../annotationGeometry'
import { normalizeAnnotationRects } from '../annotationGeometry'
import { MarkdownContent } from './MarkdownContent'
import { formatTime, getAnnotationPreview } from './NotesPanel'

export type AnnotationInteractionMode = 'inspect' | 'select'

export type TemporarySearchHighlight = {
  id: string
  pageNumber: number
  text: string
  rects: AnnotationRect[]
}

type HoveredAnnotation = {
  annotation: AnnotationRecord
  x: number
  y: number
  maxHeight: number
  placementY: 'above' | 'below'
}

const tooltipOffset = 14
const tooltipMargin = 10
const estimatedTooltipWidth = 280
const estimatedTooltipHeight = 340

const parseAnnotationRects = (rectsJson: string | null): AnnotationRect[] => {
  if (!rectsJson) {
    return []
  }

  try {
    const parsed = JSON.parse(rectsJson) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    const rects = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const rect = item as Partial<Record<keyof AnnotationRect, unknown>>
        const left = Number(rect.left)
        const top = Number(rect.top)
        const width = Number(rect.width)
        const height = Number(rect.height)

        if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          return null
        }

        return { left, top, width, height }
      })
      .filter((item): item is AnnotationRect => Boolean(item))

    return normalizeAnnotationRects(rects)
  } catch {
    return []
  }
}

const hexToRgba = (value: string | null | undefined, alpha: number): string => {
  const color = value?.trim() || '#f8d86a'
  const normalized = color.startsWith('#') ? color.slice(1) : color
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(248, 216, 106, ${alpha})`
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16)
  const green = Number.parseInt(expanded.slice(2, 4), 16)
  const blue = Number.parseInt(expanded.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const getTooltipPosition = (
  event: { currentTarget: Element; clientX: number; clientY: number },
  layerRect: DOMRect | undefined
): { x: number; y: number; maxHeight: number; placementY: HoveredAnnotation['placementY'] } => {
  if (!layerRect) {
    return {
      x: tooltipOffset,
      y: tooltipOffset,
      maxHeight: estimatedTooltipHeight,
      placementY: 'below'
    }
  }

  const readerRect = event.currentTarget
    .closest('.reader-surface')
    ?.getBoundingClientRect()
  const visibleLeft = readerRect
    ? Math.max(tooltipMargin, readerRect.left - layerRect.left + tooltipMargin)
    : tooltipMargin
  const visibleTop = readerRect
    ? Math.max(tooltipMargin, readerRect.top - layerRect.top + tooltipMargin)
    : tooltipMargin
  const visibleRight = readerRect
    ? Math.min(layerRect.width - tooltipMargin, readerRect.right - layerRect.left - tooltipMargin)
    : layerRect.width - tooltipMargin
  const visibleBottom = readerRect
    ? Math.min(layerRect.height - tooltipMargin, readerRect.bottom - layerRect.top - tooltipMargin)
    : layerRect.height - tooltipMargin
  const anchorX = event.clientX - layerRect.left
  const anchorY = event.clientY - layerRect.top
  const availableAbove = Math.max(0, anchorY - tooltipOffset - visibleTop)
  const availableBelow = Math.max(0, visibleBottom - anchorY - tooltipOffset)
  const hasRoomRight = anchorX + tooltipOffset + estimatedTooltipWidth <= visibleRight
  const placementY =
    availableBelow >= Math.min(estimatedTooltipHeight, 180) || availableBelow >= availableAbove
      ? 'below'
      : 'above'
  const preferredX = hasRoomRight
    ? anchorX + tooltipOffset
    : anchorX - estimatedTooltipWidth - tooltipOffset
  const preferredY = placementY === 'below'
    ? anchorY + tooltipOffset
    : anchorY - tooltipOffset
  const maxHeight = Math.max(
    96,
    Math.min(
      estimatedTooltipHeight,
      placementY === 'below' ? availableBelow : availableAbove
    )
  )

  return {
    x: clamp(preferredX, visibleLeft, Math.max(visibleLeft, visibleRight - estimatedTooltipWidth)),
    y: clamp(preferredY, visibleTop, visibleBottom),
    maxHeight,
    placementY
  }
}

export function AnnotationOverlay({
  focus,
  onDismissFocus,
  annotations,
  interactionMode,
  scale,
  temporaryHighlight
}: {
  focus: AnnotationRecord | null
  onDismissFocus: () => void
  annotations: AnnotationRecord[]
  interactionMode: AnnotationInteractionMode
  scale: number
  temporaryHighlight: TemporarySearchHighlight | null
}): JSX.Element {
  const [hoveredAnnotation, setHoveredAnnotation] = useState<HoveredAnnotation | null>(null)
  const [pinnedAnnotation, setPinnedAnnotation] = useState<HoveredAnnotation | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const canInspect = interactionMode === 'inspect'
  const visualItems = annotations.map((annotation) => ({
    annotation,
    rects: parseAnnotationRects(annotation.rectsJson)
  }))
  const pageMarkers = visualItems.filter(({ annotation, rects }) => annotation.scope === 'margin' || annotation.type === 'bookmark' || rects.length === 0)

  useEffect(() => {
    if (!canInspect) {
      setHoveredAnnotation(null)
      setPinnedAnnotation(null)
      return
    }

    if (
      pinnedAnnotation &&
      !annotations.some((annotation) => annotation.id === pinnedAnnotation.annotation.id)
    ) {
      setPinnedAnnotation(null)
    }
  }, [annotations, canInspect, pinnedAnnotation])

  // The exact text rectangle may arrive after PDF.js has rendered the page.
  // Until then the page marker is a valid anchor, including for image-only pages.
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!focus || !canInspect || !layer) return
    const anchor = layer.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(focus.id)}"]`)
    const surface = layer.closest<HTMLElement>('.reader-surface')
    if (!anchor || !surface) return
    const positionPopup = () => {
      if (!layer.clientHeight || !surface.clientHeight) return
      const viewport = surface.getBoundingClientRect()
      const before = anchor.getBoundingClientRect()
      surface.scrollTop += before.top - viewport.top - surface.clientHeight / 3
      if (before.left < viewport.left || before.left >= viewport.right - 16) {
        surface.scrollLeft += before.left - viewport.left - surface.clientWidth / 2
      }
      const rect = anchor.getBoundingClientRect()
      const point = { currentTarget: anchor, clientX: rect.left + Math.min(12, rect.width / 2), clientY: rect.bottom }
      setHoveredAnnotation(null)
      setPinnedAnnotation({ annotation: focus, ...getTooltipPosition(point, layer.getBoundingClientRect()) })
    }
    const observer = new ResizeObserver(positionPopup)
    observer.observe(layer)
    return () => observer.disconnect()
  }, [focus, annotations, canInspect, scale])

  useEffect(() => {
    if (!pinnedAnnotation && !focus) return
    const dismiss = () => {
      setPinnedAnnotation(null)
      setHoveredAnnotation(null)
      onDismissFocus()
    }
    const outside = (event: Event) => {
      if (event.target instanceof Element && !event.target.closest('.pdf-annotation-tooltip, [data-annotation-id]')) dismiss()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    document.addEventListener('click', outside, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', outside, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinnedAnnotation, focus, onDismissFocus])

  const showTooltip = (annotation: AnnotationRecord, event: ReactMouseEvent): void => {
    if (!canInspect) {
      return
    }

    const layerRect = event.currentTarget
      .closest('.pdf-annotation-layer')
      ?.getBoundingClientRect()
    const position = getTooltipPosition(event, layerRect)

    setHoveredAnnotation({
      annotation,
      x: position.x,
      y: position.y,
      maxHeight: position.maxHeight,
      placementY: position.placementY
    })
  }
  const pinTooltip = (annotation: AnnotationRecord, event: ReactMouseEvent): void => {
    if (!canInspect) {
      return
    }

    onDismissFocus()
    event.preventDefault()
    event.stopPropagation()
    const layerRect = event.currentTarget
      .closest('.pdf-annotation-layer')
      ?.getBoundingClientRect()
    const position = getTooltipPosition(event, layerRect)

    setPinnedAnnotation({
      annotation,
      x: position.x,
      y: position.y,
      maxHeight: position.maxHeight,
      placementY: position.placementY
    })
  }
  const hideTooltip = (): void => setHoveredAnnotation(null)
  const visibleTooltip = pinnedAnnotation ?? hoveredAnnotation

  return (
    <div
      ref={layerRef}
      className={canInspect ? 'pdf-annotation-layer is-inspecting' : 'pdf-annotation-layer is-selecting'}
      aria-hidden={!canInspect}
    >
      {visualItems.flatMap(({ annotation, rects }) =>
        rects.map((rect, rectIndex) => {
          const isVocabulary = Boolean(annotation.vocabularyId || annotation.scope === 'vocabulary')
          const verticalInset = annotation.type === 'highlight' ? Math.min(3, rect.height * scale * 0.18) : 0
          const top = rect.top * scale + verticalInset
          const height = Math.max(2, rect.height * scale - verticalInset * 2)
          const style: CSSProperties = {
            left: rect.left * scale,
            top,
            width: rect.width * scale,
            height,
            backgroundColor:
              isVocabulary
                ? 'transparent'
                : annotation.type === 'highlight'
                ? hexToRgba(annotation.color, 0.44)
                : hexToRgba(annotation.color ?? '#6aa7f8', 0.24),
            borderColor: annotation.color ?? (annotation.type === 'note' ? '#3f7fc8' : '#d6ad22')
          }

          return (
            <span
              className={`pdf-annotation-rect is-${annotation.type}${isVocabulary ? ' is-vocabulary' : ''}`}
              key={`${annotation.id}-${rectIndex}`}
              data-annotation-id={annotation.id}
              onMouseEnter={(event) => showTooltip(annotation, event)}
              onMouseMove={(event) => showTooltip(annotation, event)}
              onMouseLeave={hideTooltip}
              onClick={(event) => pinTooltip(annotation, event)}
              style={style}
            />
          )
        })
      )}

      {visualItems
        .filter(({ annotation, rects }) => annotation.type === 'note' && annotation.scope !== 'margin' && !annotation.vocabularyId && annotation.scope !== 'vocabulary' && rects.length > 0)
        .map(({ annotation, rects }) => {
          const firstRect = rects[0]

          return (
            <span
              className="pdf-annotation-pin is-note"
              key={`${annotation.id}-pin`}
              data-annotation-id={annotation.id}
              onMouseEnter={(event) => showTooltip(annotation, event)}
              onMouseMove={(event) => showTooltip(annotation, event)}
              onMouseLeave={hideTooltip}
              onClick={(event) => pinTooltip(annotation, event)}
              style={{
                left: (firstRect.left + firstRect.width) * scale + 6,
                top: firstRect.top * scale
              }}
            />
          )
        })}

      {pageMarkers.map(({ annotation }, index) => (
        <span
          className={`pdf-page-marker is-${annotation.type}`}
          key={`${annotation.id}-marker`}
          data-annotation-id={annotation.id}
          onMouseEnter={(event) => showTooltip(annotation, event)}
          onMouseMove={(event) => showTooltip(annotation, event)}
          onMouseLeave={hideTooltip}
          onClick={(event) => pinTooltip(annotation, event)}
          style={{
            top: 12 + index * 30,
            backgroundColor: annotation.color ?? undefined
          }}
        />
      ))}
      {temporaryHighlight?.rects.map((rect, rectIndex) => {
        const verticalInset = Math.min(4, rect.height * scale * 0.16)

        return (
          <span
            className="pdf-annotation-rect is-search-target"
            key={`${temporaryHighlight.id}-${rectIndex}`}
            style={{
              left: rect.left * scale,
              top: rect.top * scale + verticalInset,
              width: rect.width * scale,
              height: Math.max(3, rect.height * scale - verticalInset * 2)
            }}
          />
        )
      })}
      {canInspect && visibleTooltip && (
        <div
          className={[
            'pdf-annotation-tooltip',
            pinnedAnnotation ? 'is-pinned' : '',
            visibleTooltip.placementY === 'above' ? 'is-above' : 'is-below'
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            left: visibleTooltip.x,
            top: visibleTooltip.y,
            maxHeight: visibleTooltip.maxHeight
          }}
        >
          <div className="pdf-annotation-tooltip-heading">
            <strong>
              {visibleTooltip.annotation.scope ? annotationScopes[visibleTooltip.annotation.scope] : visibleTooltip.annotation.vocabularyId
                ? '生词'
                : visibleTooltip.annotation.type === 'highlight'
                ? '高亮'
                : visibleTooltip.annotation.type === 'note'
                  ? '批注'
                  : '书签'}
            </strong>
            {pinnedAnnotation && (
              <button
                type="button"
                title="关闭批注浮窗"
                onClick={() => { setPinnedAnnotation(null); setHoveredAnnotation(null); onDismissFocus() }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <time>{formatTime(visibleTooltip.annotation.createdAt)}</time>
          <span className="annotation-tooltip-author">
            {visibleTooltip.annotation.authorName || 'Reader'}
          </span>
          {visibleTooltip.annotation.note ? (
            <MarkdownContent text={visibleTooltip.annotation.note} />
          ) : (
            <p>{getAnnotationPreview(visibleTooltip.annotation)}</p>
          )}
        </div>
      )}
    </div>
  )
}
