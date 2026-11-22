import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Plus } from 'lucide-react'
import type { AIProviderRecord, BookConnection, DocumentRecord, LibraryBoardState, ShelfTag, TagPlacement } from '../../../shared/types'
import { BoardCompanion } from './BoardCompanion'
import { useBoardRuns } from '../hooks/useBoardRuns'
import { Pinboard } from './Pinboard'
import type { AnnotationColorPreset } from './NotesPanel'
import './libraryBoard.css'

type Props = {
  initialChat: { scope: string | null; chat: string } | null
  chatHost: HTMLDivElement | null
  onShowChat: () => void
  canResume: boolean
  toolbar: HTMLDivElement | null
  presets: AnnotationColorPreset[]
  visible: boolean
  documents: DocumentRecord[]
  provider: AIProviderRecord | null
  onClose: () => void
  onOpen: (doc: DocumentRecord, page?: number) => void
}
const api = () => window.readingPartner
const titleOf = (book: DocumentRecord) => book.title.replace(/\.pdf$/i, '')
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export function LibraryBoard({ initialChat, chatHost, onShowChat, canResume, visible, toolbar, presets, documents, provider, onClose, onOpen }: Props): JSX.Element {
  const [board, setBoard] = useState<LibraryBoardState | null>(null)
  const [scope, setScope] = useState<string | null>(initialChat?.scope ?? null)
  const [tagColor, setTagColor] = useState(presets[0]!.value)
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<'new' | 'rename' | 'books' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const refreshGeneration = useRef(0)
  const savingRef = useRef(false)
  const [topics, setTopics] = useState<Record<string, string | null>>(() =>
    initialChat ? { [initialChat.scope ?? '']: initialChat.chat } : {}
  )
  const { runs, versions, ask, cancel } = useBoardRuns(async () => {
    const latest = await api().getBoard()
    setBoard(current => current && current.revision > latest.revision ? current : latest)
  })
  const group = board?.groups.find(item => item.id === scope)
  const connections = (group ? group.connections : board?.connections) ?? []
  const tags = (group ? group.tags : board?.tags) ?? []
  const byId = new Map(documents.map(doc => [doc.id, doc]))
  const all = [...new Set([...(board?.order ?? []), ...[...documents].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(doc => doc.id)])].filter(id => byId.has(id))
  const shown = group ? group.books.filter(id => byId.has(id)) : all
  const scopeKey = group?.id ?? ''
  const run = runs[scopeKey]
  const selectTopic = (id: string | null) => setTopics(prev => ({ ...prev, [scopeKey]: id }))
  useEffect(() => {
    if (!visible) return
    if (savingRef.current) return
    const generation = ++refreshGeneration.current
    let active = true
    api().getBoard().then(next => { if (active && generation === refreshGeneration.current) { setBoard(next); setError('') } }).catch(e => { if (active && generation === refreshGeneration.current) setError(message(e)) })
    return () => { active = false }
  }, [visible])

  async function persist(next: LibraryBoardState, optimistic = false): Promise<boolean> {
    if (savingRef.current) return false
    refreshGeneration.current++
    savingRef.current = true
    if (optimistic) setBoard(next)
    setSaving(true); setError('')
    try { setBoard(await api().saveBoard(next)); return true }
    catch (e) {
      setError(message(e))
      setBoard(await api().getBoard().catch(() => board))
      return false
    }
    finally { savingRef.current = false; setSaving(false) }
  }
  function select(id: string | null) { setScope(id); setEdit(null); setName(''); setError('') }
  async function saveName() {
    if (!board || !name.trim()) return
    const id = edit === 'rename' && group ? group.id : crypto.randomUUID()
    const groups = edit === 'rename' ? board.groups.map(g => g.id === id ? { ...g, name: name.trim() } : g)
      : [...board.groups, { id, name: name.trim(), books: [] }]
    if (await persist({ ...board, groups })) { select(id); if (edit === 'new') setEdit('books') }
  }
  function membership(groupId: string, bookId: string, add: boolean) {
    if (!board) return
    void persist({ ...board, groups: board.groups.map(g => g.id !== groupId ? g : {
      ...g, books: add ? [...new Set([...g.books, bookId])] : g.books.filter(id => id !== bookId)
    }) })
  }
  async function updateTag(tag: ShelfTag, remove = false, optimistic = false) {
    if (!board) return false
    const next = remove ? tags.filter(item => item.id !== tag.id)
      : tags.some(item => item.id === tag.id) ? tags.map(item => item.id === tag.id ? tag : item) : [...tags, tag]
    const synced = next.map(other => {
      if (other.id === tag.id) return other
      const linked = !remove && !!tag.relatedTagIds?.includes(other.id)
      const previous = other.relatedTagIds ?? []
      if (linked === previous.includes(tag.id)) return other
      return { ...other, relatedTagIds: linked ? [...previous, tag.id] : previous.filter(id => id !== tag.id) }
    })
    return persist(group ? { ...board, groups: board.groups.map(item => item.id === group.id ? { ...item, tags: synced } : item) } : { ...board, tags: synced }, optimistic)
  }
  async function saveConnection(link: BookConnection, remove = false) {
    if (!board) return false
    const next = connections.filter(item => item.id !== link.id)
    if (!remove) next.push(link)
    return persist(group ? { ...board, groups: board.groups.map(item => item.id === group.id ? { ...item, connections: next } : item) } : { ...board, connections: next })
  }
  function send(question: string, conversationId: string | null, title?: string, mode?: 'tag' | 'connect', placement?: TagPlacement) {
    if (provider) void ask(group?.id ?? null, provider.id, question, { conversationId, ...(title ? { title } : {}) }, mode, placement)
  }
  const disabledAI = !provider || !shown.length || run?.status === 'running' || saving || !board
  return <section hidden={!visible} className="shelf-board" aria-label="书库线索板">
    <div className="shelf-scroll">
    <nav className="shelf-groups" aria-label="阅读分组"><button aria-pressed={!group} onClick={() => select(null)}>全部书籍 <small>{all.length}</small></button>
      {board?.groups.map(g => <button key={g.id} data-shelf-group={g.id}  aria-pressed={group?.id === g.id} onClick={() => select(g.id)}>{g.name} <small>{g.books.length}</small></button>)}
      <button disabled={!board || saving} onClick={() => { setEdit('new'); setName('') }}><Plus size={15}/>新建分组</button>
      <button onClick={onShowChat}>AI 共读</button>{canResume && <button onClick={onClose}><BookOpen size={16}/>继续阅读</button>}
    </nav>
    {(edit === 'new' || edit === 'rename') && <form className="shelf-controls" onSubmit={e => { e.preventDefault(); void saveName() }}><input autoFocus maxLength={80} value={name} onChange={e => setName(e.target.value)} aria-label="分组名称" placeholder="分组名称，如：政治修辞"/><button disabled={saving || !name.trim()}>保存名称</button><button type="button" onClick={() => setEdit(null)}>取消</button></form>}
    {error && <p className="shelf-error" role="alert">{error}</p>}
    {chatHost && visible && board && createPortal(<BoardCompanion key={scopeKey} groupId={group?.id ?? null} name={group?.name ?? '全部书籍'}
      topic={topics[scopeKey] ?? null} selectTopic={selectTopic} books={shown.map(id => byId.get(id)!)} tags={tags} connectionCount={connections.length}
      provider={provider} disabled={disabledAI} color={tagColor} run={run} version={versions[scopeKey] ?? 0} onAsk={send}
      onCancel={() => { if (run) void cancel(run.requestId) }} onOpen={onOpen}/>, chatHost)}
    <div className="shelf-columns"><section className="shelf-collection">
    <div className="shelf-section-title"><h2>{group?.name ?? '全部书籍'}</h2>{group && <div className="shelf-controls"><button onClick={() => { setEdit(edit === 'books' ? null : 'books') }}>{edit === 'books' ? '完成选书' : '选择书籍'}</button><button onClick={() => { setEdit('rename'); setName(group.name) }}>改名</button><button onClick={() => setEdit('delete')}>删除分组</button></div>}</div>
    {edit === 'delete' && group && board && <div className="shelf-controls">删除「{group.name}」？书籍仍在书库中。<button disabled={saving} onClick={async () => { if (await persist({ ...board, groups: board.groups.filter(g => g.id !== group.id) })) select(null) }}>确认删除</button><button onClick={() => setEdit(null)}>取消</button></div>}
    {edit === 'books' && group && <div className="shelf-picker">{documents.map(doc => <label key={doc.id}><input type="checkbox" disabled={saving} checked={group.books.includes(doc.id)} onChange={e => membership(group.id, doc.id, e.target.checked)}/>{titleOf(doc)}</label>)}</div>}

    {!shown.length && <p>{group ? '这个分组还没有书，点击「选择书籍」开始整理。' : '从书库导入 PDF 后，封面会出现在这里。'}</p>}
    {board && <Pinboard connections={connections} onSaveConnection={saveConnection} key={scopeKey} tags={tags} onUpdateTag={updateTag} toolbar={visible ? toolbar : null} presets={presets} tagColor={tagColor} setTagColor={setTagColor}
      aiDisabled={disabledAI} onAiTag={placement => { selectTopic(null); onShowChat(); send('提出一条适合对照阅读的批注并关联书籍。', null, undefined, 'tag', placement) }} order={all} books={shown.map(id => byId.get(id)!)} groups={group ? [group] : board.groups} positions={board.positions ?? {}}
      disabled={saving} onOpen={onOpen} onAdd={membership} onMove={(id, point) => void persist({ ...board, positions: { ...board.positions, [id]: point } }, true)}/>}
    </section></div></div></section>
}
