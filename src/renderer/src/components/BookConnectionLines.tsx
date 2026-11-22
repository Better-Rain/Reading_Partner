import type { BookConnection } from '../../../shared/types'
import type { BoardPoint } from './useBoardCamera'

type Props = {
  links: BookConnection[]
  points: Map<string, BoardPoint>
  bookOffset: number
  label: (link: BookConnection) => string
  onInspect: (link: BookConnection, x: number, y: number) => void
  onHover: (link: BookConnection | null, x: number, y: number) => void
}

export function BookConnectionLines({ links, points, bookOffset, label, onInspect, onHover }: Props) {
  return <svg className="pin-connections" width="1" height="1" aria-label="书间连线">{links.map(link => {
    const a = points.get(link.from), b = points.get(link.to)
    if (!a || !b) return null
    const ax = a.x+68, ay = a.y+bookOffset+6, bx = b.x+68, by = b.y+bookOffset+6
    const bend = Math.abs(ax-bx) < 150 ? 115 : 0
    const d = `M ${ax} ${ay} Q ${(ax+bx)/2+bend} ${(ay+by)/2-64} ${bx} ${by}`
    return <g key={link.id}>
      <path className="book-link-ink" d={d}/>
      <path className="book-link-hit" data-connection={link.id} role="button" tabIndex={0} d={d}
        aria-label={`${label(link)}。${link.summary || '添加简述'}`} onPointerMove={event => {
          if (event.pointerType === 'mouse') onHover(link,event.clientX,event.clientY)
        }} onPointerLeave={() => onHover(null,0,0)} onClick={event => onInspect(link,event.clientX,event.clientY)}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          onInspect(link,rect.left+rect.width/2,rect.top+rect.height/2)
        }}/>
    </g>
  })}</svg>
}
