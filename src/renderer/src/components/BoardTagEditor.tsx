import { useState } from 'react'
import type { DocumentRecord, ShelfTag } from '../../../shared/types'

type Props = {
  tag: ShelfTag
  books: DocumentRecord[]
  otherTags: ShelfTag[]
  existing: boolean
  saving: boolean
  onSave: (tag: ShelfTag) => void
  onDelete: () => void
  onClose: () => void
}

export function BoardTagEditor({ tag, books, otherTags, existing, saving, onSave, onDelete, onClose }: Props): JSX.Element {
  const [text, setText] = useState(tag.text)
  const [links, setLinks] = useState(tag.books)
  const [related, setRelated] = useState(tag.relatedTagIds ?? [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  return <form className="board-tag-editor" onSubmit={event => {
    event.preventDefault()
    onSave({ ...tag, text: text.trim(), relatedTagIds: related.filter(id => otherTags.some(other => other.id === id)), books: links.filter(id => books.some(book => book.id === id)) })
  }}>
    <label>标签内容<textarea autoFocus aria-label="标签内容" maxLength={800} required value={text} onChange={e => setText(e.target.value)}/></label>
    <fieldset className="shelf-picker"><legend>关联书籍 · 留空表示整组</legend>
      {books.map(book => <label key={book.id}><input type="checkbox" checked={links.includes(book.id)} onChange={e => setLinks(e.target.checked ? [...links, book.id] : links.filter(id => id !== book.id))}/>{book.title.replace(/\.pdf$/i, '')}</label>)}
    </fieldset>
    {otherTags.length > 0 && <fieldset className="shelf-picker"><legend>关联标签</legend>
      {otherTags.map(other => <label key={other.id}><input type="checkbox" value={other.id} checked={related.includes(other.id)}
        onChange={e => setRelated(e.target.checked ? [...related, other.id] : related.filter(id => id !== other.id))}/><span title={other.text}>{other.text}</span></label>)}
    </fieldset>}
    <div className="shelf-controls"><button className="shelf-submit" disabled={saving || !text.trim()}>保存标签</button><button type="button" onClick={onClose}>取消</button>
      {existing && <button type="button" disabled={saving} onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>{confirmDelete ? '确认删除标签' : '删除标签'}</button>}
    </div>
  </form>
}
