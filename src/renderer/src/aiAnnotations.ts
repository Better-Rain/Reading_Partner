import { aiAnnotationBlockPattern, stripAIAssistedAnnotationBlock } from './aiText'

export type AIAssistedAnnotation = {
  pageNumber: number
  scope: 'paragraph' | 'vocabulary' | 'note'
  selectedText: string | null
  note: string
  color: string
}

export const aiDefaultAnnotationColor = '#c7d2fe'
export const maxAIAssistedAnnotations = 2

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
  const allowed = [aiDefaultAnnotationColor, ...allowedColors]
    .map((color) => color.toLocaleLowerCase())
    .includes(normalized)

  return allowed ? value.trim() : aiDefaultAnnotationColor
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
          scope:
            draft.scope === 'paragraph' || draft.scope === 'vocabulary'
              ? draft.scope
              : 'note',
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
