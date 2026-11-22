import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { BookConnection, DocumentRecord, ShelfGroup, ShelfTag, TagPlacement } from '../../../shared/types'
import { BookConnectionLines } from './BookConnectionLines'
import { BoardTagEditor } from './BoardTagEditor'
import { createPortal } from 'react-dom'
import { Minus, Plus, Focus, Tag, Link2 } from 'lucide-react'
import { useBookMarquee } from './useBookMarquee'
import { useBoardCamera } from './useBoardCamera'
import type { AnnotationColorPreset } from './NotesPanel'
import { ShelfCover } from './ShelfCover'

type Point = { x: number; y: number }
type ItemKind = 'book' | 'tag'
type Gesture = { kind: ItemKind; id: string; pointer: number; from: Point; start: Point; moved: boolean }
type Props = {
  connections: BookConnection[]
  onSaveConnection: (link: BookConnection, remove?: boolean) => Promise<boolean>
  tags: ShelfTag[]
  onUpdateTag: (tag: ShelfTag, remove?: boolean, optimistic?: boolean) => Promise<boolean>
  toolbar: HTMLDivElement | null
  presets: AnnotationColorPreset[]
  tagColor: string
  setTagColor: (value: string) => void
  aiDisabled: boolean
  onAiTag: (placement: TagPlacement) => void
  order: string[]
  books: DocumentRecord[]
  groups: ShelfGroup[]
  positions: Record<string, Point>
  disabled: boolean
  onOpen: (book: DocumentRecord) => void
  onMove: (id: string, point: Point) => void
  onAdd: (group: string, id: string, add: boolean) => void
}
const ink = ['#9d493b', '#446577', '#785c86', '#76804a', '#955f27']
const slots = [[32,54],[259,28],[471,81],[119,314],[356,278],[567,337]] as const
const defaultPoint = (index: number): Point => {
  const [x,y] = slots[index % slots.length]!
  return { x, y: y + Math.floor(index / slots.length) * 558 }
}
const clamp = (n: number) => Math.round(Math.max(-1000000, Math.min(1000000,n)))
const color = (id: string) => ink[Array.from(id).reduce((sum, c) => sum + c.charCodeAt(0), 0) % ink.length]!

export function Pinboard({ connections, onSaveConnection, tags, onUpdateTag, toolbar, presets, tagColor, setTagColor, aiDisabled, onAiTag, order, books, groups, positions, disabled, onOpen, onMove, onAdd }: Props): JSX.Element {
  const scroll = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{screen: Point; position: Point; books: string[]; targetTag?: ShelfTag} | null>(null)
  const [draft, setDraft] = useState<ShelfTag | null>(null)
  const view = useBoardCamera(scroll, openMenu)
  const marquee = useBookMarquee()
  const { scale } = view.camera
  const [linkMode, setLinkMode] = useState(false)
  const [firstBook, setFirstBook] = useState<string | null>(null)
  const [linkEditor, setLinkEditor] = useState<BookConnection | null>(null)
  const [hover, setHover] = useState<{link: BookConnection; point: Point} | null>(null)
  function exitLinkMode() { setFirstBook(null); setLinkMode(false) }
  function pickBook(id: string) {
    if (!firstBook || firstBook === id) { setFirstBook(firstBook === id ? null : id); return }
    openPair(firstBook, id)
  }
  function openPair(from: string, to: string) {
    const existing = connections.find(link => (link.from === from && link.to === to) || (link.from === to && link.to === from))
    setLinkEditor(existing ?? { id: crypto.randomUUID(), from, to, summary: '', author: 'user' })
    setHover(null); exitLinkMode(); marquee.clear()
  }
  function linkLabel(link: BookConnection) {
    const title = (id: string) => books.find(book => book.id === id)?.title.replace(/\.pdf$/i, '') ?? '书籍'
    return `${title(link.from)} ↔ ${title(link.to)}`
  }
  async function finishLink(remove = false) {
    if (linkEditor && await onSaveConnection(linkEditor, remove)) setLinkEditor(null)
  }
  function locationAt(point: Point) {
    const world = view.world(point)
    return { x: clamp(world.x), y: clamp(world.y) }
  }
  function openMenu(point: Point, targetTag?: ShelfTag) {
    const selected = marquee.ids.filter(id => books.some(book => book.id === id))
    setMenu({ screen: point, position: locationAt(point), books: selected, ...(targetTag ? {targetTag} : {}) })
  }
  const menuBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    menuBox.current?.querySelector('button')?.focus({preventScroll:true})
    const dismiss = (e: PointerEvent) => { if (!menuBox.current?.contains(e.target as Node)) setMenu(null) }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [menu])
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const [preview, setPreview] = useState<{ kind: ItemKind; id: string; point: Point } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const expandedCard = useRef<HTMLElement>(null)
  function expand(id: string | null) {
    setEditing(false)
    setExpandedId(id)
    if (draft && draft.id !== id) setDraft(null)
  }
  const [available, setAvailable] = useState(760)
  useEffect(() => {
    if (!scroll.current) return
    const observer = new ResizeObserver(([entry]) => { if (entry?.contentRect.width) setAvailable(entry.contentRect.width) })
    observer.observe(scroll.current)
    return () => observer.disconnect()
  }, [])
  const cards = draft ? [...tags, draft] : tags
  const selected = cards.find(tag => tag.id === expandedId)
  function chooseColor(value: string) {
    setTagColor(value)
    if (!selected) return
    if (selected.id === draft?.id) setDraft({ ...selected, color: value })
    else void onUpdateTag({ ...selected, color: value }, false, true)
  }
  function newTag(position: Point, bookIds = marquee.ids, relatedTagIds: string[] = []) {
    const tag: ShelfTag = { id: crypto.randomUUID(), text: '', author: 'user', books: books.filter(book => bookIds.includes(book.id)).map(book => book.id), relatedTagIds, color: tagColor, position }
    setDraft(tag); setExpandedId(tag.id); setEditing(true); setMenu(null)
  }
  const indexes = new Map(order.map((id,i) => [id,i]))
  const points = new Map(books.map((book) => [book.id, preview?.kind === 'book' && preview.id === book.id ? preview.point : positions[book.id] ?? defaultPoint(indexes.get(book.id) ?? 0)]))
  // Keep the legacy auto-layout independent of the camera and of newly placed tags.
  const layoutWidth = Math.max(750, ...Object.values(positions).map(point => point.x + 180))
  const tagColumns = Math.max(1, Math.floor(layoutWidth / 240))
  const [bookOffset] = useState(() => Math.ceil(tags.length / tagColumns) * 108)
  const expandedWidth = Math.min(420, Math.max(96, (available - 16) / scale))
  const tagPoints = new Map(cards.map((tag, index) => [tag.id,
    preview?.kind === 'tag' && preview.id === tag.id ? preview.point : tag.position ?? {
      x: 16 + index % tagColumns * 240, y: 8 + Math.floor(index / tagColumns) * 108
    }]))
  useLayoutEffect(() => {
    const card = expandedCard.current
    const viewport = scroll.current
    if (!card || !viewport) return
    const rect = card.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    // Reveal the start of long notes while keeping scrolling inside the board.
    view.panBy(-Math.min(rect.left - bounds.left - 4, Math.max(0, rect.right - bounds.left - viewport.clientWidth + 4)),
      -Math.min(rect.top - bounds.top - 4, Math.max(0, rect.bottom - bounds.top - viewport.clientHeight + 4)))
  }, [expandedId, expandedWidth])
  const boardPoint = (x: number, y: number) => view.world(view.local(x,y))
  function updated(e: PointerEvent, g: Gesture): Point {
    const p = boardPoint(e.clientX, e.clientY)
    return { x: clamp(g.from.x + p.x - g.start.x), y: clamp(g.from.y + p.y - g.start.y) }
  }
  function start(e: ReactPointerEvent, id: string, kind: ItemKind = 'book') {
    if (e.button !== 0 || !e.isPrimary) return
    suppressClick.current = false
    if (kind === 'tag' && id === draft?.id) return
    if ((linkMode || disabled) && kind === 'book') return
    gesture.current = { kind, id, pointer: e.pointerId, from: (kind === 'tag' ? tagPoints : points).get(id)!, start: boardPoint(e.clientX,e.clientY), moved:false }
    // Capture on the actual button so a stationary click still opens the book.
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    const g = gesture.current
    if (disabled || !g || e.pointerId !== g.pointer) return
    const next = updated(e,g)
    if (!g.moved && Math.hypot(next.x-g.from.x,next.y-g.from.y) < 5) return
    g.moved = true
    setPreview({ kind:g.kind, id:g.id, point:updated(e,g) })
  }
  function finish(e: PointerEvent) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointer) return
    gesture.current = null
    if (!g.moved && g.kind === 'tag' && e.pointerType === 'touch') {
      suppressClick.current = true
      if (!editing || expandedId !== g.id) expand(expandedId === g.id ? null : g.id)
    }
    if (g.moved) {
      suppressClick.current = true
      const group = document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-shelf-group]')?.dataset.shelfGroup
      if (g.kind === 'tag') {
        const tag = tags.find(item => item.id === g.id)
        if (tag) void onUpdateTag({ ...tag, position: updated(e,g) }, false, true)
      } else if (group) onAdd(group,g.id,true)
      else onMove(g.id,updated(e,g))
    }
    setPreview(null)
  }
  useEffect(() => {
    const cancel = () => { gesture.current = null; setPreview(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  })
  const threads = groups.filter(group => group.books.some(id => points.has(id)))
  return <div className="pin-workspace">
    {toolbar && createPortal(<>
      <button className="icon-button" title="新建标签" disabled={disabled || !!draft} onClick={() => newTag(locationAt(view.center()))}><Tag size={17}/></button>
      <button title="连接两本书 (L)" aria-label="连接两本书" aria-keyshortcuts="L" className={'icon-button' + (linkMode ? ' active' : '')} aria-pressed={linkMode} disabled={disabled || books.length < 2 || !!draft} onClick={() => {
        const [from, to] = marquee.ids
        if (marquee.ids.length === 2 && from && to) { openPair(from, to); return }
        marquee.clear(); setLinkEditor(null); setHover(null); setFirstBook(null); setLinkMode(!linkMode)
      }}><Link2 size={16}/></button>
      <div className="reader-color-palette" aria-label="标签颜色">{presets.map(preset => {
        const active = (selected ? selected.color ?? color(selected.id) : tagColor) === preset.value
        return <button key={preset.value} type="button" className={'color-swatch' + (active ? ' active' : '')} aria-pressed={active} title={'标签颜色：'+preset.label} style={{backgroundColor:preset.value}} disabled={disabled} onClick={() => chooseColor(preset.value)}/>
      })}</div>
      <button className="icon-button" title="缩小画布" onClick={() => view.zoomAt(.8,view.center())}><Minus size={16}/></button><output>{Math.round(scale*100)}%</output>
      <button className="icon-button" title="放大画布" onClick={() => view.zoomAt(1.25,view.center())}><Plus size={16}/></button>
      <button className="icon-button" title="回到原点" onClick={view.reset}><Focus size={16}/></button>
    </>, toolbar)}
    {(linkMode || marquee.ids.length > 0) && (
      <div className="pin-controls">
        <small role="status">
          {linkMode
            ? (firstBook ? '已选第一本书，再点另一本书建立连线。' : '依次点选两本书。')
            : `已选 ${marquee.ids.length} 本书。${marquee.ids.length === 2 ? '按 L 连书，或右键写标签。' : '右键写标签，Esc 清除选择。'}`}
        </small>
        {linkMode && <button onClick={exitLinkMode}>取消连书</button>}
      </div>
    )}
    <div className="pin-viewport" ref={scroll} style={{ backgroundPosition: `${view.camera.x}px ${view.camera.y}px`, backgroundSize: `${20*scale}px ${20*scale}px`, '--card-max-height': `${Math.max(84, (scroll.current?.clientHeight ?? 480) / scale - 54)}px` } as CSSProperties} {...view.handlers}
      onPointerDown={e => {
        if (!linkMode && !linkEditor && !editing && !disabled && !menu) marquee.down(e)
        view.handlers.onPointerDown(e)
      }}
      onPointerMove={e => { marquee.move(e); view.handlers.onPointerMove(e) }}
      onPointerUp={e => { marquee.up(e); view.handlers.onPointerUp(e) }}
      onLostPointerCapture={e => { marquee.cancel(e); view.handlers.onLostPointerCapture(e) }}
      onPointerCancel={e => { marquee.cancel(e); view.handlers.onPointerCancel(e) }}
      onAuxClick={e => { if (e.button === 1) e.preventDefault() }} onContextMenu={event => {
      const target = event.target as Element
      if (target.closest('form,[role="menu"]') || editing) return
      const tagId = target.closest<HTMLElement>('[data-shelf-tag]')?.dataset.shelfTag
      const bookId = target.closest<HTMLElement>('[data-shelf-book]')?.dataset.shelfBook
      if (bookId && !marquee.ids.includes(bookId)) return
      if (!bookId && !tagId && target.closest('button,article')) return
      event.preventDefault(); openMenu(view.local(event.clientX,event.clientY), tags.find(tag => tag.id === tagId))
    }} tabIndex={0} aria-label="封面线索板" onClick={event => {
      if (!editing && !(event.target as Element).closest('button, .pin-tag')) expand(null)
    }} onKeyDown={event => {
      if (menu && event.key === 'Escape') { setMenu(null); scroll.current?.focus(); return }
      if (event.key === 'Escape' && marquee.ids.length) { marquee.clear(); return }
      if (event.key.toLowerCase() === 'l' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat && !event.nativeEvent.isComposing &&
          !(event.target as Element).closest('input,textarea,select,[contenteditable=true]') && !linkEditor && !editing && !menu && !disabled && !marquee.box) {
        const [from,to] = marquee.ids
        if (marquee.ids.length === 2 && from && to && [from,to].every(id => points.has(id))) { event.preventDefault(); openPair(from,to) }
        return
      }
      if (event.key === 'Escape' && (linkEditor || linkMode)) { setLinkEditor(null); exitLinkMode(); return }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openMenu(view.center()); return }
      if (expandedId && event.key === 'Escape' && !editing) {
        expandedCard.current?.querySelector('button')?.focus({ preventScroll: true })
        expand(null)
      }
    }}>
      <div className="pin-plane" style={{transform:`translate(${view.camera.x}px,${view.camera.y}px) scale(${scale})`}}>
        <svg aria-hidden="true" className="pin-threads" width="1" height="1">{threads.map(g => {
          const anchors = g.books.flatMap(id => points.has(id) ? [points.get(id)!] : [])
          return <g key={g.id} stroke={color(g.id)}>{anchors.slice(1).map((b,i) => { const a=anchors[i]!; return <path key={i} d={`M${a.x+68} ${a.y+bookOffset+6} Q${(a.x+b.x)/2+68} ${(a.y+b.y)/2+bookOffset+27} ${b.x+68} ${b.y+bookOffset+6}`}/> })}</g>
        })}{tags.map(tag => {
          const start = tagPoints.get(tag.id)!
          return <g key={tag.id} stroke={tag.color ?? color(tag.id)} strokeDasharray="5 4">{tag.books.map(id => {
            const end = points.get(id)
            return end && <path key={id} d={`M${start.x+102} ${start.y+88} L${end.x+68} ${end.y+bookOffset+6}`}/>
          })}</g>
        })}{tags.flatMap(tag => (tag.relatedTagIds ?? []).filter(id => tag.id < id).map(id => {
          const start = tagPoints.get(tag.id), end = tagPoints.get(id)
          return start && end && <path key={`${tag.id}:${id}`} data-tag-relation="true" stroke="#765789" strokeDasharray="2 5" d={`M${start.x+104} ${start.y+44} L${end.x+104} ${end.y+44}`}/>
        }))}</svg>
        <BookConnectionLines links={connections} points={points} bookOffset={bookOffset} label={linkLabel}
          onInspect={link => { setLinkEditor(link); setHover(null); exitLinkMode() }}
          onHover={(link,x,y) => setHover(link && !linkEditor && !linkMode ? {link, point:view.local(x,y)} : null)}/>
        {cards.map(tag => {
          const otherTags = tags.filter(other => other.id !== tag.id)
          const point = tagPoints.get(tag.id)!
          const open = expandedId === tag.id
          const moving = preview?.kind === 'tag' && preview.id === tag.id
          const titles = books.filter(book => tag.books.includes(book.id)).map(book => book.title.replace(/\.pdf$/i, ''))
          return <article key={tag.id} ref={open ? expandedCard : undefined} data-shelf-tag={tag.id}
            className={`pin-tag${open ? ' expanded' : ''}${moving ? ' moving' : ''}`}
            style={{left: point.x, top: point.y, width: open ? expandedWidth : 208, borderTopColor: tag.color ?? color(tag.id)}}>
            <button className="pin-tag-handle" aria-expanded={open} onPointerDown={e => start(e, tag.id, 'tag')}
              onClick={e => {
                if (e.detail && suppressClick.current) { suppressClick.current = false; return }
                if (!editing || !open) expand(open ? null : tag.id)
              }}>
              <small>{tag.author === 'ai' ? 'AI' : '我的标签'} · {tag.books.length ? `关联 ${tag.books.length} 本书` : '整组'}</small>
              {open ? <small>{editing ? '编辑中' : '收起'}</small> : <span>{tag.text}</span>}
            </button>
            {open && (editing ? <BoardTagEditor tag={tag} books={books} otherTags={otherTags} existing={tag.id !== draft?.id} saving={disabled}
              onSave={async next => { if (await onUpdateTag(next)) { setDraft(null); setEditing(false) } }}
              onDelete={async () => { if (await onUpdateTag(tag, true)) expand(null) }} onClose={() => draft ? expand(null) : setEditing(false)}/>
              : <div className="pin-tag-detail"><p>{tag.text}</p>
                {titles.length > 0 && <ul aria-label="关联书籍">{titles.map((title,i) => <li key={i}>{title}</li>)}</ul>}
                {!!tag.relatedTagIds?.length && <div className="related-tag-list" aria-label="关联标签"><small>关联标签</small>{otherTags.filter(other => tag.relatedTagIds?.includes(other.id)).map(other =>
                  <button key={other.id} title={other.text} onClick={() => expand(other.id)}>{other.text}</button>)}</div>}
                <button onClick={() => setEditing(true)}>编辑标签</button></div>)}
          </article>
        })}
        {books.map((book,i) => { const p=points.get(book.id)!;return <button key={book.id} data-box-selected={marquee.ids.includes(book.id) || undefined} aria-pressed={linkMode ? firstBook === book.id : undefined} className={'pin-book'+(preview?.id===book.id?' moving':'')} data-shelf-book={book.id} title={book.title} style={{left:p.x,top:p.y+bookOffset,'--tilt':`${[-3,2,-1,3,-2,1][i%6]}deg`} as CSSProperties}
          onPointerDown={e => start(e,book.id)}
          onDragStart={e => e.preventDefault()} onClick={e => { if (e.detail && suppressClick.current) { suppressClick.current=false; return } if (linkMode) pickBook(book.id); else onOpen(book) }}
          onKeyDown={e => { const delta = {ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key]; if (!delta || disabled) return; e.preventDefault(); onMove(book.id,{x:clamp(p.x+delta[0]!),y:clamp(p.y+delta[1]!)}) }}>
          <ShelfCover book={book}/><strong>{book.title.replace(/\.pdf$/i,'')}</strong></button> })}
      </div>
      {marquee.box && <div aria-hidden="true" className="book-marquee" style={marquee.box}/>}
      {hover && <aside role="tooltip" className="link-tip" style={{left:Math.max(4,Math.min(hover.point.x+10,(scroll.current?.clientWidth ?? 300)-260)),top: hover.point.y > (scroll.current?.clientHeight ?? 300)/2 ? undefined : hover.point.y+12, bottom: hover.point.y > (scroll.current?.clientHeight ?? 300)/2 ? (scroll.current?.clientHeight ?? 300)-hover.point.y+10 : undefined}}>{hover.link.summary || '点击添加简述'}</aside>}
      {linkEditor && <form className="link-editor" onSubmit={event => { event.preventDefault(); void finishLink() }}>
        <strong>{linkEditor.author === 'ai' ? 'AI 连线' : '书间连线'}</strong><div className="link-endpoints" title={linkLabel(linkEditor)}>{linkLabel(linkEditor)}</div>
        <label>连线简述<textarea aria-label="连线简述" maxLength={800} value={linkEditor.summary} placeholder="这两本书有什么联系？" onChange={event => setLinkEditor({...linkEditor,summary:event.target.value})}/></label>
        <div className="shelf-controls"><button disabled={disabled}>保存连线</button><button type="button" onClick={() => setLinkEditor(null)}>关闭</button>
          {connections.some(link => link.id === linkEditor.id) && <button type="button" disabled={disabled} onClick={() => void finishLink(true)}>删除连线</button>}</div>
      </form>}
      {menu && <div className="pin-menu" role="menu" aria-label="画布操作" ref={menuBox} style={{left:Math.max(0,Math.min(menu.screen.x,scroll.current!.clientWidth-154)),top:Math.max(0,Math.min(menu.screen.y,scroll.current!.clientHeight-(menu.targetTag && menu.books.length ? 180 : 140)))}}>
        <button role="menuitem" disabled={disabled || !!draft} onClick={() => newTag(menu.position, menu.books, menu.targetTag ? [menu.targetTag.id] : [])}>{menu.targetTag ? '写关联标签' : '在此写标签'}{menu.books.length ? ` · ${menu.books.length} 本书` : ''}</button>
        {menu.targetTag && menu.books.length > 0 && <button role="menuitem" disabled={disabled} onClick={async () => {
          const target = menu.targetTag!
          if (await onUpdateTag({ ...target, books: [...new Set([...target.books, ...menu.books])] })) setMenu(null)
        }}>将所选书加到此标签</button>}
        <button role="menuitem" disabled={aiDisabled} onClick={() => { onAiTag({position:menu.position,color:tagColor,selectedBookIds:menu.books}); setMenu(null) }}>AI 在此写标签</button>
        <button role="menuitem" onClick={() => { view.reset(); setMenu(null) }}>回到原点</button>
      </div>}
    </div>
    {threads.length > 0 && <div className="pin-legend" aria-label="同组连线">{threads.map(g => <span key={g.id}><i style={{background:color(g.id)}}/>{g.name}</span>)}</div>}
  </div>
}
