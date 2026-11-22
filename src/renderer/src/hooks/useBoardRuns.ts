import { useEffect, useRef, useState } from 'react'
import type { BoardAskOptions, ShelfAnswer, TagPlacement } from '../../../shared/types'

export type BoardRun = {
  requestId: string
  conversationId: string | null
  question: string
  output: string
  statusMessage: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  error: string | null
  answer?: ShelfAnswer
}

export function useBoardRuns(onBoardChanged: () => Promise<void>) {
  const [runs, setRuns] = useState<Record<string, BoardRun>>({})
  const [versions, setVersions] = useState<Record<string, number>>({})
  const requests = useRef(new Map<string, string>())
  const stopping = useRef(new Set<string>())
  useEffect(() => window.readingPartner.onBoardStreamEvent(event => {
    const scope = requests.current.get(event.requestId)
    if (scope === undefined) return
    setRuns(prev => {
      const run = prev[scope]
      if (!run || run.requestId !== event.requestId || run.status !== 'running') return prev
      if (event.type === 'delta' && event.channel !== 'reasoning') return { ...prev, [scope]: { ...run, output: run.output + event.text } }
      if (event.type === 'status') return { ...prev, [scope]: { ...run, statusMessage: event.message, ...(event.phase === 'connecting' ? { output: '' } : {}) } }
      return prev
    })
  }), [])
  async function ask(groupId: string | null, providerId: string, question: string, options: Omit<BoardAskOptions, 'requestId'>, mode?: 'tag' | 'connect', placement?: TagPlacement) {
    const scope = groupId ?? ''
    if ([...requests.current.values()].includes(scope)) return
    const requestId = crypto.randomUUID()
    const run: BoardRun = { requestId, question, conversationId: options.conversationId, status: 'running', statusMessage: '正在连接 AI 服务', output: '', error: null }
    requests.current.set(requestId, scope)
    setRuns(prev => ({ ...prev, [scope]: run }))
    try {
      const answer = await window.readingPartner.askBoard(groupId, providerId, question, mode, placement, { ...options, requestId })
      setRuns(prev => ({ ...prev, [scope]: { ...run, status: 'done', output: answer.text, answer } }))
      setVersions(prev => ({ ...prev, [scope]: (prev[scope] ?? 0) + 1 }))
      if (answer.savedTagId || answer.savedConnectionIds?.length) await onBoardChanged()
    } catch (e) {
      const cancelled = stopping.current.has(requestId)
      setRuns(prev => ({ ...prev, [scope]: { ...prev[scope]!, status: cancelled ? 'cancelled' : 'error', error: cancelled ? '已停止输出' : String(e) } }))
    } finally {
      requests.current.delete(requestId)
      stopping.current.delete(requestId)
    }
  }
  async function cancel(requestId: string) {
    stopping.current.add(requestId)
    try { await window.readingPartner.cancelAIRequest(requestId) }
    catch { stopping.current.delete(requestId) }
  }
  return { runs, versions, ask, cancel }
}
