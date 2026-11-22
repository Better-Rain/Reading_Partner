import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  AIChatMessageRecord,
  AIConversationRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  AnnotationRecord,
  DocumentRecord,
  VocabularyRecord
} from '../../../shared/types'
import { hasExplicitAnnotationIntent } from '../../../shared/aiAnnotationIntent'
import { extractAIReasoning, makeConversationTitle, stripAIReasoningBlock } from '../aiText'
import { aiDefaultAnnotationColor, extractAIAssistedAnnotations } from '../aiAnnotations'
import { AIRunState, promptLabels } from '../aiPanelTypes'
import type { AnnotationRect } from '../annotationGeometry'
import type { InspectorTab } from '../components/InspectorTabBar'

type UseAIRunActionsParams = {
  activeConversation: AIConversationRecord | null
  activeDocument: DocumentRecord | null
  annotationColors: string[]
  chatTitleDraft: string
  pageCount: number
  pageNumber: number
  readyProvider: AIProviderRecord | null
  selectedAnnotationColor: string
  selectionRects: AnnotationRect[]
  selectionText: string | null
  appendOptimisticChatMessage: (message: AIChatMessageRecord) => void
  createAIAssistedAnnotations: (
    documentId: string,
    drafts: ReturnType<typeof extractAIAssistedAnnotations>['annotations'],
    model: string
  ) => Promise<AnnotationRecord[]>
  createAIConversation: (title?: string) => Promise<AIConversationRecord | null>
  refreshAIConversationAfterRun: (conversationId: string, documentId: string) => Promise<void>
  registerAIOperation: (
    requestId: string,
    annotationsForOperation: AnnotationRecord[],
    conversationId?: string
  ) => void
  setActiveTab: Dispatch<SetStateAction<InspectorTab>>
  setAnnotations: Dispatch<SetStateAction<AnnotationRecord[]>>
  setChatDraft: (value: string) => void
  setChatTitleDraft: (value: string) => void
  setIsChatDrawerOpen: (value: boolean) => void
  setSelection: (selection: null) => void
  setStatus: Dispatch<SetStateAction<string>>
  setVocabulary: Dispatch<SetStateAction<VocabularyRecord[]>>
}

type AIRunContext = UseAIRunActionsParams

const maxFallbackAnnotationNoteLength = 900

const annotationNounPattern = '(?:批注|标注|注释|页边注|边注|旁注|笔记)'
const visibleAnnotationHeadingPattern = new RegExp(
  '^\\s*(?:#{1,6}\\s*)?(?:[*_`]+\\s*)?' +
    `${annotationNounPattern}(?:内容|正文|建议|如下)?\\s*[：:]?\\s*$`,
  'gim'
)
const visibleAnnotationIntroPattern = new RegExp(
  `^\\s*(?:以下是|下面是|这是|这里是).{0,80}${annotationNounPattern}.{0,40}[：:]?\\s*$`,
  'i'
)
const repeatedAnnotationHeadingPattern = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?${annotationNounPattern}(?:内容|正文|建议|如下)?\\s*[：:]?\\s*$`,
  'i'
)
const markdownSeparatorPattern = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

const collapseAnnotationNote = (value: string): string => {
  const collapsed = value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  if (collapsed.length <= maxFallbackAnnotationNoteLength) {
    return collapsed
  }

  return `${collapsed.slice(0, maxFallbackAnnotationNoteLength - 3).trim()}...`
}

const trimVisibleAnnotationCandidate = (value: string): string => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')

  while (
    lines.length > 0 &&
    (!lines[0].trim() ||
      markdownSeparatorPattern.test(lines[0]) ||
      visibleAnnotationIntroPattern.test(lines[0]) ||
      repeatedAnnotationHeadingPattern.test(lines[0]))
  ) {
    lines.shift()
  }

  while (
    lines.length > 0 &&
    (!lines[lines.length - 1].trim() ||
      markdownSeparatorPattern.test(lines[lines.length - 1]))
  ) {
    lines.pop()
  }

  return collapseAnnotationNote(lines.join('\n'))
}

const extractVisibleAnnotationNote = (visibleOutputForNote: string): string => {
  const normalized = visibleOutputForNote.replace(/\r\n?/g, '\n')
  const headingMatches = Array.from(normalized.matchAll(visibleAnnotationHeadingPattern))

  for (let index = headingMatches.length - 1; index >= 0; index -= 1) {
    const match = headingMatches[index]
    const start = (match.index ?? 0) + match[0].length
    const note = trimVisibleAnnotationCandidate(normalized.slice(start))

    if (note) {
      return note
    }
  }

  return collapseAnnotationNote(normalized)
}

const normalizeAnnotationAnchorText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

const filterSelectionAssistedDrafts = (
  drafts: ReturnType<typeof extractAIAssistedAnnotations>['annotations'],
  selectedText: string
): ReturnType<typeof extractAIAssistedAnnotations>['annotations'] => {
  const selectedAnchor = normalizeAnnotationAnchorText(selectedText)

  return drafts.filter((draft) => {
    const draftAnchor = normalizeAnnotationAnchorText(draft.selectedText)

    return draftAnchor && draftAnchor !== selectedAnchor
  })
}

const buildSelectedAnnotationDrafts = (
  run: AIRunState,
  drafts: ReturnType<typeof extractAIAssistedAnnotations>['annotations'],
  visibleOutputForNote: string
): ReturnType<typeof extractAIAssistedAnnotations>['annotations'] => {
  const request = run.selectedAnnotationRequest

  if (!request) {
    return drafts
  }

  if (drafts.length > 0) {
    return drafts.map((draft, index) =>
      index === 0
        ? {
            ...draft,
            pageNumber: request.pageNumber,
            selectedText: draft.selectedText || request.text,
            rects: request.rects
          }
        : draft
    )
  }

  const fallbackNote = extractVisibleAnnotationNote(visibleOutputForNote)

  if (!fallbackNote) {
    return drafts
  }

  return [
    {
      pageNumber: request.pageNumber,
      scope: 'paragraph',
      selectedText: request.text,
      note: fallbackNote,
      color: request.color,
      rects: request.rects
    }
  ]
}

const promisedAnnotationPattern =
  /(创建|生成|添加|写入|做|保存).{0,16}(批注|标注|注释|页边注|边注|旁注|笔记)|(批注|标注|注释|页边注|边注|旁注|笔记).{0,16}(内容|如下|包括|已经|将会|可以|总结|要点)/i

const shouldCreateFallbackAnnotation = (
  run: AIRunState | null,
  rawOutput: string,
  visibleOutputForNote: string
): run is AIRunState => {
  if (!run || run.selectedAnnotationRequest || run.source === 'selection') {
    return false
  }

  if (rawOutput.includes('RP_ANNOTATIONS')) {
    return true
  }

  return promisedAnnotationPattern.test(visibleOutputForNote)
}

const buildFallbackAnnotationDraft = (
  pageNumber: number,
  visibleOutputForNote: string
): ReturnType<typeof extractAIAssistedAnnotations>['annotations'][number] | null => {
  const note = extractVisibleAnnotationNote(visibleOutputForNote)

  if (!note) {
    return null
  }

  return {
    pageNumber,
    scope: 'margin',
    selectedText: null,
    note,
    color: aiDefaultAnnotationColor
  }
}

export const useAIRunActions = (params: UseAIRunActionsParams): {
  aiRun: AIRunState | null
  askDocumentQuestion: (question: string, annotatePage?: boolean) => Promise<void>
  cancelCurrentAIRun: () => Promise<void>
  defineVocabularyWithAI: (item: VocabularyRecord) => Promise<void>
  resendChatMessage: (message: AIChatMessageRecord, contentOverride?: string) => Promise<void>
  runAIAction: (promptType: AIPromptType, text?: string) => Promise<void>
  sendChatMessage: (message: string, title?: string) => Promise<void>
} => {
  const [aiRun, setAiRun] = useState<AIRunState | null>(null)
  const aiRunRef = useRef<AIRunState | null>(null)
  const contextRef = useRef<AIRunContext>(params)
  const toolAnnotationsByRequestRef = useRef(new Map<string, AnnotationRecord[]>())

  useEffect(() => {
    aiRunRef.current = aiRun
  }, [aiRun])

  useEffect(() => {
    contextRef.current = params
  })

  const handleAIStreamEvent = async (event: AIStreamEvent): Promise<void> => {
    if (event.type === 'start') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, model: event.model, status: 'running', error: null, reasoningOutput: '' }
          : current
      )
      return
    }

    if (event.type === 'delta') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? event.channel === 'reasoning'
            ? { ...current, reasoningOutput: `${current.reasoningOutput}${event.text}` }
            : { ...current, output: `${current.output}${event.text}` }
          : current
      )
      return
    }

    if (event.type === 'status') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, phase: event.phase, statusMessage: event.message }
          : current
      )
      return
    }

    const {
      pageCount,
      pageNumber,
      createAIAssistedAnnotations,
      refreshAIConversationAfterRun,
      registerAIOperation,
      setAnnotations,
      setStatus,
      setVocabulary
    } = contextRef.current
    if (event.type === 'annotations') {
      toolAnnotationsByRequestRef.current.set(event.requestId, [
        ...(toolAnnotationsByRequestRef.current.get(event.requestId) ?? []), ...event.annotations
      ])
      setAnnotations((items) => {
        const existingIds = new Set(items.map((item) => item.id))
        return [...items, ...event.annotations.filter((item) => !existingIds.has(item.id))]
      })
      registerAIOperation(event.requestId, event.annotations, event.conversationId ?? aiRunRef.current?.conversationId)
      setStatus(`AI 已生成 ${event.annotations.length} 条候选批注，等待确认`)
      return
    }

    const currentRun = aiRunRef.current

    if (event.type === 'error') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? {
              ...current,
              status: 'error',
              error: event.message,
              output: event.partialOutput ?? current.output,
              reasoningOutput: event.partialReasoning ?? current.reasoningOutput
            }
          : current
      )
      if (
        currentRun?.source === 'chat' &&
        currentRun.conversationId &&
        contextRef.current.activeDocument
      ) {
        try {
          await refreshAIConversationAfterRun(
            currentRun.conversationId,
            contextRef.current.activeDocument.id
          )
        } catch (refreshError) {
          setStatus(`AI 调用失败，且对话刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`)
        }
      }
      setStatus(`AI 调用失败：${event.message}`)
      return
    }

    if (event.type === 'cancelled') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'cancelled', error: null }
          : current
      )
      if (
        currentRun?.source === 'chat' &&
        currentRun.conversationId &&
        contextRef.current.activeDocument
      ) {
        try {
          await refreshAIConversationAfterRun(
            currentRun.conversationId,
            contextRef.current.activeDocument.id
          )
        } catch (refreshError) {
          setStatus(`AI 已停止，但对话刷新失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`)
        }
      }
      setStatus(currentRun?.source === 'chat' ? '已停止 AI 输出' : '已取消 AI 请求')
      return
    }

    const {
      displayOutput,
      annotations: assistedAnnotationDrafts
    } = extractAIAssistedAnnotations(
      event.artifact.outputMarkdown,
      event.artifact.pageNumber ?? pageNumber,
      pageCount,
      contextRef.current.annotationColors
    )
    const finalReasoning = extractAIReasoning(displayOutput).reasoning
    const visibleOutputForNote = stripAIReasoningBlock(displayOutput)

    if (currentRun?.source === 'annotate_page') {
      const count = toolAnnotationsByRequestRef.current.get(event.requestId)?.length ?? 0
      toolAnnotationsByRequestRef.current.delete(event.requestId)
      const summary = count ? `本页已写入 ${count} 条 AI 批注` : '本页没有生成通过原文校验的批注'
      setAiRun((current) => current?.requestId === event.requestId
        ? { ...current, status: 'done', output: summary } : current)
      setStatus(summary)
      return
    }
    if (currentRun?.source === 'chat' && currentRun.conversationId) {
      let refreshError: string | null = null

      try {
        await refreshAIConversationAfterRun(currentRun.conversationId, event.artifact.documentId)
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error)
      }

      const toolAnnotations = toolAnnotationsByRequestRef.current.get(event.requestId) ?? []
      const assistedDraftsForCreation = toolAnnotations.length || !hasExplicitAnnotationIntent(currentRun.inputText)
        ? []
        : buildSelectedAnnotationDrafts(currentRun, assistedAnnotationDrafts, visibleOutputForNote)
      let createdAnnotations: AnnotationRecord[] = []

      try {
        createdAnnotations = await createAIAssistedAnnotations(
          event.artifact.documentId,
          assistedDraftsForCreation,
          event.artifact.model
        )
        registerAIOperation(event.requestId, createdAnnotations, currentRun.conversationId)
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error)
      }

      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? {
              ...current,
              status: 'done',
              phase: 'finalizing',
              statusMessage: refreshError ? '回答已保存，批注同步出现问题' : '回答已完成',
              output: visibleOutputForNote,
              reasoningOutput: finalReasoning,
              error: null
            }
          : current
      )
      const totalAnnotations = toolAnnotations.length + createdAnnotations.length
      setStatus(
        refreshError
          ? `共读回答已保存，但批注同步失败：${refreshError}`
            : totalAnnotations > 0
              ? `共读对话已更新，并生成 ${totalAnnotations} 条候选批注`
              : '共读对话已更新'
      )
      toolAnnotationsByRequestRef.current.delete(event.requestId)
      return
    }

    let createdAnnotationCount = 0

    if (currentRun?.source === 'vocabulary' && currentRun.vocabularyId) {
      let sideEffectError: string | null = null
      try {
        const updated = await window.readingPartner.updateVocabularyDefinition({
          id: currentRun.vocabularyId,
          definition: visibleOutputForNote
        })
        setVocabulary((items) => items.map((item) => (item.id === updated.id ? updated : item)))
      } catch (error) {
        sideEffectError = error instanceof Error ? error.message : String(error)
      }
      const fallbackDraft =
        assistedAnnotationDrafts.length === 0 &&
        shouldCreateFallbackAnnotation(
          currentRun,
          event.artifact.outputMarkdown,
          visibleOutputForNote
        )
          ? buildFallbackAnnotationDraft(
              event.artifact.pageNumber ?? pageNumber,
              visibleOutputForNote
            )
          : null
      let createdAnnotations: AnnotationRecord[] = []
      try {
        createdAnnotations = await createAIAssistedAnnotations(
          event.artifact.documentId,
          fallbackDraft ? [fallbackDraft] : assistedAnnotationDrafts,
          event.artifact.model
        )
      } catch (error) {
        sideEffectError = error instanceof Error ? error.message : String(error)
      }
      createdAnnotationCount = createdAnnotations.length
      registerAIOperation(event.requestId, createdAnnotations)
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'done', phase: 'finalizing', output: visibleOutputForNote, reasoningOutput: finalReasoning, error: null }
          : current
      )
      setStatus(sideEffectError ? `AI 回答已完成，但词汇同步失败：${sideEffectError}` : 'AI 释义已写入词汇本')
      return
    } else {
      const createdAnnotations: AnnotationRecord[] = []
      const isSelectionRun = currentRun?.source === 'selection'
      const selectionContext = isSelectionRun ? currentRun.selectionContext : undefined
      let primaryAnnotation: AnnotationRecord | null = null
      try {
        const note = await window.readingPartner.createAnnotation({
          documentId: event.artifact.documentId,
          type: 'note',
          pageNumber: selectionContext?.pageNumber ?? event.artifact.pageNumber ?? 1,
          selectedText: selectionContext?.text ?? event.artifact.inputText,
          color: aiDefaultAnnotationColor,
          note: `AI ${promptLabels[event.artifact.promptType]}\n模型：${event.artifact.model}\n\n${visibleOutputForNote}`,
          rectsJson: selectionContext?.rects.length ? JSON.stringify(selectionContext.rects) : null,
          authorName: 'AI'
        })
        createdAnnotations.push(note)
        primaryAnnotation = note
      } catch (error) {
        setAiRun((current) =>
          current && current.requestId === event.requestId
            ? { ...current, status: 'done', output: visibleOutputForNote, reasoningOutput: finalReasoning, error: null }
            : current
        )
        setStatus(`AI 回答已完成，但笔记保存失败：${error instanceof Error ? error.message : String(error)}`)
        return
      }

      const fallbackDraft =
        assistedAnnotationDrafts.length === 0 &&
        shouldCreateFallbackAnnotation(
          currentRun,
          event.artifact.outputMarkdown,
          visibleOutputForNote
        )
          ? buildFallbackAnnotationDraft(
              event.artifact.pageNumber ?? pageNumber,
              visibleOutputForNote
            )
          : null
      const assistedDraftsForCreation = isSelectionRun
        ? filterSelectionAssistedDrafts(assistedAnnotationDrafts, event.artifact.inputText)
        : fallbackDraft
          ? [fallbackDraft]
          : assistedAnnotationDrafts

      createdAnnotations.push(
        ...(await createAIAssistedAnnotations(
          event.artifact.documentId,
          assistedDraftsForCreation,
          event.artifact.model
        ))
      )

      if (primaryAnnotation) {
        setAnnotations((items) => [...items, primaryAnnotation as AnnotationRecord])
      }
      createdAnnotationCount = createdAnnotations.length
      registerAIOperation(event.requestId, createdAnnotations)
    }

    setAiRun((current) =>
      current && current.requestId === event.requestId
        ? { ...current, status: 'done', output: visibleOutputForNote, reasoningOutput: finalReasoning }
        : current
    )
    setStatus(
      currentRun?.source === 'vocabulary'
        ? 'AI 释义已写入词汇本'
        : createdAnnotationCount > 1
          ? `AI 结果已保存为笔记，并创建 ${createdAnnotationCount - 1} 条辅助批注`
          : 'AI 结果已保存为笔记'
    )
  }

  useEffect(() => {
    return window.readingPartner.onAIStreamEvent((event) => {
      void handleAIStreamEvent(event).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setAiRun((current) =>
          current && current.requestId === event.requestId
            ? { ...current, status: 'error', error: message, statusMessage: 'AI 结果处理失败' }
            : current
        )
        contextRef.current.setStatus(`AI 结果处理失败：${message}`)
      })
    })
  }, [])

  const runAIAction = async (
    promptType: AIPromptType,
    text = contextRef.current.selectionText ?? undefined
  ): Promise<void> => {
    const {
      activeDocument,
      pageNumber,
      readyProvider,
      selectionRects,
      setActiveTab,
      setSelection,
      setStatus
    } = contextRef.current

    if (!activeDocument || !text) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    const selectionContext = {
      pageNumber,
      rects: selectionRects,
      text
    }
    setAiRun({
      requestId,
      promptType,
      inputText: text,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'selection',
      selectionContext
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} ${promptLabels[promptType]}选区`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      promptType,
      selectedText: text
    })
  }

  const cancelCurrentAIRun = async (): Promise<void> => {
    const currentRun = aiRunRef.current
    const { setStatus } = contextRef.current

    if (!currentRun || currentRun.status !== 'running') {
      return
    }

    await window.readingPartner.cancelAIRequest(currentRun.requestId)
    setAiRun((current) =>
      current && current.requestId === currentRun.requestId
        ? { ...current, status: 'cancelled', error: null }
        : current
    )
    setStatus(currentRun.source === 'chat' ? '已停止 AI 输出' : '已取消 AI 请求')
  }

  const askDocumentQuestion = async (question: string, annotatePage = false): Promise<void> => {
    const { activeDocument, pageNumber, readyProvider, setActiveTab, setStatus } = contextRef.current

    if (!activeDocument) {
      return
    }

    const trimmed = question.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    setAiRun({
      requestId,
      promptType: 'ask_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: annotatePage ? 'annotate_page' : 'document_qa'
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 回答文档问题`)

    await window.readingPartner.askDocumentQuestion({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      annotatePage,
      question: trimmed
    })
  }

  const sendChatMessage = async (message: string, title?: string): Promise<void> => {
    const {
      activeConversation,
      activeDocument,
      appendOptimisticChatMessage,
      chatTitleDraft,
      createAIConversation,
      pageNumber,
      readyProvider,
      selectionRects,
      selectionText,
      setActiveTab,
      setChatDraft,
      setChatTitleDraft,
      setIsChatDrawerOpen,
      setSelection,
      setStatus
    } = contextRef.current

    if (!activeDocument) {
      return
    }

    const trimmed = message.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const conversationTitle = title?.trim() || chatTitleDraft.trim() || makeConversationTitle(trimmed)
    const conversation =
      activeConversation ??
      (await createAIConversation(conversationTitle))

    if (!conversation) {
      return
    }

    const selectedText = selectionText
    const explicitSelectedAnnotationRequest =
      Boolean(selectedText?.trim()) && hasExplicitAnnotationIntent(trimmed)
    const selectedAnnotationRequest = explicitSelectedAnnotationRequest
      ? {
          color: contextRef.current.selectedAnnotationColor,
          pageNumber,
          rects: selectionRects,
          text: selectedText
        }
      : undefined
    const requestId = crypto.randomUUID()
    const optimisticMessage: AIChatMessageRecord = {
      id: `pending:${requestId}`,
      conversationId: conversation.id,
      role: 'user',
      content: trimmed,
      selectedText,
      pageNumber,
      providerId: null,
      model: null,
      artifactId: null,
      createdAt: new Date().toISOString()
    }

    appendOptimisticChatMessage(optimisticMessage)
    setIsChatDrawerOpen(true)
    setChatDraft('')
    setChatTitleDraft('')
    setAiRun({
      requestId,
      promptType: 'chat_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'chat',
      conversationId: conversation.id,
      selectedAnnotationRequest
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} 继续共读对话`)

    await window.readingPartner.runAIChat({
      requestId,
      providerId: readyProvider.id,
      conversationId: conversation.id,
      documentId: activeDocument.id,
      pageNumber,
      message: trimmed,
      selectedText,
      selectionRects,
      selectionColor: contextRef.current.selectedAnnotationColor
    })
  }

  const resendChatMessage = async (
    message: AIChatMessageRecord,
    contentOverride?: string
  ): Promise<void> => {
    const {
      activeConversation,
      activeDocument,
      appendOptimisticChatMessage,
      pageNumber,
      readyProvider,
      setActiveTab,
      setIsChatDrawerOpen,
      setStatus
    } = contextRef.current

    if (!activeDocument || message.role !== 'user') {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    if (!activeConversation || activeConversation.id !== message.conversationId) {
      setStatus('请先打开要继续的共读对话')
      return
    }

    const trimmed = (contentOverride ?? message.content).trim()

    if (!trimmed) {
      return
    }

    const requestId = crypto.randomUUID()
    const replayPageNumber = message.pageNumber ?? pageNumber
    const selectedText = message.selectedText ?? null
    const explicitSelectedAnnotationRequest =
      Boolean(selectedText?.trim()) && hasExplicitAnnotationIntent(trimmed)
    const optimisticMessage: AIChatMessageRecord = {
      id: `pending:${requestId}`,
      conversationId: activeConversation.id,
      role: 'user',
      content: trimmed,
      selectedText,
      pageNumber: replayPageNumber,
      providerId: null,
      model: null,
      artifactId: null,
      createdAt: new Date().toISOString()
    }

    appendOptimisticChatMessage(optimisticMessage)
    setIsChatDrawerOpen(true)
    setAiRun({
      requestId,
      promptType: 'chat_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'chat',
      conversationId: activeConversation.id,
      selectedAnnotationRequest: explicitSelectedAnnotationRequest
        ? {
            color: contextRef.current.selectedAnnotationColor,
            pageNumber: replayPageNumber,
            rects: [],
            text: selectedText ?? ''
          }
        : undefined
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 重新发送共读对话`)

    await window.readingPartner.runAIChat({
      requestId,
      providerId: readyProvider.id,
      conversationId: activeConversation.id,
      documentId: activeDocument.id,
      pageNumber: replayPageNumber,
      message: trimmed,
      selectedText,
      selectionColor: contextRef.current.selectedAnnotationColor
    })
  }

  const defineVocabularyWithAI = async (item: VocabularyRecord): Promise<void> => {
    const { activeDocument, pageNumber, readyProvider, setActiveTab, setStatus } = contextRef.current

    if (!activeDocument) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    const inputText = [
      `Term: ${item.word}`,
      item.sourceSentence ? `Source sentence: ${item.sourceSentence}` : null,
      item.definition ? `Current definition: ${item.definition}` : null
    ]
      .filter(Boolean)
      .join('\n')

    setAiRun({
      requestId,
      promptType: 'define_vocabulary',
      inputText,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      reasoningOutput: '',
      status: 'running',
      error: null,
      source: 'vocabulary',
      vocabularyId: item.id
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 生成词汇释义`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber: item.pageNumber ?? pageNumber,
      promptType: 'define_vocabulary',
      selectedText: inputText
    })
  }

  return {
    aiRun,
    askDocumentQuestion,
    cancelCurrentAIRun,
    defineVocabularyWithAI,
    resendChatMessage,
    runAIAction,
    sendChatMessage
  }
}
