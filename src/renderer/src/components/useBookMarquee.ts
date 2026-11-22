import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

type BookBounds = { id: string; rect: DOMRect }
type Drag = { pointerId: number; x: number; y: number; viewport: DOMRect; books: BookBounds[] }
type Box = { left: number; top: number; width: number; height: number }
type BoardEvent = ReactPointerEvent<HTMLDivElement>

export function useBookMarquee() {
  const drag = useRef<Drag | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const clear = useCallback(() => {
    drag.current = null
    setBox(null)
    setIds([])
  }, [])
  useEffect(() => {
    const cancelDrag = () => { if (drag.current) clear() }
    window.addEventListener('blur', cancelDrag)
    return () => window.removeEventListener('blur', cancelDrag)
  }, [clear])

  function down(e: BoardEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !e.isPrimary ||
        (e.target as Element).closest('button, article, form, [data-connection], [role="menu"]')) return
    const viewport = e.currentTarget
    clear()
    viewport.focus({ preventScroll: true })
    viewport.setPointerCapture(e.pointerId)
    e.preventDefault()
    const books = Array.from(viewport.querySelectorAll<HTMLElement>('[data-shelf-book]'), book => ({
      id: book.dataset.shelfBook!, rect: book.getBoundingClientRect()
    }))
    drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, viewport: viewport.getBoundingClientRect(), books }
  }
  function move(e: BoardEvent) {
    const active = drag.current
    if (!active || active.pointerId !== e.pointerId) return
    const { viewport, x, y } = active
    const endX = Math.max(viewport.left, Math.min(viewport.right, e.clientX))
    const endY = Math.max(viewport.top, Math.min(viewport.bottom, e.clientY))
    if (Math.hypot(endX-x, endY-y) < 4) { setBox(null); setIds([]); return }
    const left = Math.min(x, endX), top = Math.min(y, endY)
    const right = Math.max(x, endX), bottom = Math.max(y, endY)
    setBox({ left: left-viewport.left-e.currentTarget.clientLeft, top: top-viewport.top-e.currentTarget.clientTop, width: right-left, height: bottom-top })
    setIds(active.books.filter(({rect}) => rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom).map(book => book.id))
  }
  function up(e: BoardEvent) {
    if (drag.current?.pointerId !== e.pointerId) return
    move(e)
    drag.current = null
    setBox(null)
  }
  function cancel(e: BoardEvent) { if (drag.current?.pointerId === e.pointerId) clear() }
  return { ids, box, clear, down, move, up, cancel }
}
