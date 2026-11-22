import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, Pencil, RotateCcw, Send, Square, X } from 'lucide-react'
import type { ReadingLink } from '../../../shared/readingLinks'
import type { BoardConversation } from '../../../shared/types'
import type { AIRunState } from '../aiPanelTypes'
import { composeAIOutputWithReasoning } from '../aiText'
import { MarkdownContent } from './MarkdownContent'
import { formatTime } from './NotesPanel'

type Message = { id: string; content: string; role: 'user' | 'assistant'; selectedText?: string | null }
type Props<M extends Message> = {
  activeConversation: BoardConversation | undefined
  modelLabel: string
  chatMessages: M[]
  chatDraft?: string
  chatTitleDraft?: string
  emptyHint: string
  placeholder: string
  maxLength?: number
  canCompose: boolean
  canSendChat: boolean
  aiRun: Pick<AIRunState,'source'|'status'|'output'|'reasoningOutput'|'error'|'statusMessage'> | null
  activityCount?: number
  beforeMessages?: ReactNode
  afterMessages?: ReactNode
  renderExtra?: (message: M) => ReactNode
  onReadingLink?: (target: ReadingLink, messageId: string) => void
  onResendChatMessage: (message: M, content: string) => void
  onUpdateConversationTitle: (id: string, title: string) => void
  onSendChat: (message: string, title: string) => void
  onCloseConversation: () => void
  onCancelRun: () => void
}

export function ConversationDrawer<M extends Message>({ activeConversation, modelLabel, chatMessages, chatDraft = '', chatTitleDraft = '', emptyHint, placeholder, maxLength,
  canCompose, canSendChat, aiRun, activityCount = 0, beforeMessages, afterMessages, renderExtra, onReadingLink, onResendChatMessage,
  onUpdateConversationTitle, onSendChat, onCloseConversation, onCancelRun }: Props<M>): JSX.Element {
  const activeConversationId = activeConversation?.id
  const activeChatRunning = aiRun?.source === 'chat' && aiRun.status === 'running'
  const hasChatRunPreview =
    aiRun?.source === 'chat' &&
    aiRun.status !== 'running' &&
    aiRun.status !== 'done' &&
    Boolean(aiRun.output.trim() || aiRun.reasoningOutput.trim() || aiRun.error)
  const chatMessageListRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [resendEditId, setResendEditId] = useState<string | null>(null)
  const chatDraftRef = useRef(chatDraft)
  const chatTitleDraftRef = useRef(chatTitleDraft)
  const titleEditDraftRef = useRef(activeConversation?.title ?? '')
  const resendEditDraftRef = useRef('')
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const chatTitleInputRef = useRef<HTMLInputElement | null>(null)
  const titleEditInputRef = useRef<HTMLInputElement | null>(null)
  const resendEditTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    titleEditDraftRef.current = activeConversation?.title ?? ''
    if (titleEditInputRef.current) {
      titleEditInputRef.current.value = titleEditDraftRef.current
    }
    setIsEditingTitle(false)
    setResendEditId(null)
    resendEditDraftRef.current = ''
  }, [activeConversationId, activeConversation?.title])

  useEffect(() => {
    chatDraftRef.current = chatDraft
    if (chatTextareaRef.current && chatTextareaRef.current.value !== chatDraft) {
      chatTextareaRef.current.value = chatDraft
    }
  }, [activeConversationId, chatDraft])

  useEffect(() => {
    chatTitleDraftRef.current = chatTitleDraft
    if (chatTitleInputRef.current && chatTitleInputRef.current.value !== chatTitleDraft) {
      chatTitleInputRef.current.value = chatTitleDraft
    }
  }, [activeConversationId, chatTitleDraft])

  useEffect(() => {
    shouldStickToBottomRef.current = true
    const list = chatMessageListRef.current

    if (!list) {
      return
    }

    window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })
  }, [activeConversationId])

  useEffect(() => {
    const list = chatMessageListRef.current

    if (!list || !shouldStickToBottomRef.current) {
      return
    }

    window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })
  }, [
    activeChatRunning,
    activeConversationId,
    aiRun?.output,
    aiRun?.reasoningOutput,
    chatMessages.length,
    activityCount
  ])

    return (
      <div className="inspector-content chat-drawer">
        <header className="chat-drawer-header">
          <button className="text-button neutral" onClick={onCloseConversation}>
            <ChevronLeft size={15} />
            返回
          </button>
          <div className="chat-title-block">
            {!activeConversation ? (
              <input
                className="chat-title-input"
                placeholder="对话名称（可选，留空自动生成）"
                maxLength={100}
                ref={chatTitleInputRef}
                defaultValue={chatTitleDraft}
                onChange={(event) => {
                  chatTitleDraftRef.current = event.target.value
                }}
              />
            ) : isEditingTitle ? (
              <div className="chat-title-editor">
                <input
                  autoFocus
                  maxLength={100}
                  ref={titleEditInputRef}
                  defaultValue={titleEditDraftRef.current}
                  onChange={(event) => {
                    titleEditDraftRef.current = event.target.value
                  }}
                />
                <button
                  className="text-button neutral"
                  onClick={() => {
                    if (activeConversation) {
                      onUpdateConversationTitle(activeConversation.id, titleEditDraftRef.current)
                    }
                    setIsEditingTitle(false)
                  }}
                >
                  <Check size={14} />
                  保存
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    titleEditDraftRef.current = activeConversation?.title ?? ''
                    if (titleEditInputRef.current) {
                      titleEditInputRef.current.value = titleEditDraftRef.current
                    }
                    setIsEditingTitle(false)
                  }}
                >
                  <X size={14} />
                  取消
                </button>
              </div>
            ) : (
              <div className="chat-title-row">
                <strong>{activeConversation?.title ?? '新对话'}</strong>
                <button className="text-button neutral" onClick={() => setIsEditingTitle(true)}>
                  <Pencil size={14} />
                  改名
                </button>
              </div>
            )}
            <span>
              {modelLabel}
              {!activeConversation ? ' / 发送后保存' : ''}
            </span>
          </div>
        </header>

        <div
          className="chat-message-list"
          ref={chatMessageListRef}
          onScroll={(event) => {
            const target = event.currentTarget
            shouldStickToBottomRef.current =
              target.scrollHeight - target.scrollTop - target.clientHeight < 24
          }}
        >
          {beforeMessages}
          {chatMessages.length === 0 ? (
            <p className="muted">{emptyHint}</p>
          ) : (
            chatMessages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id} id={`chat-${message.id}`} tabIndex={-1}>
                <strong>{message.role === 'user' ? '你' : 'Reading Partner'}</strong>
                {message.role === 'user' && (
                  <div className="chat-message-action">
                    <button
                      className="text-button neutral"
                      disabled={!canSendChat}
                      type="button"
                      onClick={() => {
                        setResendEditId(message.id)
                        resendEditDraftRef.current = message.content
                      }}
                    >
                      <RotateCcw size={13} />
                      重新发送
                    </button>
                  </div>
                )}
                {message.selectedText && <blockquote>{message.selectedText}</blockquote>}
                {resendEditId === message.id ? (
                  <form
                    className="chat-resend-editor"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const trimmed = resendEditDraftRef.current.trim()

                      if (!trimmed) {
                        return
                      }

                      onResendChatMessage(message, trimmed)
                      setResendEditId(null)
                      resendEditDraftRef.current = ''
                    }}
                  >
                    <textarea
                      autoFocus
                      ref={resendEditTextareaRef}
                      defaultValue={resendEditDraftRef.current}
                      onChange={(event) => {
                        resendEditDraftRef.current = event.target.value
                      }}
                    />
                    <div>
                      <button
                        className="text-button neutral"
                        disabled={!canSendChat}
                        type="submit"
                      >
                        <Send size={13} />
                        发送
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => {
                          setResendEditId(null)
                          resendEditDraftRef.current = ''
                        }}
                      >
                        <X size={13} />
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <MarkdownContent text={message.content} onReadingLink={message.role === 'assistant' && onReadingLink ? target => onReadingLink!(target, message.id) : undefined} />
                )}
                {renderExtra?.(message)}
              </article>
            ))
          )}
          {activeChatRunning && (
            <article className="chat-message assistant">
              <strong>Reading Partner</strong>
              <button className="text-button chat-message-action" type="button" onClick={onCancelRun}>
                <Square size={13} />
                停止输出
              </button>
              <MarkdownContent
                text={composeAIOutputWithReasoning(
                  aiRun.output || aiRun.statusMessage || '正在思考...',
                  aiRun.reasoningOutput
                )}
              />
            </article>
          )}
          {hasChatRunPreview && aiRun && (
            <article className="chat-message assistant ai-run-preview">
              <strong>Reading Partner</strong>
              <span className="chat-message-status">
                {aiRun.status === 'cancelled' ? '已停止，以下为已生成内容' : '请求未完成，以下为已生成内容'}
              </span>
              <MarkdownContent
                text={composeAIOutputWithReasoning(aiRun.output, aiRun.reasoningOutput)}
              />
              {aiRun.error && <p className="error-text">{aiRun.error}</p>}
            </article>
          )}
          {afterMessages}
        </div>

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = chatDraftRef.current.trim()

            if (!trimmed || !canSendChat) {
              return
            }

            onSendChat(trimmed, chatTitleDraftRef.current)
            chatDraftRef.current = ''
            chatTitleDraftRef.current = ''
            if (chatTitleInputRef.current) {
              chatTitleInputRef.current.value = ''
            }
            event.currentTarget.reset()
          }}
        >
          <textarea
            disabled={!canCompose}
            placeholder={placeholder}
            maxLength={maxLength}
            ref={chatTextareaRef}
            defaultValue={chatDraft}
            onChange={(event) => {
              chatDraftRef.current = event.target.value
            }}
          />
          <button disabled={!canSendChat} type="submit">
            <Send size={16} />
            发送
          </button>
          {activeChatRunning && (
            <button className="text-button" type="button" onClick={onCancelRun}>
              <X size={14} />
              取消
            </button>
          )}
        </form>
      </div>
    )
}

export function ConversationMenu({ conversations, canCreate, onCreateConversation, onSelectConversation }: {
  conversations: BoardConversation[]; canCreate: boolean; onCreateConversation: () => void; onSelectConversation: (id: string) => void
}): JSX.Element {
  return (
      <section className="conversation-menu">
        <div className="conversation-menu-heading">
          <strong>共读对话</strong>
          <button disabled={!canCreate} onClick={onCreateConversation}>
            新对话
          </button>
        </div>
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <p className="muted">还没有对话，可以新建一段共读对话。</p>
          ) : (
            conversations.map((conversation) => (
              <button
                className="conversation-item"
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{formatTime(conversation.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </section>
  )
}
