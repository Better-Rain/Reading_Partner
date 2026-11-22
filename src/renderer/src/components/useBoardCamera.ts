import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export type BoardPoint = { x: number; y: number }
type Camera = BoardPoint & { scale: number }
const initial = { x: 0, y: 0, scale: 1 }
const clampScale = (scale: number) => Math.min(3, Math.max(.25, scale))
const distance = (a: BoardPoint, b: BoardPoint) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: BoardPoint, b: BoardPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function useBoardCamera(viewport: RefObject<HTMLDivElement>, onMenu: (point: BoardPoint) => void) {
  const [camera, renderCamera] = useState<Camera>(initial)
  const live = useRef(camera)
  const touches = useRef(new Map<number, BoardPoint>())
  const hold = useRef<ReturnType<typeof setTimeout>>()
  const heldAt = useRef<BoardPoint | null>(null)
  const stopHold = () => { clearTimeout(hold.current); heldAt.current = null }
  const apply = (next: Camera) => { live.current = next; renderCamera(next) }
  const local = useCallback((x: number, y: number) => {
    const rect = viewport.current!.getBoundingClientRect()
    return { x: x - rect.left - viewport.current!.clientLeft, y: y - rect.top - viewport.current!.clientTop }
  }, [viewport])
  const world = (p: BoardPoint) => ({ x: (p.x - live.current.x) / live.current.scale, y: (p.y - live.current.y) / live.current.scale })
  const zoomAt = useCallback((factor: number, from: BoardPoint, to = from) => {
    const old = live.current, scale = clampScale(old.scale * factor)
    apply({ x: to.x - (from.x - old.x) * scale / old.scale, y: to.y - (from.y - old.y) * scale / old.scale, scale })
  }, [])
  const center = () => ({ x: viewport.current!.clientWidth / 2, y: viewport.current!.clientHeight / 2 })
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    const middleDrag = event.pointerType === 'mouse' && event.button === 1
    if (middleDrag) {
      if ((event.target as Element).closest('form,[role="menu"]')) return
      event.preventDefault()
    } else if (event.pointerType === 'mouse' || event.button !== 0 ||
        (event.target as Element).closest('button,[data-connection],article,form,[role="menu"]')) return
    const point = local(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    touches.current.set(event.pointerId, point)
    stopHold()
    if (event.pointerType === 'touch' && touches.current.size === 1) {
      heldAt.current = point
      hold.current = setTimeout(() => { touches.current.clear(); onMenu(point) }, 530)
    }
  }
  function move(event: ReactPointerEvent) {
    const active = touches.current, prev = active.get(event.pointerId)
    if (!prev) return
    const next = local(event.clientX, event.clientY)
    if (heldAt.current && distance(heldAt.current, next) < 5) return
    stopHold()
    const other = [...active].find(([id]) => id !== event.pointerId)?.[1]
    active.set(event.pointerId, next)
    if (other) zoomAt(distance(next, other) / Math.max(1, distance(prev, other)), midpoint(prev, other), midpoint(next, other))
    else zoomAt(1, prev, next)
  }
  function up(event: ReactPointerEvent) { touches.current.delete(event.pointerId); stopHold() }
  useEffect(() => {
    const el = viewport.current!
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.link-editor,.pin-tag-detail, .board-tag-editor,[role="menu"]')) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1)
      zoomAt(Math.exp(-Math.max(-300, Math.min(300, delta)) * .0025), local(event.clientX, event.clientY))
    }
    const clear = () => { touches.current.clear(); stopHold() }
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('blur', clear)
    return () => { clear(); el.removeEventListener('wheel', wheel); window.removeEventListener('blur', clear) }
  }, [viewport, local, zoomAt])
  return { camera, local, world, center, zoomAt, reset: () => apply(initial), panBy: (x: number, y: number) => apply({ ...live.current, x: live.current.x+x, y: live.current.y+y }),
    handlers: { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up } }
}
