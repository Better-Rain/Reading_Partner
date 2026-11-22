import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoardTurn, DocumentRecord } from '../../../shared/types'
import { MarkdownContent } from './MarkdownContent'

type Props = {
  scope: string | null
  version: number
  documents: Map<string, DocumentRecord>
  onOpen: (doc: DocumentRecord, page?: number) => void
}

export function BoardChatHistory({ scope, version, documents, onOpen }: Props): JSX.Element | null {
  const [turns, setTurns] = useState<BoardTurn[]>([])
  const [older, setOlder] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const transcript = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const token = ++generation.current
    setError(''); setLoading(true)
    window.readingPartner.getBoardHistory(scope).then(rows => {
      if (token !== generation.current) return
      setTurns(rows); setOlder(rows.length === 30); anchor.current = rows.at(-1)?.id ?? null
    }).catch(e => { if (token === generation.current) setError(String(e)) })
      .finally(() => { if (token === generation.current) setLoading(false) })
    return () => { generation.current++ }
  }, [scope, version])
  useLayoutEffect(() => {
    const box = transcript.current
    const target = box?.querySelector<HTMLElement>(`[data-board-turn="${anchor.current}"]`)
    if (box && target) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top
  }, [turns])
  async function earlier() {
    if (!turns[0] || loading) return
    const token = generation.current
    const before = turns[0].id
    setLoading(true); setError('')
    try {
      const rows = await window.readingPartner.getBoardHistory(scope, before)
      if (generation.current !== token) return
      anchor.current = before
      setTurns(current => [...rows, ...current]); setOlder(rows.length === 30)
    } catch (e) { if (generation.current === token) setError(String(e)) }
    finally { if (generation.current === token) setLoading(false) }
  }
  if (!turns.length && !error) return null
  return <div ref={transcript} className="board-transcript" aria-label="本组对话记录" tabIndex={0}>
    {error && <p role="alert">读取对话失败：{error}</p>}
    {older && <button disabled={loading} onClick={() => void earlier()}>查看更早对话</button>}
    {turns.map(({ id, question, result }) => <section key={id} data-board-turn={id} className="shelf-answer">
      <h3>{question}</h3><MarkdownContent text={result.text}/>
      {(result.savedTagId || result.savedConnectionIds?.length) && <small className="shelf-hint">{[result.savedTagId && '已钉上标签', result.savedConnectionIds?.length && `已创建 ${result.savedConnectionIds.length} 条连线`].filter(Boolean).join(' · ')}</small>}
      {!!result.sources.length && <details><summary>本轮查阅的原文</summary>{result.sources.map(source => <div key={source.documentId}>
        <strong>{source.title.replace(/\.pdf$/i, '')}</strong><div className="shelf-controls">{source.pages.map(page => <button key={page} disabled={!documents.has(source.documentId)} onClick={() => {
          const doc = documents.get(source.documentId); if (doc) onOpen(doc, page)
        }}>第 {page} 页</button>)}</div>
      </div>)}</details>}
    </section>)}
  </div>
}
