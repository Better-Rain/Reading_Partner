import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AnnotationRecord } from '../../../shared/types'
import type { AIOperationRecord } from '../aiPanelTypes'
import {
  normalizeAIAssistedNote,
  type AIAssistedAnnotation
} from '../aiAnnotations'

type UseAIOperationsParams = {
  setAnnotations: Dispatch<SetStateAction<AnnotationRecord[]>>
  setStatus: Dispatch<SetStateAction<string>>
}

export const useAIOperations = ({
  setAnnotations,
  setStatus
}: UseAIOperationsParams): {
  aiOperations: AIOperationRecord[]
  createAIAssistedAnnotations: (
    documentId: string,
    drafts: AIAssistedAnnotation[],
    model: string
  ) => Promise<AnnotationRecord[]>
  registerAIOperation: (
    requestId: string,
    annotationsForOperation: AnnotationRecord[],
    conversationId?: string
  ) => void
  keepAIOperation: (operationId: string) => void
  revertAIOperation: (operationId: string) => Promise<void>
  resetAIOperations: () => void
} => {
  const [aiOperations, setAiOperations] = useState<AIOperationRecord[]>([])

  const createAIAssistedAnnotations = async (
    documentId: string,
    drafts: AIAssistedAnnotation[],
    model: string
  ): Promise<AnnotationRecord[]> => {
    if (drafts.length === 0) {
      return []
    }

    const created = await Promise.all(
      drafts.map((draft) =>
        window.readingPartner.createAnnotation({
          documentId,
          type: 'note',
          pageNumber: draft.pageNumber,
          selectedText: draft.selectedText,
          color: draft.color,
          note: `模型：${model}\n\n${normalizeAIAssistedNote(draft.note)}`,
          authorName: 'AI'
        })
      )
    )

    setAnnotations((items) => [...items, ...created])
    return created
  }

  const registerAIOperation = (
    requestId: string,
    annotationsForOperation: AnnotationRecord[],
    conversationId?: string
  ): void => {
    if (annotationsForOperation.length === 0) {
      return
    }

    setAiOperations((items) => [
      {
        id: crypto.randomUUID(),
        requestId,
        createdAt: new Date().toISOString(),
        annotations: annotationsForOperation,
        status: 'pending',
        ...(conversationId ? { conversationId } : {})
      },
      ...items
    ])
  }

  const keepAIOperation = (operationId: string): void => {
    setAiOperations((items) =>
      items.map((item) => (item.id === operationId ? { ...item, status: 'kept' } : item))
    )
    setStatus('已保留 AI 创建的批注')
  }

  const revertAIOperation = async (operationId: string): Promise<void> => {
    const operation = aiOperations.find((item) => item.id === operationId)

    if (!operation || operation.status === 'reverted') {
      return
    }

    await Promise.all(
      operation.annotations.map((annotation) => window.readingPartner.deleteAnnotation(annotation.id))
    )
    const deletedIds = new Set(operation.annotations.map((annotation) => annotation.id))
    setAnnotations((items) => items.filter((item) => !deletedIds.has(item.id)))
    setAiOperations((items) =>
      items.map((item) => (item.id === operationId ? { ...item, status: 'reverted' } : item))
    )
    setStatus('已撤销 AI 创建的批注')
  }

  const resetAIOperations = (): void => {
    setAiOperations([])
  }

  return {
    aiOperations,
    createAIAssistedAnnotations,
    registerAIOperation,
    keepAIOperation,
    revertAIOperation,
    resetAIOperations
  }
}
