import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Square } from 'lucide-react'
import type { AIProviderRecord, BoardConversation, BoardTurn, DocumentRecord, ShelfAnswer, ShelfTag, TagPlacement } from '../../../shared/types'
import type { BoardRun } from '../hooks/useBoardRuns'
import { ConversationDrawer, ConversationMenu } from './ConversationDrawer'
import { MarkdownContent } from './MarkdownContent'

const api = () => window.readingPartner
const batchSize = 30

type Props = {
  groupId: string | null
  name: string
  topic: string | null
  selectTopic: (id: string | null) => void
  books: DocumentRecord[]
  tags: ShelfTag[]
  connectionCount: number
  provider: AIProviderRecord | null
  disabled: boolean
  color: string
  run: BoardRun | undefined
  version: number
  onAsk: (question: string, conversationId: string | null, title?: string, mode?: 'tag' | 'connect', placement?: TagPlacement) => void
  onCancel: () => void
  onOpen: (doc: DocumentRecord, page: number) => void
}

function AnswerDetails({ answer, books, onOpen }: { answer: ShelfAnswer; books: DocumentRecord[]; onOpen: Props['onOpen'] }) {
  return <>
    {(answer.savedTagId || !!answer.savedConnectionIds?.length) && <div className="ai-operation-card board-action-receipt">
      {answer.savedTagId && <div>已钉上 1 条标签</div>}
      {!!answer.savedConnectionIds?.length && <div>已创建 {answer.savedConnectionIds.length} 条书间连线</div>}
    </div>}
    {!!answer.sources.length && <details className="board-source-list"><summary>本轮查阅的原文</summary>{answer.sources.map(source => {
      const book = books.find(item => item.id === source.documentId)
      return <div key={source.documentId}><strong>{source.title.replace(/\.pdf$/i, '')}</strong><div className="shelf-controls">{source.pages.map(page => <button key={page} className="text-button neutral" disabled={!book} onClick={() => book && onOpen(book, page)}>第 {page} 页</button>)}</div></div>
    })}</details>}
  </>
}

type Message = { id: string; role: 'user' | 'assistant'; content: string; answer?: ShelfAnswer }
export function BoardCompanion({ groupId, name, topic, selectTopic, books, tags, connectionCount, provider, disabled, color, run, version, onAsk, onCancel, onOpen }: Props) {
  const [list, setList] = useState<BoardConversation[]>([])
  const [turns, setTurns] = useState<BoardTurn[]>([])
  const [older, setOlder] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [renameVersion, setRenameVersion] = useState(0)
  const generation = useRef(0)
  const active = list.find(item => item.id === topic)
  const modelLabel = provider ? `${provider.label} / ${provider.defaultModel}` : '请先在配置中设置 AI 服务'
  useEffect(() => {
    let live = true
    api().listBoardConversations(groupId).then(rows => { if (live) setList(rows) }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [groupId, version, renameVersion])
  useEffect(() => {
    const token = ++generation.current
    if (topic) {
      setLoading(true)
      api().getBoardHistory(groupId, undefined, topic).then(rows => {
        if (token === generation.current) { setTurns(rows); setOlder(rows.length === batchSize) }
      }).catch(e => { if (token === generation.current) setError(String(e)) })
        .finally(() => { if (token === generation.current) setLoading(false) })
    }
    return () => { generation.current++ }
  }, [groupId, topic, version])
  function select(id: string | null) {
    generation.current++; setTurns([]); setOlder(false); setError(''); selectTopic(id)
  }
  async function earlier() {
    if (!topic || loading || !turns[0]) return
    const token = generation.current
    setLoading(true)
    try {
      const rows = await api().getBoardHistory(groupId, turns[0].id, topic)
      if (token === generation.current) { setTurns(prev => [...rows, ...prev]); setOlder(rows.length === batchSize) }
    } catch(e) { if (token === generation.current) setError(String(e)) }
    finally { if (token === generation.current) setLoading(false) }
  }
  async function rename(id: string, title: string) {
    try { await api().renameBoardConversation(groupId, id, title); setRenameVersion(v => v + 1) }
    catch(e) { setError(String(e)) }
  }
  const errorNotice = error ? <p className="error-text" role="alert">{error}</p> : null
  if (topic) {
    const current = run?.conversationId === topic ? run : null
    const messages: Message[] = turns.flatMap(turn => [
      { id: `board-user-${turn.id}`, content: turn.question, role: 'user' },
      { id: `board-assistant-${turn.id}`, content: turn.result.text, role: 'assistant', answer: turn.result }
    ])
    if (current && current.status !== 'done') messages.push({ id: current.requestId, role: 'user', content: current.question })
    return <ConversationDrawer key={topic} activeConversation={active} modelLabel={`${name} · ${modelLabel}`} chatMessages={messages}
      emptyHint="可以从线索板上的阅读目标开始提问。" placeholder="继续和这组书对话…" maxLength={2000}
      canCompose={!!books.length} canSendChat={!disabled && !loading} aiRun={current && { ...current, source: 'chat', reasoningOutput: '' }}
      beforeMessages={older && <button className="text-button neutral" disabled={loading} onClick={() => void earlier()}>查看更早对话</button>}
      afterMessages={errorNotice} renderExtra={m => m.answer && <AnswerDetails answer={m.answer} books={books} onOpen={onOpen}/>}
      onResendChatMessage={(_, text) => onAsk(text, topic)} onSendChat={(text, title) => onAsk(text, topic, title)}
      onUpdateConversationTitle={rename} onCloseConversation={() => select(null)} onCancelRun={onCancel}/>
  }
  const quick = run?.conversationId === null ? run : null
  const pendingTopic = run?.status === 'running' && run.conversationId && !list.some(item => item.id === run.conversationId) ? run : null
  const askQuick = (text: string, mode?: 'tag' | 'connect') => onAsk(text, null, undefined, mode, mode === 'tag' ? { color } : undefined)
  return <div className="inspector-content board-assistant-home" aria-label="书库伴读">
    <div className="ai-ready"><Bot size={26}/><div><h2>AI 书库伴读</h2><p>{modelLabel}</p></div></div>
    <button className="primary-action compact annotate-page-action" disabled={disabled} onClick={() => askQuick(question.trim() || '结合线索板上的阅读目标，自主写一条有助于继续阅读的批注。','tag')}>自主批注线索板</button>
    <ConversationMenu conversations={list} canCreate={!!books.length} onCreateConversation={() => select(crypto.randomUUID())} onSelectConversation={select}/>
    {pendingTopic && <button className="conversation-item" onClick={() => select(pendingTopic.conversationId)}><strong>{pendingTopic.question}</strong><span>正在回答</span></button>}
    <form className="document-qa" onSubmit={e => { e.preventDefault(); if (!disabled && question.trim()) { askQuick(question.trim()); setQuestion('') } }}>
      <textarea aria-label="一次性书库问答" maxLength={2000} value={question} disabled={!books.length} onChange={e => setQuestion(e.target.value)} placeholder="一次性书库问答…"/>
      <button disabled={disabled || !question.trim()}><Send size={16}/>提问</button>
    </form>
    <div className="selected-preview"><strong>{name}</strong><p>{books.length} 本书 · {tags.length} 条标签 · {connectionCount} 条连线</p>
      {!!tags.length && <details><summary>查看阅读标签</summary>{tags.map(tag => <p key={tag.id}>{tag.text}</p>)}</details>}
    </div>
    <div className="prompt-grid">
      <button disabled={disabled} onClick={() => askQuick('结合我的目标标签，建议阅读顺序。')}>阅读思路</button>
      <button disabled={disabled || books.length < 2} onClick={() => askQuick('比较这些书的联系和分歧。')}>比较书籍</button>
      <button disabled={disabled || books.length < 2} onClick={() => askQuick(question.trim() || '核对原文，连接两本书并写下简述。','connect')}>AI 连书</button>
    </div>
    {errorNotice}
    {quick && <div className="ai-output"><div className="ai-output-heading"><strong>{quick.question}</strong>
      {quick.status === 'running' && <button className="text-button" onClick={onCancel}><Square size={14}/>停止输出</button>}</div>
      <MarkdownContent text={quick.output || quick.error || quick.statusMessage}/>
      {quick.output && quick.error && <p className="error-text">{quick.error}</p>}
      {quick.answer && <AnswerDetails answer={quick.answer} books={books} onOpen={onOpen}/>}</div>}
  </div>
}
