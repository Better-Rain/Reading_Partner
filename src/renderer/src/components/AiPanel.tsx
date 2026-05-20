import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronLeft,
  Pencil,
  RotateCcw,
  Send,
  Square,
  Undo2,
  X
} from 'lucide-react'
import { composeAIOutputWithReasoning } from '../aiText'
import type { AIOperationRecord, AiPanelProps } from '../aiPanelTypes'
import { promptLabels } from '../aiPanelTypes'
import { MarkdownContent } from './MarkdownContent'
import { formatTime, getAnnotationPreview } from './NotesPanel'
import type { AnnotationRecord } from '../../../shared/types'

const getAIOperationAnnotationTitle = (annotation: AnnotationRecord): string => {
  const noteLine = annotation.note
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('模型：'))

  return noteLine || getAnnotationPreview(annotation)
}

const AIOperationList = memo(function AIOperationList({
  operations,
  onKeep,
  onRevert
}: {
  operations: AIOperationRecord[]
  onKeep: (operationId: string) => void
  onRevert: (operationId: string) => void
}): JSX.Element | null {
  if (operations.length === 0) {
    return null
  }

  return (
    <div className="ai-operation-list">
      {operations.map((operation) => {
        const pageNumbers = Array.from(
          new Set(operation.annotations.map((annotation) => annotation.pageNumber))
        )
          .sort((first, second) => first - second)
          .join(', ')

        return (
          <article className={`ai-operation-card is-${operation.status}`} key={operation.id}>
            <div className="ai-operation-heading">
              <strong>AI 已创建 {operation.annotations.length} 条批注</strong>
              <span>
                第 {pageNumbers || '-'} 页 · {formatTime(operation.createdAt)}
              </span>
            </div>
            <ul>
              {operation.annotations.map((annotation) => (
                <li key={annotation.id}>
                  <span>{getAIOperationAnnotationTitle(annotation)}</span>
                  <small>{annotation.selectedText || annotation.note || '无预览'}</small>
                </li>
              ))}
            </ul>
            <div className="ai-operation-actions">
              {operation.status === 'pending' ? (
                <>
                  <button className="text-button neutral" onClick={() => onKeep(operation.id)}>
                    <Check size={14} />
                    保留
                  </button>
                  <button className="text-button" onClick={() => onRevert(operation.id)}>
                    <Undo2 size={14} />
                    撤销
                  </button>
                </>
              ) : (
                <span>{operation.status === 'kept' ? '已保留' : '已撤销'}</span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
})

export function AiPanel({
  activeConversationId,
  aiRun,
  aiOperations,
  chatDraft,
  chatTitleDraft,
  chatMessages,
  conversations,
  hasDocument,
  isConversationOpen,
  question,
  readyProvider,
  selection,
  onAskDocument,
  onCloseConversation,
  onCancelRun,
  onCreateConversation,
  onKeepAIOperation,
  onRun,
  onRevertAIOperation,
  onResendChatMessage,
  onSelectConversation,
  onSendChat,
  onUpdateConversationTitle
}: AiPanelProps): JSX.Element {
  const canAskDocument = hasDocument && Boolean(readyProvider) && aiRun?.status !== 'running'
  const canSendChat = hasDocument && Boolean(readyProvider) && aiRun?.status !== 'running'
  const activeChatRunning = aiRun?.source === 'chat' && aiRun.status === 'running'
  const canResendChat = hasDocument && Boolean(readyProvider) && aiRun?.status !== 'running'
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const isCreatingConversation = isConversationOpen && activeConversationId === null
  const visibleOperations = useMemo(
    () =>
      aiOperations.filter((operation) =>
        isConversationOpen && activeConversationId
          ? operation.conversationId === activeConversationId
          : !operation.conversationId
      ),
    [activeConversationId, aiOperations, isConversationOpen]
  )
  const chatMessageListRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [resendEditId, setResendEditId] = useState<string | null>(null)
  const chatDraftRef = useRef(chatDraft)
  const chatTitleDraftRef = useRef(chatTitleDraft)
  const questionDraftRef = useRef(question)
  const titleEditDraftRef = useRef(activeConversation?.title ?? '')
  const resendEditDraftRef = useRef('')
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const chatTitleInputRef = useRef<HTMLInputElement | null>(null)
  const questionTextareaRef = useRef<HTMLTextAreaElement | null>(null)
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
  }, [activeConversation?.id, activeConversation?.title])

  useEffect(() => {
    chatDraftRef.current = chatDraft
    if (chatTextareaRef.current && chatTextareaRef.current.value !== chatDraft) {
      chatTextareaRef.current.value = chatDraft
    }
  }, [activeConversationId, chatDraft, isConversationOpen])

  useEffect(() => {
    chatTitleDraftRef.current = chatTitleDraft
    if (chatTitleInputRef.current && chatTitleInputRef.current.value !== chatTitleDraft) {
      chatTitleInputRef.current.value = chatTitleDraft
    }
  }, [activeConversationId, chatTitleDraft, isConversationOpen])

  useEffect(() => {
    questionDraftRef.current = question
    if (questionTextareaRef.current && questionTextareaRef.current.value !== question) {
      questionTextareaRef.current.value = question
    }
  }, [activeConversationId, isConversationOpen, question])

  useEffect(() => {
    if (!isConversationOpen) {
      return
    }

    shouldStickToBottomRef.current = true
    const list = chatMessageListRef.current

    if (!list) {
      return
    }

    window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })
  }, [activeConversationId, isConversationOpen])

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
    visibleOperations.length
  ])

  if (isConversationOpen && (activeConversation || isCreatingConversation)) {
    return (
      <div className="inspector-content chat-drawer">
        <header className="chat-drawer-header">
          <button className="text-button neutral" onClick={onCloseConversation}>
            <ChevronLeft size={15} />
            返回
          </button>
          <div className="chat-title-block">
            {isCreatingConversation ? (
              <input
                className="chat-title-input"
                placeholder="对话名称（可选，留空自动生成）"
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
              {readyProvider ? `${readyProvider.label} / ${readyProvider.defaultModel}` : '未配置 AI'}
              {isCreatingConversation ? ' / 发送后保存' : ''}
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
          {chatMessages.length === 0 ? (
            <p className="muted">开始一段可以连续追问的共读对话。选中文本后发送，会把选区一起作为本轮上下文。</p>
          ) : (
            chatMessages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <strong>{message.role === 'user' ? '你' : 'Reading Partner'}</strong>
                {message.role === 'user' && (
                  <div className="chat-message-action">
                    <button
                      className="text-button neutral"
                      disabled={!canResendChat}
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
                        disabled={!canResendChat}
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
                  <MarkdownContent text={message.content} />
                )}
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
                  aiRun.output || '正在思考...',
                  aiRun.reasoningOutput
                )}
              />
            </article>
          )}
          <AIOperationList
            operations={visibleOperations}
            onKeep={onKeepAIOperation}
            onRevert={onRevertAIOperation}
          />
        </div>

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = chatDraftRef.current.trim()

            if (!trimmed) {
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
            disabled={!hasDocument}
            placeholder={selection ? '结合当前选区继续追问...' : '继续和文档对话...'}
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

  return (
    <div className="inspector-content">
      <div className="ai-ready">
        <Bot size={26} />
        <div>
          <h2>AI 阅读助手</h2>
          <p>
            {readyProvider
              ? `${readyProvider.label} / ${readyProvider.defaultModel}`
              : '请先配置 API Key。'}
          </p>
        </div>
      </div>

      <section className="conversation-menu">
        <div className="conversation-menu-heading">
          <strong>共读对话</strong>
          <button disabled={!hasDocument} onClick={onCreateConversation}>
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

      <form
        className="document-qa"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = questionDraftRef.current.trim()

          if (!trimmed) {
            return
          }

          onAskDocument(trimmed)
          questionDraftRef.current = ''
          event.currentTarget.reset()
        }}
      >
        <textarea
          disabled={!hasDocument}
          placeholder="一次性文档问答..."
          ref={questionTextareaRef}
          defaultValue={question}
          onChange={(event) => {
            questionDraftRef.current = event.target.value
          }}
        />
        <button disabled={!canAskDocument} type="submit">
          <Send size={16} />
          提问
        </button>
      </form>

      <div className="selected-preview">
        <strong>当前选区</strong>
        <p>{selection ?? '未选择文本'}</p>
      </div>

      <div className="prompt-grid">
        <button disabled={!selection || !readyProvider} onClick={() => onRun('translate_selection')}>
          翻译选区
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('explain_selection')}>
          解释概念
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('summarize_selection')}>
          总结段落
        </button>
        <span className="prompt-status">{aiRun?.output ? '已自动保存' : '输出会自动保存'}</span>
      </div>

      {aiRun && aiRun.source !== 'chat' && (
        <div className="ai-output">
          <div className="ai-output-heading">
            <strong>{promptLabels[aiRun.promptType]}</strong>
            <span>{aiRun.status === 'running' ? '生成中' : aiRun.status}</span>
            {aiRun.status === 'running' && (
              <button className="text-button" type="button" onClick={onCancelRun}>
                <X size={14} />
                取消
              </button>
            )}
          </div>
          {aiRun.error ? (
            <p className="error-text">{aiRun.error}</p>
          ) : (
            <MarkdownContent
              text={composeAIOutputWithReasoning(
                aiRun.output || '等待模型返回...',
                aiRun.reasoningOutput
              )}
            />
          )}
        </div>
      )}
      <AIOperationList
        operations={visibleOperations}
        onKeep={onKeepAIOperation}
        onRevert={onRevertAIOperation}
      />
    </div>
  )
}
