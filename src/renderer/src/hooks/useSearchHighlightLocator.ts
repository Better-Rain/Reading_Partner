import type { RefObject } from 'react'
import { useEffect } from 'react'
import type { DocumentSearchResult } from '../../../shared/types'
import type { TemporarySearchHighlight } from '../components/AnnotationOverlay'
import {
  buildTextLayerSearchIndex,
  findSearchMatch,
  rectsFromTextLayerMatch
} from '../pdfSearchHighlight'

export type ActiveSearchTarget = {
  nonce: number
  query: string
  result: DocumentSearchResult
}

type SearchHighlightLocatorOptions = {
  activeSearchTarget: ActiveSearchTarget | null
  pageNumber: number
  readerSurfaceRef: RefObject<HTMLDivElement | null>
  scale: number
  onHighlightChange: (highlight: TemporarySearchHighlight | null) => void
  onStatusChange: (status: string) => void
}

export const useSearchHighlightLocator = ({
  activeSearchTarget,
  pageNumber,
  readerSurfaceRef,
  scale,
  onHighlightChange,
  onStatusChange
}: SearchHighlightLocatorOptions): void => {
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
        onHighlightChange({
          id: `search-${activeSearchTarget.result.id}-${activeSearchTarget.nonce}`,
          pageNumber: activeSearchTarget.result.pageNumber,
          text: activeSearchTarget.result.snippet,
          rects
        })
        onStatusChange(`已定位第 ${activeSearchTarget.result.pageNumber} 页的搜索片段`)
        return
      }

      if (attempt < 14) {
        retryTimer = window.setTimeout(() => locateSearchTarget(attempt + 1), 80)
      } else {
        onHighlightChange(null)
        onStatusChange(`已跳转到第 ${activeSearchTarget.result.pageNumber} 页，但未能自动定位文字坐标`)
      }
    }

    onHighlightChange(null)
    retryTimer = window.setTimeout(() => locateSearchTarget(), 0)

    return () => {
      cancelled = true

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [
    activeSearchTarget,
    onHighlightChange,
    onStatusChange,
    pageNumber,
    readerSurfaceRef,
    scale
  ])
}
