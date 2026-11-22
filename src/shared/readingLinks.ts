import type { AnnotationRecord, DocumentQuestionContext } from './types'
import { annotationScopes } from './types'

export type ReadingLink =
  | { kind: 'page'; page: number; quote?: string }
  | { kind: 'note'; id: string }

// Store the checked links in the message itself, so opening a conversation on
// another device needs neither the tool transcript nor a second database write.
export function finalizeReadingLinks(
  answer: string,
  evidence: Iterable<DocumentQuestionContext>,
  created: AnnotationRecord[],
  previousNoteIds: Set<string>
): string {
  const excerpts = Array.from(evidence)
  const notes = new Set([...previousNoteIds, ...created.map(note => note.id)])
  const linked = new Set<string>()
  const compact = (value: string) => value.replace(/\s+/gu, '')
  const content = answer.replace(/\[([^\]\n]+)\]\((quote|note):([^()\s]+)\)/g, (all, label: string, kind: string, target: string) => {
    if (kind === 'note') {
      if (!notes.has(target)) return label
      linked.add(target)
      return all
    }
    const valid = /^\d+$/.test(target) && label.trim() && excerpts.some(chunk => chunk.pageNumber === Number(target) && compact(chunk.text).includes(compact(label)))
    return valid ? all : label
  })
  const related = created.filter(note => !linked.has(note.id)).map(note => {
    const scope = annotationScopes[note.scope ?? 'note']
    const excerpt = (note.selectedText || '').replace(/[\[\]\n]/g, ' ').slice(0, 44)
    return `- [第 ${note.pageNumber} 页 · ${scope}${excerpt ? ` · ${excerpt}` : ''}](note:${note.id})`
  })
  return related.length ? `${content}\n\n本轮批注\n${related.join('\n')}` : content
}
