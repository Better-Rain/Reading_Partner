import { useMemo, useState } from 'react'
import type {
  AIChatMessageRecord,
  AIConversationRecord,
  DocumentRecord
} from '../../../shared/types'
import type { InspectorTab } from '../components/InspectorTabBar'

type UseAIConversationsParams = {
  activeDocument: DocumentRecord | null
  setActiveTab: (tab: InspectorTab) => void
  setStatus: (status: string) => void
}

export const useAIConversations = ({
  activeDocument,
  setActiveTab,
  setStatus
}: UseAIConversationsParams): {
  aiConversations: AIConversationRecord[]
  activeConversation: AIConversationRecord | null
  activeConversationId: string | null
  isChatDrawerOpen: boolean
  chatMessages: AIChatMessageRecord[]
  chatDraft: string
  chatTitleDraft: string
  setChatDraft: (value: string) => void
  setChatTitleDraft: (value: string) => void
  setIsChatDrawerOpen: (value: boolean) => void
  refreshAIConversations: (documentId: string) => Promise<void>
  selectAIConversation: (conversationId: string) => Promise<void>
  startNewAIConversation: () => void
  createAIConversation: (title?: string) => Promise<AIConversationRecord | null>
  updateAIConversationTitle: (conversationId: string, title: string) => Promise<void>
  refreshAIConversationAfterRun: (conversationId: string, documentId: string) => Promise<void>
  appendOptimisticChatMessage: (message: AIChatMessageRecord) => void
} => {
  const [aiConversations, setAiConversations] = useState<AIConversationRecord[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<AIChatMessageRecord[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatTitleDraft, setChatTitleDraft] = useState('')

  const activeConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, aiConversations]
  )

  const refreshAIConversations = async (documentId: string): Promise<void> => {
    const conversations = await window.readingPartner.listAIConversations(documentId)
    setAiConversations(conversations)

    const nextActive = conversations[0] ?? null
    setActiveConversationId(nextActive?.id ?? null)
    setChatMessages(
      nextActive ? await window.readingPartner.listAIChatMessages(nextActive.id) : []
    )
  }

  const selectAIConversation = async (conversationId: string): Promise<void> => {
    setActiveConversationId(conversationId)
    setChatMessages(await window.readingPartner.listAIChatMessages(conversationId))
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
  }

  const startNewAIConversation = (): void => {
    if (!activeDocument) {
      return
    }

    setActiveConversationId(null)
    setChatMessages([])
    setChatDraft('')
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
    setActiveTab('ai')
    setStatus('正在创建新对话，发送第一条消息后保存')
  }

  const createAIConversation = async (title?: string): Promise<AIConversationRecord | null> => {
    if (!activeDocument) {
      return null
    }

    const conversation = await window.readingPartner.createAIConversation(
      activeDocument.id,
      '共读对话'
    )
    const titledConversation = title?.trim()
      ? await window.readingPartner.updateAIConversationTitle({ id: conversation.id, title: title.trim() })
      : conversation
    setAiConversations((items) => [titledConversation, ...items])
    setActiveConversationId(titledConversation.id)
    setChatMessages([])
    setIsChatDrawerOpen(true)
    setStatus('已创建共读对话')

    return titledConversation
  }

  const updateAIConversationTitle = async (conversationId: string, title: string): Promise<void> => {
    const trimmed = title.trim()

    if (!trimmed) {
      return
    }

    const updated = await window.readingPartner.updateAIConversationTitle({
      id: conversationId,
      title: trimmed
    })
    setAiConversations((items) => items.map((item) => (item.id === conversationId ? updated : item)))
    setStatus('已更新对话名称')
  }

  const refreshAIConversationAfterRun = async (
    conversationId: string,
    documentId: string
  ): Promise<void> => {
    const [messages, conversations] = await Promise.all([
      window.readingPartner.listAIChatMessages(conversationId),
      window.readingPartner.listAIConversations(documentId)
    ])

    setChatMessages(messages)
    setAiConversations(conversations)
  }

  const appendOptimisticChatMessage = (message: AIChatMessageRecord): void => {
    setChatMessages((items) => [...items, message])
  }

  return {
    aiConversations,
    activeConversation,
    activeConversationId,
    isChatDrawerOpen,
    chatMessages,
    chatDraft,
    chatTitleDraft,
    setChatDraft,
    setChatTitleDraft,
    setIsChatDrawerOpen,
    refreshAIConversations,
    selectAIConversation,
    startNewAIConversation,
    createAIConversation,
    updateAIConversationTitle,
    refreshAIConversationAfterRun,
    appendOptimisticChatMessage
  }
}
