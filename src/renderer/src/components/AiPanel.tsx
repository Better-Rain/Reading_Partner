import { ConversationDrawer, ConversationMenu } from './ConversationDrawer'
import { annotationScopes } from '../../../shared/types'
import { memo, useEffect, useMemo, useRef } from 'react'
import {
  Bot,
  Check,
  Send,
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
                  <span>{annotation.scope && `${annotationScopes[annotation.scope]} · `}{getAIOperationAnnotationTitle(annotation)}</span>
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
  onReadingLink,
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
  const questionDraftRef = useRef(question)
  const questionTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    questionDraftRef.current = question
    if (questionTextareaRef.current) questionTextareaRef.current.value = question
  }, [activeConversationId, isConversationOpen, question])

  if (isConversationOpen && (activeConversation || isCreatingConversation)) {
    return <ConversationDrawer activeConversation={activeConversation} chatMessages={chatMessages} chatDraft={chatDraft} chatTitleDraft={chatTitleDraft}
      modelLabel={readyProvider ? `${readyProvider.label} / ${readyProvider.defaultModel}` : '未配置 AI'}
      emptyHint="开始一段可以连续追问的共读对话。选中文本后发送，会把选区一起作为本轮上下文。" placeholder={selection ? '结合当前选区继续追问...' : '继续和文档对话...'}
      canCompose={hasDocument} canSendChat={canSendChat} aiRun={aiRun} activityCount={visibleOperations.length}
      afterMessages={<AIOperationList operations={visibleOperations} onKeep={onKeepAIOperation} onRevert={onRevertAIOperation}/>}
      onReadingLink={onReadingLink} onResendChatMessage={onResendChatMessage} onUpdateConversationTitle={onUpdateConversationTitle}
      onSendChat={onSendChat} onCloseConversation={onCloseConversation} onCancelRun={onCancelRun}/>
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

      <button className="primary-action compact annotate-page-action" disabled={!canAskDocument} onClick={() =>
        onAskDocument('请自主批注当前页。自行选择最多三处值得解读的论点或证据，用 create_annotations 一次提交。selectedText 须逐字摘录同页短句，note 用中文解释其意义。若没有值得批注的内容，可以跳过。', true)
      }>自主批注本页</button>

      <ConversationMenu conversations={conversations} canCreate={hasDocument} onCreateConversation={onCreateConversation} onSelectConversation={onSelectConversation}/>

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
            <span>{aiRun.status === 'running' ? aiRun.statusMessage || '生成中' : aiRun.status}</span>
            {aiRun.status === 'running' && (
              <button className="text-button" type="button" onClick={onCancelRun}>
                <X size={14} />
                取消
              </button>
            )}
          </div>
          {aiRun.error ? (
            <>
              <p className="error-text">{aiRun.error}</p>
              {(aiRun.output.trim() || aiRun.reasoningOutput.trim()) && (
                <MarkdownContent
                  text={composeAIOutputWithReasoning(aiRun.output, aiRun.reasoningOutput)}
                />
              )}
            </>
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
