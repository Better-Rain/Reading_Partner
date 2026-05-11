import type {
  AIChatMessageRecord,
  AIConversationRecord,
  AIProviderRecord,
  AIPromptType,
  AnnotationRecord
} from '../../shared/types'
import type { AnnotationRect } from './annotationGeometry'

export type AIRunState = {
  requestId: string
  promptType: AIPromptType
  inputText: string
  providerLabel: string
  model: string
  output: string
  reasoningOutput: string
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  error: string | null
  source: 'selection' | 'vocabulary' | 'document_qa' | 'chat'
  conversationId?: string
  linkedSelection?: {
    authorName: string
    color: string
    pageNumber: number
    rects: AnnotationRect[]
    text: string
  }
  selectedAnnotationRequest?: {
    color: string
    pageNumber: number
    rects: AnnotationRect[]
    text: string
  }
  vocabularyId?: string
}

export type AIOperationRecord = {
  id: string
  requestId: string
  conversationId?: string
  createdAt: string
  annotations: AnnotationRecord[]
  status: 'pending' | 'kept' | 'reverted'
}

export type AiPanelProps = {
  activeConversationId: string | null
  aiRun: AIRunState | null
  aiOperations: AIOperationRecord[]
  chatDraft: string
  chatTitleDraft: string
  chatMessages: AIChatMessageRecord[]
  conversations: AIConversationRecord[]
  hasDocument: boolean
  isConversationOpen: boolean
  question: string
  readyProvider: AIProviderRecord | null
  selection: string | null
  onAskDocument: (question: string) => void
  onChatDraftChange: (value: string) => void
  onChatTitleDraftChange: (value: string) => void
  onCloseConversation: () => void
  onCancelRun: () => void
  onCreateConversation: () => void
  onKeepAIOperation: (operationId: string) => void
  onQuestionChange: (value: string) => void
  onRun: (promptType: AIPromptType) => void
  onRevertAIOperation: (operationId: string) => void
  onSelectConversation: (conversationId: string) => void
  onResendChatMessage: (message: AIChatMessageRecord, content?: string) => void
  onSendChat: (message: string) => void
  onUpdateConversationTitle: (conversationId: string, title: string) => void
}

export const promptLabels: Record<AIPromptType, string> = {
  translate_selection: '翻译',
  explain_selection: '解释',
  summarize_selection: '总结',
  define_vocabulary: '词汇释义',
  ask_document: '文档问答',
  chat_document: '共读对话'
}
