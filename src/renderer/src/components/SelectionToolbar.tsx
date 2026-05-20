import { useEffect, useRef } from 'react'
import {
  BookMarked,
  Check,
  Highlighter,
  Languages,
  Sparkles,
  StickyNote,
  X
} from 'lucide-react'

type SelectionToolbarProps = {
  isNoteEditorOpen: boolean
  noteDraft: string
  x: number
  y: number
  onCancelNote: () => void
  onCreateHighlight: () => void
  onCreateNote: (note: string) => void
  onCreateVocabulary: () => void
  onExplain: () => void
  onToggleNoteEditor: () => void
  onTranslate: () => void
}

export function SelectionToolbar({
  isNoteEditorOpen,
  noteDraft,
  x,
  y,
  onCancelNote,
  onCreateHighlight,
  onCreateNote,
  onCreateVocabulary,
  onExplain,
  onToggleNoteEditor,
  onTranslate
}: SelectionToolbarProps): JSX.Element {
  const noteDraftRef = useRef(noteDraft)
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    noteDraftRef.current = noteDraft
    if (noteTextareaRef.current && noteTextareaRef.current.value !== noteDraft) {
      noteTextareaRef.current.value = noteDraft
    }
  }, [noteDraft, isNoteEditorOpen])

  return (
    <div
      className={isNoteEditorOpen ? 'selection-toolbar has-note-editor' : 'selection-toolbar'}
      style={{
        left: x,
        top: y
      }}
    >
      <button title="高亮 (H)" onClick={onCreateHighlight}>
        <Highlighter size={16} />
        高亮
      </button>
      <button title="批注 (N)" onClick={onToggleNoteEditor}>
        <StickyNote size={16} />
        批注
      </button>
      <button title="翻译" onClick={onTranslate}>
        <Languages size={16} />
        翻译
      </button>
      <button title="解释" onClick={onExplain}>
        <Sparkles size={16} />
        解释
      </button>
      <button title="加入词汇本" onClick={onCreateVocabulary}>
        <BookMarked size={16} />
        生词
      </button>
      {isNoteEditorOpen && (
        <div className="selection-note-editor">
          <textarea
            autoFocus
            ref={noteTextareaRef}
            placeholder="写下这段原文的批注..."
            defaultValue={noteDraft}
            onChange={(event) => {
              noteDraftRef.current = event.target.value
            }}
          />
          <div className="selection-note-actions">
            <button title="保存批注" onClick={() => onCreateNote(noteDraftRef.current.trim() || '待补充笔记')}>
              <Check size={15} />
              保存
            </button>
            <button title="取消" onClick={onCancelNote}>
              <X size={15} />
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
