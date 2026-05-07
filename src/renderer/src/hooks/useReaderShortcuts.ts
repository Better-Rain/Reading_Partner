import { useEffect } from 'react'

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

type ReaderShortcutsOptions = {
  hasDocument: boolean
  hasSelection: boolean
  onCreateHighlight: () => void
  onOpenNoteEditor: () => void
  onTogglePanMode: () => void
  onUndoAnnotation: () => void
}

export const useReaderShortcuts = ({
  hasDocument,
  hasSelection,
  onCreateHighlight,
  onOpenNoteEditor,
  onTogglePanMode,
  onUndoAnnotation
}: ReaderShortcutsOptions): void => {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        key === 'z' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault()
        onUndoAnnotation()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) {
        return
      }

      if (key === 'd') {
        event.preventDefault()
        onTogglePanMode()
        return
      }

      if (!hasDocument || !hasSelection) {
        return
      }

      if (key === 'h') {
        event.preventDefault()
        onCreateHighlight()
      }

      if (key === 'n') {
        event.preventDefault()
        onOpenNoteEditor()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [
    hasDocument,
    hasSelection,
    onCreateHighlight,
    onOpenNoteEditor,
    onTogglePanMode,
    onUndoAnnotation
  ])
}
