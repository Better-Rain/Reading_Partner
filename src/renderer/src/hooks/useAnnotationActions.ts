import type { Dispatch, SetStateAction } from 'react'
import type { AnnotationRecord, DocumentRecord } from '../../../shared/types'
import type { AnnotationRect } from '../annotationGeometry'
import type { AnnotationUndoAction } from './useAnnotationUndo'

type UseAnnotationActionsParams = {
  activeDocument: DocumentRecord | null
  annotations: AnnotationRecord[]
  pageNumber: number
  readerName: string
  selectedAnnotationColor: string
  selectionText: string | null
  selectionRects: AnnotationRect[]
  pushAnnotationUndo: (action: AnnotationUndoAction) => void
  refreshAnnotations: (documentId: string) => Promise<void>
  resetAnnotationUndoStack: () => void
  setAnnotations: Dispatch<SetStateAction<AnnotationRecord[]>>
  setDraftNote: Dispatch<SetStateAction<string>>
  setIsSelectionNoteEditorOpen: Dispatch<SetStateAction<boolean>>
  setSelectionNoteDraft: Dispatch<SetStateAction<string>>
  setStatus: Dispatch<SetStateAction<string>>
  clearSelection: () => void
}

export const useAnnotationActions = ({
  activeDocument,
  annotations,
  pageNumber,
  readerName,
  selectedAnnotationColor,
  selectionText,
  selectionRects,
  pushAnnotationUndo,
  refreshAnnotations,
  resetAnnotationUndoStack,
  setAnnotations,
  setDraftNote,
  setIsSelectionNoteEditorOpen,
  setSelectionNoteDraft,
  setStatus,
  clearSelection
}: UseAnnotationActionsParams): {
  createAnnotation: (
    type: AnnotationRecord['type'],
    note?: string,
    color?: string
  ) => Promise<void>
  deleteAnnotation: (id: string) => Promise<void>
  updateAnnotation: (id: string, note: string, color?: string | null) => Promise<void>
  exportReadingMarks: () => Promise<void>
  importReadingMarks: () => Promise<void>
} => {
  const createAnnotation = async (
    type: AnnotationRecord['type'],
    note?: string,
    color = selectedAnnotationColor
  ): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const created = await window.readingPartner.createAnnotation({
      documentId: activeDocument.id,
      type,
      pageNumber,
      selectedText: selectionText,
      color: type === 'bookmark' ? null : color,
      note: note ?? null,
      rectsJson: type !== 'bookmark' && selectionRects.length ? JSON.stringify(selectionRects) : null,
      authorName: readerName.trim() || 'Reader'
    })

    setAnnotations((items) => [...items, created])
    pushAnnotationUndo({ kind: 'create', annotation: created })
    clearSelection()
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
    setDraftNote('')
    setStatus(type === 'bookmark' ? '已添加书签' : '已保存批注')
  }

  const deleteAnnotation = async (id: string): Promise<void> => {
    const deleted = annotations.find((item) => item.id === id)
    await window.readingPartner.deleteAnnotation(id)
    setAnnotations((items) => items.filter((item) => item.id !== id))
    if (deleted) {
      pushAnnotationUndo({ kind: 'delete', annotation: deleted })
    }
  }

  const updateAnnotation = async (id: string, note: string, color?: string | null): Promise<void> => {
    const before = annotations.find((item) => item.id === id)
    const updated = await window.readingPartner.updateAnnotation({
      id,
      note: note.trim() || null,
      color
    })
    setAnnotations((items) => items.map((item) => (item.id === id ? updated : item)))
    if (before) {
      pushAnnotationUndo({ kind: 'update', before, after: updated })
    }
    setStatus('已更新批注')
  }

  const exportReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.exportReadingMarksDialog(activeDocument.id)

    if (result) {
      setStatus(`已导出 ${result.annotationCount} 条阅读记录`)
    }
  }

  const importReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.importReadingMarksDialog(activeDocument.id)

    if (result) {
      await refreshAnnotations(activeDocument.id)
      resetAnnotationUndoStack()
      setStatus(`已导入 ${result.annotationCount} 条阅读记录`)
    }
  }

  return {
    createAnnotation,
    deleteAnnotation,
    updateAnnotation,
    exportReadingMarks,
    importReadingMarks
  }
}
