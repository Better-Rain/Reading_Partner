import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Highlighter,
  LocateFixed,
  MessageSquarePlus,
  Pencil,
  Search,
  Settings,
  StickyNote,
  Trash2,
  Underline,
  Upload,
  UserRound,
  X
} from 'lucide-react'
import type { AnnotationRecord } from '../../../shared/types'
import { MarkdownContent } from './MarkdownContent'

export type AnnotationCategoryFilter = AnnotationRecord['type'] | 'vocabulary'
export type AnnotationPageScope = 'all' | 'current'
export type AnnotationSortMode = 'newest' | 'oldest' | 'page' | 'type'

export type AnnotationFilterState = {
  query: string
  categories: AnnotationCategoryFilter[]
  author: string
  pageScope: AnnotationPageScope
  sort: AnnotationSortMode
  showOnPdf: boolean
  syncToPdf: boolean
}

export type AnnotationColorPreset = {
  label: string
  value: string
}

export const defaultAnnotationFilters: AnnotationFilterState = {
  query: '',
  categories: [],
  author: 'all',
  pageScope: 'all',
  sort: 'newest',
  showOnPdf: true,
  syncToPdf: false
}

export const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso))

export const getAnnotationPreview = (annotation: AnnotationRecord): string =>
  annotation.note?.trim() || annotation.selectedText?.trim() || '书签'

const getAnnotationCategory = (annotation: AnnotationRecord): AnnotationCategoryFilter =>
  annotation.vocabularyId ? 'vocabulary' : annotation.type

const getAnnotationCategoryLabel = (category: AnnotationCategoryFilter): string => {
  if (category === 'highlight') {
    return '高亮'
  }

  if (category === 'note') {
    return '批注'
  }

  if (category === 'vocabulary') {
    return '生词'
  }

  return '书签'
}

const annotationCategoryOrder: Record<AnnotationCategoryFilter, number> = {
  highlight: 0,
  note: 1,
  vocabulary: 2,
  bookmark: 3
}
const allAnnotationCategories: AnnotationCategoryFilter[] = [
  'highlight',
  'note',
  'vocabulary',
  'bookmark'
]

export const matchesAnnotationFilters = (
  annotation: AnnotationRecord,
  filters: AnnotationFilterState,
  currentPageNumber: number,
  options: { includePageScope: boolean; includeQuery: boolean }
): boolean => {
  const category = getAnnotationCategory(annotation)

  if (filters.categories.length > 0 && !filters.categories.includes(category)) {
    return false
  }

  if (filters.author !== 'all' && (annotation.authorName || 'Reader') !== filters.author) {
    return false
  }

  if (options.includePageScope && filters.pageScope === 'current' && annotation.pageNumber !== currentPageNumber) {
    return false
  }

  const query = filters.query.trim().toLocaleLowerCase()

  if (options.includeQuery && query) {
    const haystack = [
      annotation.note,
      annotation.selectedText,
      annotation.authorName,
      getAnnotationCategoryLabel(category),
      `第 ${annotation.pageNumber} 页`
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()

    if (!haystack.includes(query)) {
      return false
    }
  }

  return true
}

const sortAnnotations = (
  annotationsToSort: AnnotationRecord[],
  sortMode: AnnotationSortMode
): AnnotationRecord[] =>
  [...annotationsToSort].sort((first, second) => {
    const firstUpdatedAt = first.updatedAt || first.createdAt
    const secondUpdatedAt = second.updatedAt || second.createdAt

    if (sortMode === 'newest') {
      return (
        secondUpdatedAt.localeCompare(firstUpdatedAt) ||
        second.createdAt.localeCompare(first.createdAt)
      )
    }

    if (sortMode === 'oldest') {
      return (
        firstUpdatedAt.localeCompare(secondUpdatedAt) ||
        first.createdAt.localeCompare(second.createdAt)
      )
    }

    if (sortMode === 'type') {
      return (
        annotationCategoryOrder[getAnnotationCategory(first)] -
          annotationCategoryOrder[getAnnotationCategory(second)] ||
        first.pageNumber - second.pageNumber ||
        first.createdAt.localeCompare(second.createdAt)
      )
    }

    return first.pageNumber - second.pageNumber || first.createdAt.localeCompare(second.createdAt)
  })

type NotesPanelProps = {
  annotations: AnnotationRecord[]
  currentPageNumber: number
  filters: AnnotationFilterState
  colorPresets: AnnotationColorPreset[]
  draftNote: string
  hasDocument: boolean
  readerName: string
  onBookmark: () => void
  onDelete: (id: string) => void
  onExportReadingMarks: () => void
  onImportReadingMarks: () => void
  onFiltersChange: (filters: AnnotationFilterState) => void
  onJump: (annotation: AnnotationRecord) => void
  onSaveNote: (note: string) => void
  onUpdateAnnotation: (id: string, note: string, color: string | null) => void
}

export function NotesPanel({
  annotations,
  currentPageNumber,
  filters,
  colorPresets,
  draftNote,
  hasDocument,
  readerName,
  onBookmark,
  onDelete,
  onExportReadingMarks,
  onImportReadingMarks,
  onFiltersChange,
  onJump,
  onSaveNote,
  onUpdateAnnotation
}: NotesPanelProps): JSX.Element {
  const draftNoteRef = useRef(draftNote)
  const draftNoteTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const filterQueryRef = useRef(filters.query)
  const filterQueryInputRef = useRef<HTMLInputElement | null>(null)
  const filterQueryTimerRef = useRef<number | null>(null)
  const [appliedFilterQuery, setAppliedFilterQuery] = useState(filters.query)
  const effectiveFilters = useMemo(
    () => ({ ...filters, query: appliedFilterQuery }),
    [appliedFilterQuery, filters]
  )
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const [editingColor, setEditingColor] = useState(colorPresets[0]?.value ?? '#f8d86a')
  const [isFilterExpanded, setIsFilterExpanded] = useState(false)
  const authors = useMemo(
    () =>
      Array.from(new Set(annotations.map((annotation) => annotation.authorName || 'Reader'))).sort(
        (first, second) => first.localeCompare(second)
      ),
    [annotations]
  )
  const filteredAnnotations = useMemo(
    () =>
      sortAnnotations(
        annotations.filter((annotation) =>
          matchesAnnotationFilters(annotation, effectiveFilters, currentPageNumber, {
            includePageScope: true,
            includeQuery: true
          })
        ),
        effectiveFilters.sort
      ),
    [annotations, currentPageNumber, effectiveFilters]
  )
  const visibleOnPdfCount = useMemo(
    () =>
      annotations.filter((annotation) =>
        annotation.pageNumber === currentPageNumber &&
        effectiveFilters.showOnPdf &&
        (!effectiveFilters.syncToPdf ||
          matchesAnnotationFilters(annotation, effectiveFilters, currentPageNumber, {
            includePageScope: false,
            includeQuery: true
          }))
      ).length,
    [annotations, currentPageNumber, effectiveFilters]
  )
  const updateFilters = (patch: Partial<AnnotationFilterState>): void => {
    onFiltersChange({ ...filters, ...patch })
  }

  useEffect(() => {
    filterQueryRef.current = filters.query
    setAppliedFilterQuery(filters.query)
    if (filterQueryInputRef.current && filterQueryInputRef.current.value !== filters.query) {
      filterQueryInputRef.current.value = filters.query
    }
  }, [filters.query])

  useEffect(() => {
    draftNoteRef.current = draftNote
    if (draftNoteTextareaRef.current && draftNoteTextareaRef.current.value !== draftNote) {
      draftNoteTextareaRef.current.value = draftNote
    }
  }, [draftNote])

  useEffect(() => {
    return () => {
      if (filterQueryTimerRef.current) {
        window.clearTimeout(filterQueryTimerRef.current)
      }
    }
  }, [])
  const toggleCategory = (category: AnnotationCategoryFilter): void => {
    const nextCategories = filters.categories.includes(category)
      ? filters.categories.filter((item) => item !== category)
      : [...filters.categories, category]

    updateFilters({
      categories:
        nextCategories.length === allAnnotationCategories.length ? [] : nextCategories
    })
  }
  const hasActiveFilters =
    effectiveFilters.query.trim() ||
    effectiveFilters.categories.length > 0 ||
    effectiveFilters.author !== 'all' ||
    effectiveFilters.pageScope !== 'all' ||
    effectiveFilters.sort !== defaultAnnotationFilters.sort ||
    !effectiveFilters.showOnPdf ||
    effectiveFilters.syncToPdf
  const hasAdvancedFilters =
    effectiveFilters.query.trim() ||
    effectiveFilters.author !== 'all' ||
    effectiveFilters.sort !== defaultAnnotationFilters.sort ||
    effectiveFilters.syncToPdf

  const toggleExpanded = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      return next
    })
  }

  const startEditing = (annotation: AnnotationRecord): void => {
    setEditingId(annotation.id)
    setEditingNote(annotation.note ?? '')
    setEditingColor(annotation.color ?? colorPresets[0]?.value ?? '#f8d86a')
  }

  const cancelEditing = (): void => {
    setEditingId(null)
    setEditingNote('')
    setEditingColor(colorPresets[0]?.value ?? '#f8d86a')
  }

  const saveEditing = (annotation: AnnotationRecord): void => {
    onUpdateAnnotation(annotation.id, editingNote, editingColor)
    cancelEditing()
  }

  return (
    <div className="inspector-content notes-panel">
      <div className="note-composer">
        <div className="reader-badge">
          <UserRound size={14} />
          当前身份：{readerName.trim() || 'Reader'}
        </div>
        <textarea
          disabled={!hasDocument}
          placeholder="写一条页边注..."
          ref={draftNoteTextareaRef}
          defaultValue={draftNote}
          onChange={(event) => {
            draftNoteRef.current = event.target.value
          }}
        />
        <div className="note-actions">
          <button
            disabled={!hasDocument}
            onClick={() => {
              onSaveNote(draftNoteRef.current)
              draftNoteRef.current = ''
              if (draftNoteTextareaRef.current) {
                draftNoteTextareaRef.current.value = ''
              }
            }}
          >
            <MessageSquarePlus size={16} />
            保存笔记
          </button>
          <button disabled={!hasDocument} onClick={onBookmark}>
            <Bookmark size={16} />
            书签
          </button>
        </div>
        <div className="note-actions">
          <button disabled={!hasDocument} onClick={onImportReadingMarks}>
            <Upload size={16} />
            导入记录
          </button>
          <button disabled={!hasDocument || annotations.length === 0} onClick={onExportReadingMarks}>
            <Download size={16} />
            导出记录
          </button>
        </div>
      </div>

      <div className="annotation-filter-panel">
        <div className="annotation-filter-compact" aria-label="笔记筛选">
          <button
            className={filters.categories.length === 0 ? 'active' : ''}
            disabled={!hasDocument}
            title="全部显示"
            onClick={() => updateFilters({ categories: [] })}
          >
            <FileText size={15} />
          </button>
          <button
            className={filters.categories.includes('highlight') ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏高亮"
            onClick={() => toggleCategory('highlight')}
          >
            <Highlighter size={15} />
          </button>
          <button
            className={filters.categories.includes('note') ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏批注"
            onClick={() => toggleCategory('note')}
          >
            <StickyNote size={15} />
          </button>
          <button
            className={filters.categories.includes('vocabulary') ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏生词批注"
            onClick={() => toggleCategory('vocabulary')}
          >
            <Underline size={15} />
          </button>
          <button
            className={filters.categories.includes('bookmark') ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏书签"
            onClick={() => toggleCategory('bookmark')}
          >
            <Bookmark size={15} />
          </button>
          <button
            className={filters.pageScope === 'current' ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏非当前页"
            onClick={() =>
              updateFilters({ pageScope: filters.pageScope === 'current' ? 'all' : 'current' })
            }
          >
            <LocateFixed size={15} />
          </button>
          <button
            className={filters.showOnPdf ? 'active' : ''}
            disabled={!hasDocument}
            title="显示/隐藏 PDF 标记"
            onClick={() => updateFilters({ showOnPdf: !filters.showOnPdf })}
          >
            <Eye size={15} />
          </button>
          <button
            className={
              isFilterExpanded || hasAdvancedFilters
                ? 'annotation-filter-advanced active'
                : 'annotation-filter-advanced'
            }
            disabled={!hasDocument}
            title="高级筛选"
            onClick={() => setIsFilterExpanded((value) => !value)}
          >
            <Settings size={15} />
          </button>
          <button
            className="annotation-filter-reset"
            disabled={!hasActiveFilters}
            title="重置筛选"
            onClick={() => {
              filterQueryRef.current = defaultAnnotationFilters.query
              setAppliedFilterQuery(defaultAnnotationFilters.query)
              if (filterQueryInputRef.current) {
                filterQueryInputRef.current.value = defaultAnnotationFilters.query
              }
              onFiltersChange(defaultAnnotationFilters)
            }}
          >
            <X size={15} />
          </button>
        </div>
        {isFilterExpanded && (
          <div className="annotation-filter-detail">
            <div className="annotation-filter-stats">
              <span>筛选 {filteredAnnotations.length} / {annotations.length} 条</span>
              <span>PDF 显示 {visibleOnPdfCount} 条</span>
            </div>
            <div className="annotation-search-row">
              <Search size={15} />
              <input
                disabled={!hasDocument}
                placeholder="搜索批注、原文、作者或页码"
                ref={filterQueryInputRef}
                defaultValue={filters.query}
                onChange={(event) => {
                  filterQueryRef.current = event.target.value
                  if (filterQueryTimerRef.current) {
                    window.clearTimeout(filterQueryTimerRef.current)
                  }
                  filterQueryTimerRef.current = window.setTimeout(() => {
                    setAppliedFilterQuery(filterQueryRef.current)
                  }, 160)
                }}
                onBlur={() => {
                  if (filterQueryTimerRef.current) {
                    window.clearTimeout(filterQueryTimerRef.current)
                    filterQueryTimerRef.current = null
                  }
                  setAppliedFilterQuery(filterQueryRef.current)
                  updateFilters({ query: filterQueryRef.current })
                }}
              />
            </div>
            <div className="annotation-filter-grid">
              <label>
                <span>作者</span>
                <select
                  disabled={!hasDocument}
                  value={filters.author}
                  onChange={(event) => updateFilters({ author: event.target.value })}
                >
                  <option value="all">全部</option>
                  {authors.map((author) => (
                    <option key={author} value={author}>
                      {author}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>排序</span>
                <select
                  disabled={!hasDocument}
                  value={filters.sort}
                  onChange={(event) =>
                    updateFilters({ sort: event.target.value as AnnotationSortMode })
                  }
                >
                  <option value="newest">最新优先</option>
                  <option value="oldest">最早优先</option>
                  <option value="page">按页码</option>
                  <option value="type">按类型</option>
                </select>
              </label>
            </div>
            <label className="annotation-sync-toggle">
              <input
                checked={filters.syncToPdf}
                disabled={!hasDocument || !filters.showOnPdf}
                type="checkbox"
                onChange={(event) => updateFilters({ syncToPdf: event.target.checked })}
              />
              筛选同步到 PDF
            </label>
          </div>
        )}
      </div>

      <div className="annotation-list">
        {annotations.length === 0 ? (
          <p className="muted">高亮、批注和书签会出现在这里。</p>
        ) : filteredAnnotations.length === 0 ? (
          <p className="muted">没有符合当前筛选条件的批注。</p>
        ) : (
          filteredAnnotations.map((annotation) => {
            const expanded = expandedIds.has(annotation.id)
            const preview = getAnnotationPreview(annotation)

            return (
              <article className="annotation-item" key={annotation.id}>
                <button
                  className="annotation-summary"
                  onClick={() => toggleExpanded(annotation.id)}
                >
                  <span className="annotation-summary-main">
                    <strong>
                      {annotation.color && (
                        <span
                          className="annotation-color-dot"
                          style={{ backgroundColor: annotation.color }}
                        />
                      )}
                      {getAnnotationCategoryLabel(getAnnotationCategory(annotation))}
                    </strong>
                    <span>{preview}</span>
                  </span>
                  <span className="annotation-summary-meta">
                    <em>{annotation.authorName || 'Reader'}</em>
                    第 {annotation.pageNumber} 页 · {formatTime(annotation.createdAt)}
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </button>

                {expanded && (
                  <div className="annotation-detail">
                    <div className="annotation-timestamp">
                      <span>{annotation.authorName || 'Reader'}</span>
                      创建于 {formatTime(annotation.createdAt)}
                      {annotation.updatedAt !== annotation.createdAt
                        ? ` · 更新于 ${formatTime(annotation.updatedAt)}`
                        : ''}
                    </div>
                    {annotation.selectedText && <blockquote>{annotation.selectedText}</blockquote>}
                    {editingId === annotation.id ? (
                      <>
                        <textarea
                          className="annotation-note-editor"
                          placeholder="写下批注..."
                          value={editingNote}
                          onChange={(event) => setEditingNote(event.target.value)}
                        />
                        <div className="annotation-color-editor">
                          <span>颜色</span>
                          {colorPresets.map((preset) => (
                            <button
                              className={editingColor === preset.value ? 'color-swatch active' : 'color-swatch'}
                              key={preset.value}
                              onClick={() => setEditingColor(preset.value)}
                              style={{ backgroundColor: preset.value }}
                              title={preset.label}
                            />
                          ))}
                        </div>
                      </>
                    ) : annotation.note ? (
                      <MarkdownContent text={annotation.note} />
                    ) : (
                      <p className="muted">还没有批注内容。</p>
                    )}
                    <div className="annotation-actions">
                      {editingId === annotation.id ? (
                        <>
                          <button
                            className="text-button neutral"
                            onClick={() => saveEditing(annotation)}
                          >
                            <Check size={14} />
                            保存
                          </button>
                          <button className="text-button" onClick={cancelEditing}>
                            <X size={14} />
                            取消
                          </button>
                        </>
                      ) : (
                        <button className="text-button neutral" onClick={() => startEditing(annotation)}>
                          <Pencil size={14} />
                          编辑
                        </button>
                      )}
                      <button className="text-button neutral" onClick={() => onJump(annotation)}>
                        <FileText size={14} />
                        跳转
                      </button>
                      <button className="text-button" onClick={() => onDelete(annotation.id)}>
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
