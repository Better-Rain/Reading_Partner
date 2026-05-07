import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AnnotationRecord } from '../../../shared/types'

export type AnnotationUndoAction =
  | {
      kind: 'create'
      annotation: AnnotationRecord
    }
  | {
      kind: 'delete'
      annotation: AnnotationRecord
    }
  | {
      kind: 'update'
      before: AnnotationRecord
      after: AnnotationRecord
    }

type UseAnnotationUndoParams = {
  setAnnotations: Dispatch<SetStateAction<AnnotationRecord[]>>
  setStatus: Dispatch<SetStateAction<string>>
}

export const useAnnotationUndo = ({
  setAnnotations,
  setStatus
}: UseAnnotationUndoParams): {
  pushAnnotationUndo: (action: AnnotationUndoAction) => void
  resetAnnotationUndoStack: () => void
  undoLastAnnotationAction: () => Promise<void>
} => {
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationUndoAction[]>([])

  const pushAnnotationUndo = (action: AnnotationUndoAction): void => {
    setAnnotationUndoStack((items) => [...items.slice(-39), action])
  }

  const resetAnnotationUndoStack = (): void => {
    setAnnotationUndoStack([])
  }

  const undoLastAnnotationAction = async (): Promise<void> => {
    const action = annotationUndoStack.at(-1)

    if (!action) {
      setStatus('没有可撤销的批注操作')
      return
    }

    setAnnotationUndoStack((items) => items.slice(0, -1))

    if (action.kind === 'create') {
      await window.readingPartner.deleteAnnotation(action.annotation.id)
      setAnnotations((items) => items.filter((item) => item.id !== action.annotation.id))
      setStatus('已撤销新增批注')
      return
    }

    if (action.kind === 'delete') {
      const restored = await window.readingPartner.restoreAnnotation(action.annotation)
      setAnnotations((items) =>
        [...items.filter((item) => item.id !== restored.id), restored].sort(
          (first, second) =>
            first.pageNumber - second.pageNumber || first.createdAt.localeCompare(second.createdAt)
        )
      )
      setStatus('已撤销删除批注')
      return
    }

    const restored = await window.readingPartner.restoreAnnotation(action.before)
    setAnnotations((items) => items.map((item) => (item.id === restored.id ? restored : item)))
    setStatus('已撤销批注编辑')
  }

  return {
    pushAnnotationUndo,
    resetAnnotationUndoStack,
    undoLastAnnotationAction
  }
}
