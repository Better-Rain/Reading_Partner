import type { DocumentSearchResult } from '../../shared/types'
import { AnnotationRect, normalizeAnnotationRects } from './annotationGeometry'

type TextLayerPosition = {
  node: Text
  offset: number
}

type TextLayerSearchIndex = {
  text: string
  positions: TextLayerPosition[]
}

type TextLayerSearchMatch = {
  start: number
  end: number
}

const roundRectValue = (value: number): number => Number(value.toFixed(2))

const isSearchTextChar = (value: string): boolean => /^[\p{L}\p{N}]$/u.test(value)

const normalizeSearchText = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getSearchTerms = (query: string): string[] =>
  Array.from(new Set(normalizeSearchText(query).split(' ').filter(Boolean))).slice(0, 8)

export const buildTextLayerSearchIndex = (textLayer: HTMLElement): TextLayerSearchIndex => {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  let text = ''
  const positions: TextLayerPosition[] = []
  let node = walker.nextNode() as Text | null

  const appendSpace = (position: TextLayerPosition): void => {
    if (text && !text.endsWith(' ')) {
      text += ' '
      positions.push(position)
    }
  }

  while (node) {
    const value = node.nodeValue ?? ''

    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value[offset]
      const position = { node, offset }

      if (isSearchTextChar(char)) {
        text += char.toLocaleLowerCase()
        positions.push(position)
      } else {
        appendSpace(position)
      }
    }

    node = walker.nextNode() as Text | null
  }

  return {
    text,
    positions
  }
}

const findAnchoredSearchMatch = (
  pageText: string,
  candidateText: string,
  terms: string[]
): TextLayerSearchMatch | null => {
  const normalizedCandidate = normalizeSearchText(candidateText)

  if (!normalizedCandidate) {
    return null
  }

  const exactStart = normalizedCandidate.length <= 260 ? pageText.indexOf(normalizedCandidate) : -1

  if (exactStart !== -1) {
    return {
      start: exactStart,
      end: exactStart + normalizedCandidate.length
    }
  }

  const matchedTerm = terms.find((term) => normalizedCandidate.includes(term))

  if (!matchedTerm) {
    return null
  }

  const termIndex = normalizedCandidate.indexOf(matchedTerm)
  const radii = [180, 120, 80, 48, 24, matchedTerm.length]

  for (const radius of radii) {
    const anchorStart = Math.max(0, termIndex - radius)
    const anchorEnd = Math.min(normalizedCandidate.length, termIndex + matchedTerm.length + radius)
    const anchor = normalizedCandidate.slice(anchorStart, anchorEnd).trim()

    if (anchor.length < matchedTerm.length) {
      continue
    }

    const pageAnchorStart = pageText.indexOf(anchor)

    if (pageAnchorStart !== -1) {
      const termOffset = anchor.indexOf(matchedTerm)

      return {
        start: pageAnchorStart + Math.max(0, termOffset),
        end: pageAnchorStart + Math.max(0, termOffset) + matchedTerm.length
      }
    }
  }

  return null
}

export const findSearchMatch = (
  index: TextLayerSearchIndex,
  result: DocumentSearchResult,
  query: string
): TextLayerSearchMatch | null => {
  const terms = getSearchTerms(query)
  const candidates = [result.text, result.snippet.replace(/^\.+|\.+$/g, '')].filter(Boolean)

  for (const candidate of candidates) {
    const anchoredMatch = findAnchoredSearchMatch(index.text, candidate, terms)

    if (anchoredMatch) {
      return anchoredMatch
    }
  }

  const exactQuery = normalizeSearchText(query)
  const exactStart = exactQuery ? index.text.indexOf(exactQuery) : -1

  if (exactStart !== -1) {
    return {
      start: exactStart,
      end: exactStart + exactQuery.length
    }
  }

  for (const term of terms) {
    const termStart = index.text.indexOf(term)

    if (termStart !== -1) {
      return {
        start: termStart,
        end: termStart + term.length
      }
    }
  }

  return null
}

export const rectsFromTextLayerMatch = (
  index: TextLayerSearchIndex,
  match: TextLayerSearchMatch,
  pageElement: HTMLElement,
  scale: number
): AnnotationRect[] => {
  const startPosition = index.positions[match.start]
  const endPosition = index.positions[Math.max(match.start, match.end - 1)]

  if (!startPosition || !endPosition) {
    return []
  }

  const range = document.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset + 1)

  const pageRect = pageElement.getBoundingClientRect()
  const rects = Array.from(range.getClientRects())
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

  range.detach()
  return normalizeAnnotationRects(rects)
}
