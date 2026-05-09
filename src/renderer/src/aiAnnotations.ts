import { aiAnnotationBlockPattern, stripAIAssistedAnnotationBlock } from './aiText'
import type { AnnotationRect } from './annotationGeometry'

export type AIAssistedAnnotation = {
  pageNumber: number
  scope: 'paragraph' | 'vocabulary' | 'margin' | 'summary' | 'question' | 'note'
  selectedText: string | null
  note: string
  color: string
  rects?: AnnotationRect[]
}

export const aiDefaultAnnotationColor = '#c7d2fe'
export const maxAIAssistedAnnotations = 5

export const normalizeAIAssistedNote = (note: string): string => {
  let normalized = note.trim()

  for (let index = 0; index < 3; index += 1) {
    normalized = normalized
      .replace(/^(AI\s*)?(段落批注|词汇批注|辅助批注)[：:\s]+/i, '')
      .trim()
  }

  return normalized || note.trim()
}

const normalizeAIAssistedColor = (value: unknown, allowedColors: string[]): string => {
  if (typeof value !== 'string') {
    return aiDefaultAnnotationColor
  }

  const normalized = value.trim().toLocaleLowerCase()
  const isReadableHexColor = /^#[0-9a-f]{6}$/i.test(normalized)

  if (isReadableHexColor) {
    return normalized
  }

  const allowed = [aiDefaultAnnotationColor, ...allowedColors]
    .map((color) => color.toLocaleLowerCase())
    .includes(normalized)

  return allowed ? value.trim() : aiDefaultAnnotationColor
}

const normalizeAIAssistedScope = (value: unknown): AIAssistedAnnotation['scope'] => {
  if (
    value === 'paragraph' ||
    value === 'vocabulary' ||
    value === 'margin' ||
    value === 'summary' ||
    value === 'question' ||
    value === 'note'
  ) {
    return value
  }

  return 'note'
}

const toLimitedText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.replace(/\s+/g, ' ').trim()

  if (!trimmed) {
    return null
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed
}

export const extractAIAssistedAnnotations = (
  output: string,
  fallbackPageNumber: number,
  totalPages: number,
  allowedColors: string[]
): { displayOutput: string; annotations: AIAssistedAnnotation[] } => {
  const annotations: AIAssistedAnnotation[] = []
  const matches = Array.from(output.matchAll(aiAnnotationBlockPattern))

  for (const match of matches) {
    if (annotations.length >= maxAIAssistedAnnotations) {
      break
    }

    try {
      const parsed = JSON.parse(match[1] ?? '[]') as unknown
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown }).annotations)
          ? (parsed as { annotations: unknown[] }).annotations
          : []

      for (const item of items) {
        if (annotations.length >= maxAIAssistedAnnotations || !item || typeof item !== 'object') {
          break
        }

        const draft = item as Record<string, unknown>
        const rawPageNumber = Number(draft.pageNumber)
        const pageNumber = Number.isFinite(rawPageNumber)
          ? Math.floor(rawPageNumber)
          : fallbackPageNumber

        if (pageNumber < 1 || (totalPages > 0 && pageNumber > totalPages)) {
          continue
        }

        const note = toLimitedText(draft.note, 900)

        if (!note) {
          continue
        }

        annotations.push({
          pageNumber,
          scope: normalizeAIAssistedScope(draft.scope),
          selectedText: toLimitedText(draft.selectedText, 500),
          note,
          color: normalizeAIAssistedColor(draft.color, allowedColors)
        })
      }
    } catch {
      continue
    }
  }

  return {
    displayOutput: stripAIAssistedAnnotationBlock(output),
    annotations
  }
}
