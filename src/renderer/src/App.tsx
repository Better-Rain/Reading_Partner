import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent } from 'react'
import type { Source } from 'react-pdf/dist/shared/types.js'
import { Document, Page } from 'react-pdf'
import {
  Bookmark,
  BookMarked,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Highlighter,
  Hand,
  KeyRound,
  Languages,
  Maximize2,
  MessageSquarePlus,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X
} from 'lucide-react'
import {
  AIChatMessageRecord,
  AIConversationRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  AnnotationRecord,
  DictionaryEntryRecord,
  DocumentSearchResult,
  DocumentRecord,
  OpenPdfResult,
  ProviderKeyStatus,
  DictionarySourceRecord,
  VocabularyRecord
} from '../../shared/types'

type PanelTab = 'notes' | 'search' | 'ai' | 'vocab' | 'settings'
type AnnotationInteractionMode = 'inspect' | 'select'

type SelectionState = {
  text: string
  x: number
  y: number
  rects: AnnotationRect[]
}

type AnnotationRect = {
  left: number
  top: number
  width: number
  height: number
}

type AnnotationColorPreset = {
  label: string
  value: string
}

type HoveredAnnotation = {
  annotation: AnnotationRecord
  x: number
  y: number
}

type ActiveSearchTarget = {
  nonce: number
  query: string
  result: DocumentSearchResult
}

type TemporarySearchHighlight = {
  id: string
  pageNumber: number
  text: string
  rects: AnnotationRect[]
}

type TextLayerPosition = {
  node: Text
  offset: number
}

type TextLayerSearchIndex = {
  text: string
  positions: TextLayerPosition[]
}

type AnnotationUndoAction =
  | {
      kind: 'create'
      annotation: AnnotationRecord
    }
  | {
      kind: 'delete'
      annotation: AnnotationRecord
    }
  | {
      kind: 'update'
      before: AnnotationRecord
      after: AnnotationRecord
    }

type AIRunState = {
  requestId: string
  promptType: AIPromptType
  inputText: string
  providerLabel: string
  model: string
  output: string
  status: 'idle' | 'running' | 'done' | 'error'
  error: string | null
  source: 'selection' | 'vocabulary' | 'document_qa' | 'chat'
  conversationId?: string
  vocabularyId?: string
}

const promptLabels: Record<AIPromptType, string> = {
  translate_selection: '翻译',
  explain_selection: '解释',
  summarize_selection: '总结',
  define_vocabulary: '词汇释义',
  ask_document: '文档问答',
  chat_document: '共读对话'
}

const makeDefinitionFromDictionary = (entry: NonNullable<Awaited<ReturnType<typeof window.readingPartner.lookupDictionary>>['entry']>): string => {
  const lines = [
    entry.translation ? `释义：${entry.translation}` : null,
    entry.definition ? `英文释义：${entry.definition}` : null,
    entry.phonetic ? `音标：${entry.phonetic}` : null,
    entry.pos ? `词性：${entry.pos}` : null,
    entry.exchange ? `词形：${entry.exchange}` : null
  ].filter(Boolean)

  return lines.join('\n') || '待补充释义'
}

const minScale = 0.75
const maxScale = 3
const scaleStep = 0.12

const annotationColorPresets: AnnotationColorPreset[] = [
  { label: '黄色', value: '#f8d86a' },
  { label: '绿色', value: '#9be38f' },
  { label: '蓝色', value: '#7db7ff' },
  { label: '粉色', value: '#ff9cc7' },
  { label: '紫色', value: '#c5a3ff' }
]

const clampScale = (value: number): number =>
  Math.min(maxScale, Math.max(minScale, Number(value.toFixed(2))))

const roundRectValue = (value: number): number => Number(value.toFixed(2))

const rectArea = (rect: AnnotationRect): number => rect.width * rect.height

const rectOverlapArea = (first: AnnotationRect, second: AnnotationRect): number => {
  const left = Math.max(first.left, second.left)
  const top = Math.max(first.top, second.top)
  const right = Math.min(first.left + first.width, second.left + second.width)
  const bottom = Math.min(first.top + first.height, second.top + second.height)

  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

const normalizeAnnotationRects = (rects: AnnotationRect[]): AnnotationRect[] => {
  const sorted = [...rects].sort((first, second) => {
    const topDelta = first.top - second.top

    if (Math.abs(topDelta) > 1) {
      return topDelta
    }

    const areaDelta = rectArea(second) - rectArea(first)

    if (Math.abs(areaDelta) > 1) {
      return areaDelta
    }

    return first.left - second.left
  })

  return sorted.filter((rect, index) => {
    const area = rectArea(rect)

    if (area <= 0) {
      return false
    }

    return !sorted.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false
      }

      const candidateArea = rectArea(candidate)

      if (candidateArea < area) {
        return false
      }

      if (Math.abs(candidateArea - area) <= 0.5 && candidateIndex > index) {
        return false
      }

      const overlap = rectOverlapArea(rect, candidate)

      return overlap / area >= 0.82
    })
  })
}

const parseAnnotationRects = (rectsJson: string | null): AnnotationRect[] => {
  if (!rectsJson) {
    return []
  }

  try {
    const parsed = JSON.parse(rectsJson) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    const rects = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const rect = item as Partial<Record<keyof AnnotationRect, unknown>>
        const left = Number(rect.left)
        const top = Number(rect.top)
        const width = Number(rect.width)
        const height = Number(rect.height)

        if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          return null
        }

        return { left, top, width, height }
      })
      .filter((item): item is AnnotationRect => Boolean(item))

    return normalizeAnnotationRects(rects)
  } catch {
    return []
  }
}

const isSearchTextChar = (value: string): boolean => /^[\p{L}\p{N}]$/u.test(value)

const normalizeSearchText = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getSearchTerms = (query: string): string[] =>
  Array.from(new Set(normalizeSearchText(query).split(' ').filter(Boolean))).slice(0, 8)

const buildTextLayerSearchIndex = (textLayer: HTMLElement): TextLayerSearchIndex => {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  let text = ''
  const positions: TextLayerPosition[] = []
  let node = walker.nextNode() as Text | null

  const appendSpace = (position: TextLayerPosition): void => {
    if (text && !text.endsWith(' ')) {
      text += ' '
      positions.push(position)
    }
  }

  while (node) {
    const value = node.nodeValue ?? ''

    for (let offset = 0; offset < value.length; offset += 1) {
      const char = value[offset]
      const position = { node, offset }

      if (isSearchTextChar(char)) {
        text += char.toLocaleLowerCase()
        positions.push(position)
      } else {
        appendSpace(position)
      }
    }

    node = walker.nextNode() as Text | null
  }

  return {
    text,
    positions
  }
}

const findAnchoredSearchMatch = (
  pageText: string,
  candidateText: string,
  terms: string[]
): { start: number; end: number } | null => {
  const normalizedCandidate = normalizeSearchText(candidateText)

  if (!normalizedCandidate) {
    return null
  }

  const exactStart = normalizedCandidate.length <= 260 ? pageText.indexOf(normalizedCandidate) : -1

  if (exactStart !== -1) {
    return {
      start: exactStart,
      end: exactStart + normalizedCandidate.length
    }
  }

  const matchedTerm = terms.find((term) => normalizedCandidate.includes(term))

  if (!matchedTerm) {
    return null
  }

  const termIndex = normalizedCandidate.indexOf(matchedTerm)
  const radii = [180, 120, 80, 48, 24, matchedTerm.length]

  for (const radius of radii) {
    const anchorStart = Math.max(0, termIndex - radius)
    const anchorEnd = Math.min(normalizedCandidate.length, termIndex + matchedTerm.length + radius)
    const anchor = normalizedCandidate.slice(anchorStart, anchorEnd).trim()

    if (anchor.length < matchedTerm.length) {
      continue
    }

    const pageAnchorStart = pageText.indexOf(anchor)

    if (pageAnchorStart !== -1) {
      const termOffset = anchor.indexOf(matchedTerm)

      return {
        start: pageAnchorStart + Math.max(0, termOffset),
        end: pageAnchorStart + Math.max(0, termOffset) + matchedTerm.length
      }
    }
  }

  return null
}

const findSearchMatch = (
  index: TextLayerSearchIndex,
  result: DocumentSearchResult,
  query: string
): { start: number; end: number } | null => {
  const terms = getSearchTerms(query)
  const candidates = [result.text, result.snippet.replace(/^\.+|\.+$/g, '')].filter(Boolean)

  for (const candidate of candidates) {
    const anchoredMatch = findAnchoredSearchMatch(index.text, candidate, terms)

    if (anchoredMatch) {
      return anchoredMatch
    }
  }

  const exactQuery = normalizeSearchText(query)
  const exactStart = exactQuery ? index.text.indexOf(exactQuery) : -1

  if (exactStart !== -1) {
    return {
      start: exactStart,
      end: exactStart + exactQuery.length
    }
  }

  for (const term of terms) {
    const termStart = index.text.indexOf(term)

    if (termStart !== -1) {
      return {
        start: termStart,
        end: termStart + term.length
      }
    }
  }

  return null
}

const rectsFromTextLayerMatch = (
  index: TextLayerSearchIndex,
  match: { start: number; end: number },
  pageElement: HTMLElement,
  scale: number
): AnnotationRect[] => {
  const startPosition = index.positions[match.start]
  const endPosition = index.positions[Math.max(match.start, match.end - 1)]

  if (!startPosition || !endPosition) {
    return []
  }

  const range = document.createRange()
  range.setStart(startPosition.node, startPosition.offset)
  range.setEnd(endPosition.node, endPosition.offset + 1)

  const pageRect = pageElement.getBoundingClientRect()
  const rects = Array.from(range.getClientRects())
    .map((item) => {
      const left = Math.max(item.left, pageRect.left)
      const top = Math.max(item.top, pageRect.top)
      const right = Math.min(item.right, pageRect.right)
      const bottom = Math.min(item.bottom, pageRect.bottom)
      const width = right - left
      const height = bottom - top

      if (width <= 1 || height <= 1) {
        return null
      }

      return {
        left: roundRectValue((left - pageRect.left) / scale),
        top: roundRectValue((top - pageRect.top) / scale),
        width: roundRectValue(width / scale),
        height: roundRectValue(height / scale)
      }
    })
    .filter((item): item is AnnotationRect => Boolean(item))

  range.detach()
  return normalizeAnnotationRects(rects)
}

const hexToRgba = (value: string | null | undefined, alpha: number): string => {
  const color = value?.trim() || '#f8d86a'
  const normalized = color.startsWith('#') ? color.slice(1) : color
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return `rgba(248, 216, 106, ${alpha})`
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16)
  const green = Number.parseInt(expanded.slice(2, 4), 16)
  const blue = Number.parseInt(expanded.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatTime = (iso: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso))

const makeConversationTitle = (message: string): string => {
  const normalized = message
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return '共读对话'
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized
}

const getAnnotationPreview = (annotation: AnnotationRecord): string =>
  annotation.note?.trim() || annotation.selectedText?.trim() || '书签'

const getStoredReaderName = (): string => {
  const value = window.localStorage.getItem('reading-partner.reader-name')?.trim()
  return value || '本机读者'
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

const toPdfBlobUrl = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const stableCopy = bytes.slice()
  return URL.createObjectURL(new Blob([stableCopy], { type: 'application/pdf' }))
}

type PanState = {
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

const renderInlineMarkdown = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${match.index}-${token}`

    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function MarkdownContent({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('### ')) {
      blocks.push(<h3 key={index}>{renderInlineMarkdown(trimmed.slice(4))}</h3>)
      index += 1
      continue
    }

    if (trimmed.startsWith('## ')) {
      blocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(3))}</h2>)
      index += 1
      continue
    }

    if (trimmed.startsWith('# ')) {
      blocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(2))}</h2>)
      index += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      const items: string[] = []
      const blockIndex = index

      while (index < lines.length && lines[index].trim().startsWith('> ')) {
        items.push(lines[index].trim().slice(2))
        index += 1
      }

      blocks.push(
        <blockquote key={blockIndex}>
          {items.map((item, itemIndex) => (
            <p key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      const blockIndex = index

      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }

      blocks.push(
        <ul key={blockIndex}>
          {items.map((item, itemIndex) => (
            <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      const blockIndex = index

      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }

      blocks.push(
        <ol key={blockIndex}>
          {items.map((item, itemIndex) => (
            <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraph: string[] = [trimmed]
    const blockIndex = index
    index += 1

    while (index < lines.length) {
      const next = lines[index].trim()

      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('> ') ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break
      }

      paragraph.push(next)
      index += 1
    }

    blocks.push(<p key={blockIndex}>{renderInlineMarkdown(paragraph.join(' '))}</p>)
  }

  return <div className="markdown-content">{blocks}</div>
}

function AnnotationOverlay({
  annotations,
  interactionMode,
  scale,
  temporaryHighlight
}: {
  annotations: AnnotationRecord[]
  interactionMode: AnnotationInteractionMode
  scale: number
  temporaryHighlight: TemporarySearchHighlight | null
}): JSX.Element {
  const [hoveredAnnotation, setHoveredAnnotation] = useState<HoveredAnnotation | null>(null)
  const canInspect = interactionMode === 'inspect'
  const visualItems = annotations.map((annotation) => ({
    annotation,
    rects: parseAnnotationRects(annotation.rectsJson)
  }))
  const pageMarkers = visualItems.filter(({ annotation, rects }) => annotation.type === 'bookmark' || rects.length === 0)
  const showTooltip = (annotation: AnnotationRecord, event: ReactMouseEvent): void => {
    if (!canInspect) {
      return
    }

    const layerRect = event.currentTarget
      .closest('.pdf-annotation-layer')
      ?.getBoundingClientRect()

    setHoveredAnnotation({
      annotation,
      x: layerRect ? event.clientX - layerRect.left + 14 : 14,
      y: layerRect ? event.clientY - layerRect.top + 14 : 14
    })
  }
  const hideTooltip = (): void => setHoveredAnnotation(null)

  return (
    <div
      className={canInspect ? 'pdf-annotation-layer is-inspecting' : 'pdf-annotation-layer is-selecting'}
      aria-hidden="true"
    >
      {visualItems.flatMap(({ annotation, rects }) =>
        rects.map((rect, rectIndex) => {
          const verticalInset = annotation.type === 'highlight' ? Math.min(3, rect.height * scale * 0.18) : 0
          const style: CSSProperties = {
            left: rect.left * scale,
            top: rect.top * scale + verticalInset,
            width: rect.width * scale,
            height: Math.max(2, rect.height * scale - verticalInset * 2),
            backgroundColor:
              annotation.type === 'highlight'
                ? hexToRgba(annotation.color, 0.44)
                : hexToRgba(annotation.color ?? '#6aa7f8', 0.24),
            borderColor: annotation.color ?? (annotation.type === 'note' ? '#3f7fc8' : '#d6ad22')
          }

          return (
            <span
              className={`pdf-annotation-rect is-${annotation.type}`}
              key={`${annotation.id}-${rectIndex}`}
              onMouseEnter={(event) => showTooltip(annotation, event)}
              onMouseMove={(event) => showTooltip(annotation, event)}
              onMouseLeave={hideTooltip}
              style={style}
            />
          )
        })
      )}

      {visualItems
        .filter(({ annotation, rects }) => annotation.type === 'note' && rects.length > 0)
        .map(({ annotation, rects }) => {
          const firstRect = rects[0]

          return (
            <span
              className="pdf-annotation-pin is-note"
              key={`${annotation.id}-pin`}
              onMouseEnter={(event) => showTooltip(annotation, event)}
              onMouseMove={(event) => showTooltip(annotation, event)}
              onMouseLeave={hideTooltip}
              style={{
                left: (firstRect.left + firstRect.width) * scale + 6,
                top: firstRect.top * scale
              }}
            />
          )
        })}

      {pageMarkers.map(({ annotation }, index) => (
        <span
          className={`pdf-page-marker is-${annotation.type}`}
          key={`${annotation.id}-marker`}
          onMouseEnter={(event) => showTooltip(annotation, event)}
          onMouseMove={(event) => showTooltip(annotation, event)}
          onMouseLeave={hideTooltip}
          style={{
            top: 12 + index * 30,
            backgroundColor:
              annotation.type === 'bookmark' ? undefined : annotation.color ?? undefined
          }}
        />
      ))}
      {temporaryHighlight?.rects.map((rect, rectIndex) => {
        const verticalInset = Math.min(4, rect.height * scale * 0.16)

        return (
          <span
            className="pdf-annotation-rect is-search-target"
            key={`${temporaryHighlight.id}-${rectIndex}`}
            style={{
              left: rect.left * scale,
              top: rect.top * scale + verticalInset,
              width: rect.width * scale,
              height: Math.max(3, rect.height * scale - verticalInset * 2)
            }}
          />
        )
      })}
      {canInspect && hoveredAnnotation && (
        <div
          className="pdf-annotation-tooltip"
          style={{
            left: hoveredAnnotation.x,
            top: hoveredAnnotation.y
          }}
        >
          <strong>
            {hoveredAnnotation.annotation.type === 'highlight'
              ? '高亮'
              : hoveredAnnotation.annotation.type === 'note'
                ? '批注'
                : '书签'}
          </strong>
          <time>{formatTime(hoveredAnnotation.annotation.createdAt)}</time>
          <span className="annotation-tooltip-author">
            {hoveredAnnotation.annotation.authorName || 'Reader'}
          </span>
          <p>{getAnnotationPreview(hoveredAnnotation.annotation)}</p>
        </div>
      )}
    </div>
  )
}

function App(): JSX.Element {
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const [vocabulary, setVocabulary] = useState<VocabularyRecord[]>([])
  const [dictionarySources, setDictionarySources] = useState<DictionarySourceRecord[]>([])
  const [providers, setProviders] = useState<AIProviderRecord[]>([])
  const [keyStatus, setKeyStatus] = useState<ProviderKeyStatus[]>([])
  const [activeTab, setActiveTab] = useState<PanelTab>('notes')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [activeSearchTarget, setActiveSearchTarget] = useState<ActiveSearchTarget | null>(null)
  const [temporarySearchHighlight, setTemporarySearchHighlight] =
    useState<TemporarySearchHighlight | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.08)
  const [isPanMode, setIsPanMode] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [annotationInteractionMode, setAnnotationInteractionMode] =
    useState<AnnotationInteractionMode>('inspect')
  const [selectedAnnotationColor, setSelectedAnnotationColor] = useState(annotationColorPresets[0].value)
  const [draftNote, setDraftNote] = useState('')
  const [selectionNoteDraft, setSelectionNoteDraft] = useState('')
  const [isSelectionNoteEditorOpen, setIsSelectionNoteEditorOpen] = useState(false)
  const [qaQuestion, setQaQuestion] = useState('')
  const [aiConversations, setAiConversations] = useState<AIConversationRecord[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<AIChatMessageRecord[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatTitleDraft, setChatTitleDraft] = useState('')
  const [readerName, setReaderName] = useState(getStoredReaderName)
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationUndoAction[]>([])
  const [status, setStatus] = useState('打开一本 PDF 开始阅读')
  const [aiRun, setAiRun] = useState<AIRunState | null>(null)
  const aiRunRef = useRef<AIRunState | null>(null)
  const readerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<PanState | null>(null)
  const suppressSelectionRef = useRef(false)

  const currentPageAnnotations = useMemo(
    () => annotations.filter((item) => item.pageNumber === pageNumber),
    [annotations, pageNumber]
  )
  const currentPageSearchHighlight = useMemo(
    () =>
      temporarySearchHighlight?.pageNumber === pageNumber
        ? temporarySearchHighlight
        : null,
    [pageNumber, temporarySearchHighlight]
  )

  const pdfFile = useMemo<Source | null>(() => (pdfUrl ? { url: pdfUrl } : null), [pdfUrl])

  const configuredProviderIds = useMemo(
    () => new Set(keyStatus.filter((item) => item.configured).map((item) => item.providerId)),
    [keyStatus]
  )

  const readyProvider = useMemo(
    () => providers.find((provider) => provider.enabled && configuredProviderIds.has(provider.id)) ?? null,
    [configuredProviderIds, providers]
  )

  const activeConversation = useMemo(
    () => aiConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, aiConversations]
  )

  useEffect(() => {
    void refreshLibrary()
    void refreshProviders()
    void refreshDictionarySources()
  }, [])

  useEffect(() => {
    aiRunRef.current = aiRun
  }, [aiRun])

  useEffect(() => {
    window.localStorage.setItem('reading-partner.reader-name', readerName.trim() || '本机读者')
  }, [readerName])

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent): void => {
      const panState = panStateRef.current
      const surface = readerSurfaceRef.current

      if (!panState || !surface) {
        return
      }

      event.preventDefault()
      const deltaX = event.clientX - panState.startX
      const deltaY = event.clientY - panState.startY

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        suppressSelectionRef.current = true
      }

      surface.scrollLeft = panState.scrollLeft - deltaX
      surface.scrollTop = panState.scrollTop - deltaY
    }

    const handleWindowMouseUp = (event: MouseEvent): void => {
      if (!panStateRef.current) {
        return
      }

      event.preventDefault()
      panStateRef.current = null
      setIsPanning(false)

      window.setTimeout(() => {
        suppressSelectionRef.current = false
      }, 0)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  useEffect(() => {
    return window.readingPartner.onAIStreamEvent((event) => {
      void handleAIStreamEvent(event)
    })
  }, [])

  useEffect(() => {
    if (!activeSearchTarget || activeSearchTarget.result.pageNumber !== pageNumber) {
      return
    }

    let cancelled = false
    let retryTimer: number | null = null

    const locateSearchTarget = (attempt = 0): void => {
      if (cancelled) {
        return
      }

      const pageElement = readerSurfaceRef.current?.querySelector<HTMLElement>('.react-pdf__Page')
      const textLayer = pageElement?.querySelector<HTMLElement>('.react-pdf__Page__textContent')

      if (!pageElement || !textLayer || textLayer.textContent?.trim().length === 0) {
        if (attempt < 14) {
          retryTimer = window.setTimeout(() => locateSearchTarget(attempt + 1), 80)
        }
        return
      }

      const index = buildTextLayerSearchIndex(textLayer)
      const match = findSearchMatch(index, activeSearchTarget.result, activeSearchTarget.query)
      const rects = match ? rectsFromTextLayerMatch(index, match, pageElement, scale) : []

      if (rects.length > 0) {
        setTemporarySearchHighlight({
          id: `search-${activeSearchTarget.result.id}-${activeSearchTarget.nonce}`,
          pageNumber: activeSearchTarget.result.pageNumber,
          text: activeSearchTarget.result.snippet,
          rects
        })
        setStatus(`已定位第 ${activeSearchTarget.result.pageNumber} 页的搜索片段`)
        return
      }

      if (attempt < 14) {
        retryTimer = window.setTimeout(() => locateSearchTarget(attempt + 1), 80)
      } else {
        setTemporarySearchHighlight(null)
        setStatus(`已跳转到第 ${activeSearchTarget.result.pageNumber} 页，但未能自动定位文字坐标`)
      }
    }

    setTemporarySearchHighlight(null)
    retryTimer = window.setTimeout(() => locateSearchTarget(), 0)

    return () => {
      cancelled = true

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [activeSearchTarget, pageNumber, scale])

  const refreshLibrary = async (): Promise<void> => {
    const list = await window.readingPartner.listDocuments()
    setDocuments(list)
  }

  const refreshProviders = async (): Promise<void> => {
    const [providerList, statusList] = await Promise.all([
      window.readingPartner.listAIProviders(),
      window.readingPartner.listAIProviderKeyStatus()
    ])
    setProviders(providerList)
    setKeyStatus(statusList)
  }

  const refreshDictionarySources = async (): Promise<void> => {
    const sources = await window.readingPartner.listDictionarySources()
    setDictionarySources(sources)
  }

  const refreshAnnotations = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listAnnotations(documentId)
    setAnnotations(list)
  }

  const refreshVocabulary = async (documentId: string): Promise<void> => {
    const list = await window.readingPartner.listVocabulary(documentId)
    setVocabulary(list)
  }

  const clearSearch = (): void => {
    setSearchQuery('')
    setSearchResults([])
    setIsSearching(false)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
  }

  const pushAnnotationUndo = (action: AnnotationUndoAction): void => {
    setAnnotationUndoStack((items) => [...items.slice(-39), action])
  }

  const refreshAIConversations = async (documentId: string): Promise<void> => {
    const conversations = await window.readingPartner.listAIConversations(documentId)
    setAiConversations(conversations)

    const nextActive = conversations[0] ?? null
    setActiveConversationId(nextActive?.id ?? null)
    setChatMessages(
      nextActive ? await window.readingPartner.listAIChatMessages(nextActive.id) : []
    )
  }

  const selectAIConversation = async (conversationId: string): Promise<void> => {
    setActiveConversationId(conversationId)
    setChatMessages(await window.readingPartner.listAIChatMessages(conversationId))
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
  }

  const startNewAIConversation = (): void => {
    if (!activeDocument) {
      return
    }

    setActiveConversationId(null)
    setChatMessages([])
    setChatDraft('')
    setChatTitleDraft('')
    setIsChatDrawerOpen(true)
    setActiveTab('ai')
    setStatus('正在创建新对话，发送第一条消息后保存')
  }

  const createAIConversation = async (title?: string): Promise<AIConversationRecord | null> => {
    if (!activeDocument) {
      return null
    }

    const conversation = await window.readingPartner.createAIConversation(
      activeDocument.id,
      '共读对话'
    )
    const titledConversation = title?.trim()
      ? await window.readingPartner.updateAIConversationTitle({ id: conversation.id, title: title.trim() })
      : conversation
    setAiConversations((items) => [titledConversation, ...items])
    setActiveConversationId(titledConversation.id)
    setChatMessages([])
    setIsChatDrawerOpen(true)
    setStatus('已创建共读对话')

    return titledConversation
  }

  const updateAIConversationTitle = async (conversationId: string, title: string): Promise<void> => {
    const trimmed = title.trim()

    if (!trimmed) {
      return
    }

    const updated = await window.readingPartner.updateAIConversationTitle({
      id: conversationId,
      title: trimmed
    })
    setAiConversations((items) => items.map((item) => (item.id === conversationId ? updated : item)))
    setStatus('已更新对话名称')
  }

  const searchDocument = async (query = searchQuery): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = query.trim()

    if (!trimmed) {
      setSearchResults([])
      setActiveSearchTarget(null)
      setTemporarySearchHighlight(null)
      return
    }

    setIsSearching(true)
    setActiveSearchTarget(null)
    setTemporarySearchHighlight(null)
    setStatus(`正在搜索：${trimmed}`)

    try {
      const results = await window.readingPartner.searchDocumentText(activeDocument.id, trimmed)
      setSearchResults(results)
      setStatus(results.length > 0 ? `找到 ${results.length} 条结果` : `没有找到：${trimmed}`)
    } catch (error) {
      setStatus(`搜索失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsSearching(false)
    }
  }

  const ensureDocumentTextIndex = async (
    document: DocumentRecord,
    expectedPageCount: number
  ): Promise<void> => {
    try {
      const current = await window.readingPartner.getDocumentTextIndexStatus(document.id)

      if (
        current.pageCount === expectedPageCount &&
        current.pagesIndexed >= expectedPageCount
      ) {
        setStatus(`共 ${expectedPageCount} 页，文本索引已就绪`)
        return
      }

      setStatus(`共 ${expectedPageCount} 页，正在抽取文本索引...`)
      const result = await window.readingPartner.indexDocumentText(document.id)
      setActiveDocument((active) =>
        active?.id === result.documentId ? { ...active, pageCount: result.pageCount } : active
      )
      await refreshLibrary()
      setStatus(
        result.skipped
          ? `共 ${result.pageCount ?? expectedPageCount} 页，文本索引已就绪`
          : `文本索引完成：${result.pagesIndexed} 页 / ${result.chunksIndexed} 个片段`
      )
    } catch (error) {
      setStatus(`文本索引失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleAIStreamEvent = async (event: AIStreamEvent): Promise<void> => {
    if (event.type === 'start') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, model: event.model, status: 'running', error: null }
          : current
      )
      return
    }

    if (event.type === 'delta') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, output: `${current.output}${event.text}` }
          : current
      )
      return
    }

    if (event.type === 'error') {
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'error', error: event.message }
          : current
      )
      setStatus(`AI 调用失败：${event.message}`)
      return
    }

    const currentRun = aiRunRef.current

    if (currentRun?.source === 'chat' && currentRun.conversationId) {
      const [messages, conversations] = await Promise.all([
        window.readingPartner.listAIChatMessages(currentRun.conversationId),
        window.readingPartner.listAIConversations(event.artifact.documentId)
      ])
      setChatMessages(messages)
      setAiConversations(conversations)
      setAiRun((current) =>
        current && current.requestId === event.requestId
          ? { ...current, status: 'done', output: event.artifact.outputMarkdown }
          : current
      )
      setStatus('共读对话已更新')
      return
    }

    if (currentRun?.source === 'vocabulary' && currentRun.vocabularyId) {
      const updated = await window.readingPartner.updateVocabularyDefinition({
        id: currentRun.vocabularyId,
        definition: event.artifact.outputMarkdown
      })
      setVocabulary((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    } else {
      const note = await window.readingPartner.createAnnotation({
        documentId: event.artifact.documentId,
        type: 'note',
        pageNumber: event.artifact.pageNumber ?? 1,
        selectedText: event.artifact.inputText,
        color: '#c7d2fe',
        note: `AI ${promptLabels[event.artifact.promptType]}\n\n${event.artifact.outputMarkdown}`,
        authorName: 'AI'
      })

      setAnnotations((items) => [...items, note])
    }

    setAiRun((current) =>
      current && current.requestId === event.requestId
        ? { ...current, status: 'done', output: event.artifact.outputMarkdown }
        : current
    )
    setStatus(currentRun?.source === 'vocabulary' ? 'AI 释义已写入词汇本' : 'AI 结果已保存为笔记')
  }

  const loadDocument = async (document: DocumentRecord): Promise<void> => {
    setStatus(`正在打开 ${document.title}`)
    setPdfError(null)
    const data = await window.readingPartner.readPdf(document.id)
    const nextUrl = toPdfBlobUrl(data)
    setActiveDocument(document)
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
    setSelection(null)
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
    setAnnotationUndoStack([])
    clearSearch()
    setQaQuestion('')
    setChatDraft('')
    setChatTitleDraft('')
    setIsChatDrawerOpen(false)
    await Promise.all([
      refreshAnnotations(document.id),
      refreshVocabulary(document.id),
      refreshAIConversations(document.id)
    ])
    setStatus(`已打开 ${document.title}`)
  }

  const openPdf = async (): Promise<void> => {
    const result: OpenPdfResult | null = await window.readingPartner.openPdfDialog()

    if (!result) {
      return
    }

    const nextUrl = toPdfBlobUrl(result.data)
    setPdfError(null)
    setActiveDocument(result.document)
    setPdfUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
      return nextUrl
    })
    setPageNumber(1)
    setSelection(null)
    setAnnotationUndoStack([])
    clearSearch()
    setQaQuestion('')
    setChatDraft('')
    await Promise.all([
      refreshLibrary(),
      refreshAnnotations(result.document.id),
      refreshVocabulary(result.document.id),
      refreshAIConversations(result.document.id)
    ])
    setStatus(`已导入 ${result.document.title}`)
  }

  const captureSelection = (): void => {
    const selected = window.getSelection()
    const text = selected?.toString().trim()

    if (!text || text.length < 2 || !activeDocument) {
      setSelection(null)
      setSelectionNoteDraft('')
      setIsSelectionNoteEditorOpen(false)
      return
    }

    const range = selected?.rangeCount ? selected.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    const pageElement = readerSurfaceRef.current?.querySelector<HTMLElement>('.react-pdf__Page')
    const pageRect = pageElement?.getBoundingClientRect()
    const capturedRects =
      range && pageRect
        ? Array.from(range.getClientRects())
            .map((item) => {
              const left = Math.max(item.left, pageRect.left)
              const top = Math.max(item.top, pageRect.top)
              const right = Math.min(item.right, pageRect.right)
              const bottom = Math.min(item.bottom, pageRect.bottom)
              const width = right - left
              const height = bottom - top

              if (width <= 1 || height <= 1) {
                return null
              }

              return {
                left: roundRectValue((left - pageRect.left) / scale),
                top: roundRectValue((top - pageRect.top) / scale),
                width: roundRectValue(width / scale),
                height: roundRectValue(height / scale)
              }
            })
            .filter((item): item is AnnotationRect => Boolean(item))
        : []
    const rects = normalizeAnnotationRects(capturedRects)

    setSelection({
      text,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? Math.max(96, rect.top - 12) : 120,
      rects
    })
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
  }

  const createAnnotation = async (
    type: AnnotationRecord['type'],
    note?: string,
    color = selectedAnnotationColor
  ): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const created = await window.readingPartner.createAnnotation({
      documentId: activeDocument.id,
      type,
      pageNumber,
      selectedText: selection?.text ?? null,
      color: type === 'bookmark' ? null : color,
      note: note ?? null,
      rectsJson: type !== 'bookmark' && selection?.rects.length ? JSON.stringify(selection.rects) : null,
      authorName: readerName.trim() || 'Reader'
    })

    setAnnotations((items) => [...items, created])
    pushAnnotationUndo({ kind: 'create', annotation: created })
    setSelection(null)
    setSelectionNoteDraft('')
    setIsSelectionNoteEditorOpen(false)
    setDraftNote('')
    setStatus(type === 'bookmark' ? '已添加书签' : '已保存批注')
  }

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
        void undoLastAnnotationAction()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) {
        return
      }

      if (key === 'd') {
        event.preventDefault()
        setIsPanMode((value) => !value)
        return
      }

      if (!activeDocument || !selection) {
        return
      }

      if (key === 'h') {
        event.preventDefault()
        void createAnnotation('highlight')
      }

      if (key === 'n') {
        event.preventDefault()
        setIsSelectionNoteEditorOpen(true)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [activeDocument, annotationUndoStack, selection, selectedAnnotationColor, readerName])

  const runAIAction = async (promptType: AIPromptType, text = selection?.text): Promise<void> => {
    if (!activeDocument || !text) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    setAiRun({
      requestId,
      promptType,
      inputText: text,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      status: 'running',
      error: null,
      source: 'selection'
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} ${promptLabels[promptType]}选区`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      promptType,
      selectedText: text
    })
  }

  const askDocumentQuestion = async (question: string): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = question.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    setAiRun({
      requestId,
      promptType: 'ask_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      status: 'running',
      error: null,
      source: 'document_qa'
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 回答文档问题`)

    await window.readingPartner.askDocumentQuestion({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber,
      question: trimmed
    })
  }

  const sendChatMessage = async (message: string): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const trimmed = message.trim()

    if (!trimmed) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const conversation =
      activeConversation ??
      (await createAIConversation(chatTitleDraft.trim() || makeConversationTitle(trimmed)))

    if (!conversation) {
      return
    }

    const selectedText = selection?.text ?? null
    const requestId = crypto.randomUUID()
    const optimisticMessage: AIChatMessageRecord = {
      id: `pending:${requestId}`,
      conversationId: conversation.id,
      role: 'user',
      content: trimmed,
      selectedText,
      pageNumber,
      providerId: null,
      model: null,
      artifactId: null,
      createdAt: new Date().toISOString()
    }

    setChatMessages((items) => [...items, optimisticMessage])
    setIsChatDrawerOpen(true)
    setChatDraft('')
    setChatTitleDraft('')
    setAiRun({
      requestId,
      promptType: 'chat_document',
      inputText: trimmed,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      status: 'running',
      error: null,
      source: 'chat',
      conversationId: conversation.id
    })
    setActiveTab('ai')
    setSelection(null)
    setStatus(`正在使用 ${readyProvider.label} 继续共读对话`)

    await window.readingPartner.runAIChat({
      requestId,
      providerId: readyProvider.id,
      conversationId: conversation.id,
      documentId: activeDocument.id,
      pageNumber,
      message: trimmed,
      selectedText
    })
  }

  const deleteAnnotation = async (id: string): Promise<void> => {
    const deleted = annotations.find((item) => item.id === id)
    await window.readingPartner.deleteAnnotation(id)
    setAnnotations((items) => items.filter((item) => item.id !== id))
    if (deleted) {
      pushAnnotationUndo({ kind: 'delete', annotation: deleted })
    }
  }

  const updateAnnotation = async (id: string, note: string, color?: string | null): Promise<void> => {
    const before = annotations.find((item) => item.id === id)
    const updated = await window.readingPartner.updateAnnotation({
      id,
      note: note.trim() || null,
      color
    })
    setAnnotations((items) => items.map((item) => (item.id === id ? updated : item)))
    if (before) {
      pushAnnotationUndo({ kind: 'update', before, after: updated })
    }
    setStatus('已更新批注')
  }

  const undoLastAnnotationAction = async (): Promise<void> => {
    const action = annotationUndoStack.at(-1)

    if (!action) {
      setStatus('没有可撤销的批注操作')
      return
    }

    setAnnotationUndoStack((items) => items.slice(0, -1))

    if (action.kind === 'create') {
      await window.readingPartner.deleteAnnotation(action.annotation.id)
      setAnnotations((items) => items.filter((item) => item.id !== action.annotation.id))
      setStatus('已撤销新增批注')
      return
    }

    if (action.kind === 'delete') {
      const restored = await window.readingPartner.restoreAnnotation(action.annotation)
      setAnnotations((items) =>
        [...items.filter((item) => item.id !== restored.id), restored].sort(
          (first, second) =>
            first.pageNumber - second.pageNumber || first.createdAt.localeCompare(second.createdAt)
        )
      )
      setStatus('已撤销删除批注')
      return
    }

    const restored = await window.readingPartner.restoreAnnotation(action.before)
    setAnnotations((items) => items.map((item) => (item.id === restored.id ? restored : item)))
    setStatus('已撤销批注编辑')
  }

  const exportReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.exportReadingMarksDialog(activeDocument.id)

    if (result) {
      setStatus(`已导出 ${result.annotationCount} 条阅读记录`)
    }
  }

  const importReadingMarks = async (): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const result = await window.readingPartner.importReadingMarksDialog(activeDocument.id)

    if (result) {
      await refreshAnnotations(activeDocument.id)
      setAnnotationUndoStack([])
      setStatus(`已导入 ${result.annotationCount} 条阅读记录`)
    }
  }

  const createVocabularyFromSelection = async (): Promise<void> => {
    if (!activeDocument || !selection?.text) {
      return
    }

    try {
      const word = selection.text.replace(/\s+/g, ' ').trim()
      const lookup = await window.readingPartner.lookupDictionary(word)
      const definition = lookup.entry ? makeDefinitionFromDictionary(lookup.entry) : '待补充释义'
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word,
        definition,
        sourceSentence: selection.text,
        pageNumber
      })

      setVocabulary((items) => [created, ...items])
      setSelection(null)
      setActiveTab('vocab')
      setStatus(lookup.entry ? '已用本地词典释义加入词汇本' : '已加入词汇本，未命中本地词典')
    } catch (error) {
      setStatus(`加入词汇本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const addDictionaryEntryToVocabulary = async (entry: DictionaryEntryRecord): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const exists = vocabulary.some(
      (item) => item.word.trim().toLocaleLowerCase() === entry.word.trim().toLocaleLowerCase()
    )

    if (exists) {
      setStatus(`“${entry.word}” 已在当前 PDF 生词本中`)
      return
    }

    try {
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word: entry.word,
        definition: makeDefinitionFromDictionary(entry),
        pageNumber: null
      })

      setVocabulary((items) => [created, ...items])
      setStatus(`已将“${entry.word}”加入当前 PDF 生词本`)
    } catch (error) {
      setStatus(`加入生词本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const importDictionary = async (): Promise<void> => {
    try {
      const result = await window.readingPartner.importDictionaryCsvDialog()

      if (!result) {
        return
      }

      setStatus(`词典导入完成：${result.imported} 条，跳过 ${result.skipped} 条`)
      await refreshDictionarySources()
    } catch (error) {
      setStatus(`词典导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const deleteVocabulary = async (id: string): Promise<void> => {
    try {
      await window.readingPartner.deleteVocabulary(id)
      setVocabulary((items) => items.filter((item) => item.id !== id))
      setStatus('已删除词汇')
    } catch (error) {
      setStatus(`删除词汇失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const defineVocabularyWithAI = async (item: VocabularyRecord): Promise<void> => {
    if (!activeDocument) {
      return
    }

    if (!readyProvider) {
      setActiveTab('settings')
      setStatus('请先在配置面板为至少一个启用的 Provider 保存 API Key')
      return
    }

    const requestId = crypto.randomUUID()
    const inputText = [
      `Term: ${item.word}`,
      item.sourceSentence ? `Source sentence: ${item.sourceSentence}` : null,
      item.definition ? `Current definition: ${item.definition}` : null
    ]
      .filter(Boolean)
      .join('\n')

    setAiRun({
      requestId,
      promptType: 'define_vocabulary',
      inputText,
      providerLabel: readyProvider.label,
      model: readyProvider.defaultModel,
      output: '',
      status: 'running',
      error: null,
      source: 'vocabulary',
      vocabularyId: item.id
    })
    setActiveTab('ai')
    setStatus(`正在使用 ${readyProvider.label} 生成词汇释义`)

    await window.readingPartner.runAIAction({
      requestId,
      providerId: readyProvider.id,
      documentId: activeDocument.id,
      pageNumber: item.pageNumber ?? pageNumber,
      promptType: 'define_vocabulary',
      selectedText: inputText
    })
  }

  const zoomBy = (delta: number): void => {
    setScale((value) => clampScale(value + delta))
  }

  const handleReaderWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey || !activeDocument) {
      return
    }

    event.preventDefault()
    zoomBy(event.deltaY < 0 ? scaleStep : -scaleStep)
  }

  const stopReaderPan = (): void => {
    panStateRef.current = null
    setIsPanning(false)
  }

  const handleReaderMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!activeDocument) {
      return
    }

    const shouldPan = event.button === 1 || (isPanMode && event.button === 0)

    if (!shouldPan) {
      return
    }

    event.preventDefault()
    panStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop
    }
    suppressSelectionRef.current = true
    setSelection(null)
    setIsPanning(true)
  }

  const updateProvider = async (provider: AIProviderRecord, enabled: boolean): Promise<void> => {
    const updated = await window.readingPartner.upsertAIProvider({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKeyRef: provider.apiKeyRef,
      supportsThinking: provider.supportsThinking,
      supportsLongContext: provider.supportsLongContext,
      enabled
    })

    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
  }

  const saveProviderKey = async (providerId: string, apiKey: string): Promise<void> => {
    const updated = await window.readingPartner.setAIProviderApiKey(providerId, apiKey)
    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    await refreshProviders()
    setStatus('API Key 已加密保存')
  }

  const clearProviderKey = async (providerId: string): Promise<void> => {
    const updated = await window.readingPartner.clearAIProviderApiKey(providerId)
    setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    await refreshProviders()
    setStatus('API Key 已清除')
  }

  const toggleWindowMaximize = async (): Promise<void> => {
    const maximized = await window.readingPartner.toggleMaximizeWindow()
    setIsWindowMaximized(maximized)
  }

  return (
    <div className="app-shell">
      <header className="window-titlebar">
        <div className="window-titlebar-brand">
          <span className="window-title-dot" />
          <strong>Reading Partner</strong>
        </div>
        <div className="window-controls">
          <button title="最小化" onClick={() => void window.readingPartner.minimizeWindow()}>
            <Minus size={14} />
          </button>
          <button title={isWindowMaximized ? '还原' : '最大化'} onClick={() => void toggleWindowMaximize()}>
            <Maximize2 size={14} />
          </button>
          <button className="close" title="关闭" onClick={() => void window.readingPartner.closeWindow()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="app-layout">
      <aside className="library-panel">
        <div className="brand">
          <div className="brand-mark">RP</div>
          <div>
            <h1>Reading Partner</h1>
            <p>AI assisted PDF workspace</p>
          </div>
        </div>

        <button className="primary-action" onClick={() => void openPdf()}>
          <Upload size={18} />
          打开 PDF
        </button>

        <section className="panel-section">
          <div className="section-heading">
            <FileText size={16} />
            文档库
          </div>
          <div className="document-list">
            {documents.length === 0 ? (
              <p className="muted">还没有导入文档。</p>
            ) : (
              documents.map((document) => (
                <button
                  className={document.id === activeDocument?.id ? 'document-item active' : 'document-item'}
                  key={document.id}
                  onClick={() => void loadDocument(document)}
                >
                  <span>{document.title}</span>
                  <small>
                    {formatBytes(document.fileSize)} · {formatTime(document.lastOpenedAt)}
                  </small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel-section">
          <div className="section-heading">
            <Bookmark size={16} />
            当前页
          </div>
          <div className="page-summary">
            <strong>{activeDocument ? `第 ${pageNumber} 页` : '未打开文档'}</strong>
            <span>{currentPageAnnotations.length} 条批注</span>
          </div>
        </section>
      </aside>

      <main className="reader-column">
        <header className="reader-toolbar">
          <div>
            <strong>{activeDocument?.title ?? '未选择 PDF'}</strong>
            <span>{status}</span>
          </div>
          <div className="toolbar-controls">
            <div className="annotation-mode-toggle" aria-label="批注交互模式">
              <button
                className={annotationInteractionMode === 'inspect' ? 'active' : ''}
                disabled={!activeDocument}
                title="查看批注"
                onClick={() => setAnnotationInteractionMode('inspect')}
              >
                <Eye size={15} />
                查看
              </button>
              <button
                className={annotationInteractionMode === 'select' ? 'active' : ''}
                disabled={!activeDocument}
                title="文本选择"
                onClick={() => setAnnotationInteractionMode('select')}
              >
                <MousePointer2 size={15} />
                选择
              </button>
            </div>
            <div className="reader-color-palette" aria-label="批注颜色">
              {annotationColorPresets.map((preset) => (
                <button
                  className={selectedAnnotationColor === preset.value ? 'color-swatch active' : 'color-swatch'}
                  disabled={!activeDocument}
                  key={preset.value}
                  onClick={() => setSelectedAnnotationColor(preset.value)}
                  style={{ backgroundColor: preset.value }}
                  title={`批注颜色：${preset.label}`}
                />
              ))}
            </div>
            <button
              className="icon-button"
              disabled={!activeDocument || pageNumber <= 1}
              title="上一页"
              onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft size={18} />
            </button>
            <label className="page-input">
              <input
                disabled={!activeDocument}
                max={pageCount || 1}
                min={1}
                type="number"
                value={pageNumber}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) {
                    setPageNumber(Math.min(Math.max(1, next), pageCount || 1))
                  }
                }}
              />
              <span>/ {pageCount || '-'}</span>
            </label>
            <button
              className="icon-button"
              disabled={!activeDocument || pageNumber >= pageCount}
              title="下一页"
              onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}
            >
              <ChevronRight size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!activeDocument}
              title="缩小"
              onClick={() => zoomBy(-scaleStep)}
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-button"
              disabled={!activeDocument}
              title="放大"
              onClick={() => zoomBy(scaleStep)}
            >
              <Plus size={18} />
            </button>
            <button
              className={isPanMode ? 'icon-button active' : 'icon-button'}
              disabled={!activeDocument}
              title="手型拖动 (D)"
              onClick={() => setIsPanMode((value) => !value)}
            >
              <Hand size={18} />
            </button>
          </div>
        </header>

        <div
          className={[
            'reader-surface',
            isPanMode ? 'pan-enabled' : '',
            isPanning ? 'is-panning' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          ref={readerSurfaceRef}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault()
            }
          }}
          onMouseUp={() => {
            if (suppressSelectionRef.current) {
              return
            }

            captureSelection()
          }}
          onMouseDown={handleReaderMouseDown}
          onMouseLeave={() => {
            if (!isPanning) {
              stopReaderPan()
            }
          }}
          onWheel={handleReaderWheel}
        >
          {pdfFile ? (
            <div className="pdf-stage">
              <Document
                file={pdfFile}
                error={
                  <div className="empty-state error-state">
                    <FileText size={44} />
                    <h2>PDF 打开失败</h2>
                    <p>{pdfError ?? 'PDF.js 无法加载这个文件。'}</p>
                  </div>
                }
                loading={<div className="empty-state">正在解析 PDF...</div>}
                onLoadError={(error) => {
                  setPdfError(error.message)
                  setStatus(`PDF 打开失败：${error.message}`)
                }}
                onLoadSuccess={({ numPages }) => {
                  setPdfError(null)
                  setPageCount(numPages)
                  setStatus(`共 ${numPages} 页`)
                  if (activeDocument) {
                    void ensureDocumentTextIndex(activeDocument, numPages)
                  }
                }}
                onSourceError={(error) => {
                  setPdfError(error.message)
                  setStatus(`PDF 来源读取失败：${error.message}`)
                }}
              >
                <div className="pdf-page-frame">
                  <Page
                    pageNumber={pageNumber}
                    renderAnnotationLayer
                    renderTextLayer
                    scale={scale}
                    onLoadError={(error) => {
                      setPdfError(error.message)
                      setStatus(`PDF 页面渲染失败：${error.message}`)
                    }}
                  />
                  <AnnotationOverlay
                    annotations={currentPageAnnotations}
                    interactionMode={annotationInteractionMode}
                    scale={scale}
                    temporaryHighlight={currentPageSearchHighlight}
                  />
                </div>
              </Document>
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={44} />
              <h2>打开一本 PDF</h2>
              <p>导入文献后，可以在这里阅读、划词、高亮、批注，并把 AI 解释保存回笔记。</p>
              <button className="primary-action compact" onClick={() => void openPdf()}>
                <Upload size={18} />
                选择 PDF
              </button>
            </div>
          )}
        </div>

        {selection && (
          <div
            className={isSelectionNoteEditorOpen ? 'selection-toolbar has-note-editor' : 'selection-toolbar'}
            style={{
              left: selection.x,
              top: selection.y
            }}
          >
            <button title="高亮 (H)" onClick={() => void createAnnotation('highlight')}>
              <Highlighter size={16} />
              高亮
            </button>
            <button title="批注 (N)" onClick={() => setIsSelectionNoteEditorOpen((value) => !value)}>
              <StickyNote size={16} />
              批注
            </button>
            <button title="翻译" onClick={() => void runAIAction('translate_selection')}>
              <Languages size={16} />
              翻译
            </button>
            <button title="解释" onClick={() => void runAIAction('explain_selection')}>
              <Sparkles size={16} />
              解释
            </button>
            <button title="加入词汇本" onClick={() => void createVocabularyFromSelection()}>
              <BookMarked size={16} />
              生词
            </button>
            {isSelectionNoteEditorOpen && (
              <div className="selection-note-editor">
                <textarea
                  autoFocus
                  placeholder="写下这段原文的批注..."
                  value={selectionNoteDraft}
                  onChange={(event) => setSelectionNoteDraft(event.target.value)}
                />
                <div className="selection-note-actions">
                  <button
                    title="保存批注"
                    onClick={() =>
                      void createAnnotation('note', selectionNoteDraft.trim() || '待补充笔记')
                    }
                  >
                    <Check size={15} />
                    保存
                  </button>
                  <button
                    title="取消"
                    onClick={() => {
                      setSelectionNoteDraft('')
                      setIsSelectionNoteEditorOpen(false)
                    }}
                  >
                    <X size={15} />
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <aside className="inspector-panel">
        <nav className="tab-bar">
          <button className={activeTab === 'notes' ? 'active' : ''} onClick={() => setActiveTab('notes')}>
            <StickyNote size={16} />
            笔记
          </button>
          <button className={activeTab === 'search' ? 'active' : ''} onClick={() => setActiveTab('search')}>
            <Search size={16} />
            搜索
          </button>
          <button className={activeTab === 'ai' ? 'active' : ''} onClick={() => setActiveTab('ai')}>
            <Bot size={16} />
            AI
          </button>
          <button className={activeTab === 'vocab' ? 'active' : ''} onClick={() => setActiveTab('vocab')}>
            <BookMarked size={16} />
            词汇
          </button>
          <button
            className={activeTab === 'settings' ? 'active' : ''}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} />
            配置
          </button>
        </nav>

        {activeTab === 'notes' && (
          <NotesPanel
            annotations={annotations}
            colorPresets={annotationColorPresets}
            draftNote={draftNote}
            hasDocument={Boolean(activeDocument)}
            readerName={readerName}
            canUndo={annotationUndoStack.length > 0}
            onBookmark={() => void createAnnotation('bookmark')}
            onDelete={(id) => void deleteAnnotation(id)}
            onDraftNoteChange={setDraftNote}
            onExportReadingMarks={() => void exportReadingMarks()}
            onImportReadingMarks={() => void importReadingMarks()}
            onJump={(annotation) => {
              setPageNumber(annotation.pageNumber)
              setStatus(`已跳转到第 ${annotation.pageNumber} 页`)
            }}
            onSaveNote={() => void createAnnotation('note', draftNote || '空白页边注')}
            onUndo={() => void undoLastAnnotationAction()}
            onUpdateAnnotation={(id, note, color) => void updateAnnotation(id, note, color)}
          />
        )}

        {activeTab === 'search' && (
          <SearchPanel
            hasDocument={Boolean(activeDocument)}
            isSearching={isSearching}
            query={searchQuery}
            results={searchResults}
            onJump={(result) => {
              setTemporarySearchHighlight(null)
              setActiveSearchTarget({
                nonce: Date.now(),
                query: searchQuery,
                result
              })
              setPageNumber(result.pageNumber)
              setStatus(`已跳转到第 ${result.pageNumber} 页，正在定位搜索片段`)
            }}
            onQueryChange={(value) => {
              setSearchQuery(value)
              setActiveSearchTarget(null)
              setTemporarySearchHighlight(null)
            }}
            onSearch={() => void searchDocument()}
            onClear={clearSearch}
          />
        )}

        {activeTab === 'ai' && (
          <AiPanel
            aiRun={aiRun}
            chatDraft={chatDraft}
            chatTitleDraft={chatTitleDraft}
            chatMessages={chatMessages}
            conversations={aiConversations}
            hasDocument={Boolean(activeDocument)}
            isConversationOpen={isChatDrawerOpen}
            question={qaQuestion}
            readyProvider={readyProvider}
            selection={selection?.text ?? null}
            activeConversationId={activeConversationId}
            onAskDocument={(question) => void askDocumentQuestion(question)}
            onChatDraftChange={setChatDraft}
            onChatTitleDraftChange={setChatTitleDraft}
            onCloseConversation={() => setIsChatDrawerOpen(false)}
            onCreateConversation={startNewAIConversation}
            onSendChat={(message) => void sendChatMessage(message)}
            onSelectConversation={(conversationId) => void selectAIConversation(conversationId)}
            onQuestionChange={setQaQuestion}
            onRun={(promptType) => void runAIAction(promptType)}
            onUpdateConversationTitle={(conversationId, title) =>
              void updateAIConversationTitle(conversationId, title)
            }
          />
        )}

        {activeTab === 'vocab' && (
          <VocabularyPanel
            hasDocument={Boolean(activeDocument)}
            dictionarySources={dictionarySources}
            vocabulary={vocabulary}
            onAddDictionaryEntry={(entry) => void addDictionaryEntryToVocabulary(entry)}
            onDefine={(item) => void defineVocabularyWithAI(item)}
            onDelete={(id) => void deleteVocabulary(id)}
            onImportDictionary={() => void importDictionary()}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel
            configuredProviderIds={configuredProviderIds}
            providers={providers}
            readerName={readerName}
            onClearKey={(providerId) => void clearProviderKey(providerId)}
            onReaderNameChange={setReaderName}
            onSaveKey={(providerId, apiKey) => void saveProviderKey(providerId, apiKey)}
            onToggle={(provider, enabled) => void updateProvider(provider, enabled)}
          />
        )}
      </aside>
      </div>
    </div>
  )
}

type NotesPanelProps = {
  annotations: AnnotationRecord[]
  colorPresets: AnnotationColorPreset[]
  draftNote: string
  hasDocument: boolean
  readerName: string
  canUndo: boolean
  onBookmark: () => void
  onDelete: (id: string) => void
  onDraftNoteChange: (value: string) => void
  onExportReadingMarks: () => void
  onImportReadingMarks: () => void
  onJump: (annotation: AnnotationRecord) => void
  onSaveNote: () => void
  onUndo: () => void
  onUpdateAnnotation: (id: string, note: string, color: string | null) => void
}

type SearchPanelProps = {
  hasDocument: boolean
  isSearching: boolean
  query: string
  results: DocumentSearchResult[]
  onJump: (result: DocumentSearchResult) => void
  onClear: () => void
  onQueryChange: (value: string) => void
  onSearch: () => void
}

function SearchPanel({
  hasDocument,
  isSearching,
  query,
  results,
  onJump,
  onClear,
  onQueryChange,
  onSearch
}: SearchPanelProps): JSX.Element {
  const canSearch = hasDocument && query.trim().length > 0 && !isSearching
  const canClear = query.trim().length > 0 || results.length > 0

  return (
    <div className="inspector-content search-panel">
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <input
          disabled={!hasDocument}
          placeholder="搜索当前文档"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button disabled={!canSearch} type="submit">
          <Search size={16} />
          {isSearching ? '搜索中' : '搜索'}
        </button>
        <button disabled={!canClear} type="button" onClick={onClear}>
          <X size={16} />
          结束
        </button>
      </form>

      <div className="search-result-list">
        {!hasDocument ? (
          <p className="muted">打开 PDF 后可以搜索当前文档。</p>
        ) : results.length === 0 ? (
          <p className="muted">输入关键词后会显示匹配页码和文本片段。</p>
        ) : (
          results.map((result) => (
            <button className="search-result" key={result.id} onClick={() => onJump(result)}>
              <span className="search-result-heading">
                <strong>第 {result.pageNumber} 页</strong>
                <small>匹配度 {result.score}</small>
              </span>
              <span className="search-snippet">{result.snippet}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function NotesPanel({
  annotations,
  colorPresets,
  draftNote,
  hasDocument,
  readerName,
  canUndo,
  onBookmark,
  onDelete,
  onDraftNoteChange,
  onExportReadingMarks,
  onImportReadingMarks,
  onJump,
  onSaveNote,
  onUndo,
  onUpdateAnnotation
}: NotesPanelProps): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')
  const [editingColor, setEditingColor] = useState(colorPresets[0]?.value ?? '#f8d86a')

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
    onUpdateAnnotation(
      annotation.id,
      editingNote,
      annotation.type === 'bookmark' ? annotation.color : editingColor
    )
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
          value={draftNote}
          onChange={(event) => onDraftNoteChange(event.target.value)}
        />
        <div className="note-actions">
          <button disabled={!hasDocument} onClick={onSaveNote}>
            <MessageSquarePlus size={16} />
            保存笔记
          </button>
          <button disabled={!hasDocument} onClick={onBookmark}>
            <Bookmark size={16} />
            书签
          </button>
        </div>
        <div className="note-actions">
          <button disabled={!canUndo} onClick={onUndo} title="撤销上一次批注操作 (Ctrl+Z)">
            <Undo2 size={16} />
            撤销
          </button>
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

      <div className="annotation-list">
        {annotations.length === 0 ? (
          <p className="muted">高亮、批注和书签会出现在这里。</p>
        ) : (
          annotations.map((annotation) => {
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
                      {annotation.type}
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
                        {annotation.type !== 'bookmark' && (
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
                        )}
                      </>
                    ) : annotation.note ? (
                      <p>{annotation.note}</p>
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

type AiPanelProps = {
  activeConversationId: string | null
  aiRun: AIRunState | null
  chatDraft: string
  chatTitleDraft: string
  chatMessages: AIChatMessageRecord[]
  conversations: AIConversationRecord[]
  hasDocument: boolean
  isConversationOpen: boolean
  question: string
  readyProvider: AIProviderRecord | null
  selection: string | null
  onAskDocument: (question: string) => void
  onChatDraftChange: (value: string) => void
  onChatTitleDraftChange: (value: string) => void
  onCloseConversation: () => void
  onCreateConversation: () => void
  onQuestionChange: (value: string) => void
  onRun: (promptType: AIPromptType) => void
  onSelectConversation: (conversationId: string) => void
  onSendChat: (message: string) => void
  onUpdateConversationTitle: (conversationId: string, title: string) => void
}

function AiPanel({
  activeConversationId,
  aiRun,
  chatDraft,
  chatTitleDraft,
  chatMessages,
  conversations,
  hasDocument,
  isConversationOpen,
  question,
  readyProvider,
  selection,
  onAskDocument,
  onChatDraftChange,
  onChatTitleDraftChange,
  onCloseConversation,
  onCreateConversation,
  onQuestionChange,
  onRun,
  onSelectConversation,
  onSendChat,
  onUpdateConversationTitle
}: AiPanelProps): JSX.Element {
  const canAskDocument =
    hasDocument && Boolean(readyProvider) && question.trim().length > 0 && aiRun?.status !== 'running'
  const canSendChat =
    hasDocument && Boolean(readyProvider) && chatDraft.trim().length > 0 && aiRun?.status !== 'running'
  const activeChatRunning = aiRun?.source === 'chat' && aiRun.status === 'running'
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
  const isCreatingConversation = isConversationOpen && activeConversationId === null
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleEditDraft, setTitleEditDraft] = useState(activeConversation?.title ?? '')

  useEffect(() => {
    setTitleEditDraft(activeConversation?.title ?? '')
    setIsEditingTitle(false)
  }, [activeConversation?.id, activeConversation?.title])

  if (isConversationOpen && (activeConversation || isCreatingConversation)) {
    return (
      <div className="inspector-content chat-drawer">
        <header className="chat-drawer-header">
          <button className="text-button neutral" onClick={onCloseConversation}>
            <ChevronLeft size={15} />
            返回
          </button>
          <div className="chat-title-block">
            {isCreatingConversation ? (
              <input
                className="chat-title-input"
                placeholder="对话名称（可选，留空自动生成）"
                value={chatTitleDraft}
                onChange={(event) => onChatTitleDraftChange(event.target.value)}
              />
            ) : isEditingTitle ? (
              <div className="chat-title-editor">
                <input
                  autoFocus
                  value={titleEditDraft}
                  onChange={(event) => setTitleEditDraft(event.target.value)}
                />
                <button
                  className="text-button neutral"
                  onClick={() => {
                    if (activeConversation) {
                      onUpdateConversationTitle(activeConversation.id, titleEditDraft)
                    }
                    setIsEditingTitle(false)
                  }}
                >
                  <Check size={14} />
                  保存
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setTitleEditDraft(activeConversation?.title ?? '')
                    setIsEditingTitle(false)
                  }}
                >
                  <X size={14} />
                  取消
                </button>
              </div>
            ) : (
              <div className="chat-title-row">
                <strong>{activeConversation?.title ?? '新对话'}</strong>
                <button className="text-button neutral" onClick={() => setIsEditingTitle(true)}>
                  <Pencil size={14} />
                  改名
                </button>
              </div>
            )}
            <span>
              {readyProvider ? `${readyProvider.label} / ${readyProvider.defaultModel}` : '未配置 AI'}
              {isCreatingConversation ? ' / 发送后保存' : ''}
            </span>
          </div>
        </header>

        <div className="chat-message-list">
          {chatMessages.length === 0 ? (
            <p className="muted">开始一段可以连续追问的共读对话。选中文本后发送，会把选区一起作为本轮上下文。</p>
          ) : (
            chatMessages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <strong>{message.role === 'user' ? '你' : 'Reading Partner'}</strong>
                {message.selectedText && <blockquote>{message.selectedText}</blockquote>}
                <MarkdownContent text={message.content} />
              </article>
            ))
          )}
          {activeChatRunning && (
            <article className="chat-message assistant">
              <strong>Reading Partner</strong>
              <MarkdownContent text={aiRun.output || '正在思考...'} />
            </article>
          )}
        </div>

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault()
            onSendChat(chatDraft)
          }}
        >
          <textarea
            disabled={!hasDocument}
            placeholder={selection ? '结合当前选区继续追问...' : '继续和文档对话...'}
            value={chatDraft}
            onChange={(event) => onChatDraftChange(event.target.value)}
          />
          <button disabled={!canSendChat} type="submit">
            <Send size={16} />
            发送
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="inspector-content">
      <div className="ai-ready">
        <Bot size={26} />
        <div>
          <h2>AI 阅读助手</h2>
          <p>
            {readyProvider
              ? `${readyProvider.label} / ${readyProvider.defaultModel}`
              : '请先配置 API Key。'}
          </p>
        </div>
      </div>

      <section className="conversation-menu">
        <div className="conversation-menu-heading">
          <strong>共读对话</strong>
          <button disabled={!hasDocument} onClick={onCreateConversation}>
            新对话
          </button>
        </div>
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <p className="muted">还没有对话，可以新建一段共读对话。</p>
          ) : (
            conversations.map((conversation) => (
              <button
                className="conversation-item"
                key={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{formatTime(conversation.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <form
        className="document-qa"
        onSubmit={(event) => {
          event.preventDefault()
          onAskDocument(question)
        }}
      >
        <textarea
          disabled={!hasDocument}
          placeholder="一次性文档问答..."
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
        <button disabled={!canAskDocument} type="submit">
          <Send size={16} />
          提问
        </button>
      </form>

      <div className="selected-preview">
        <strong>当前选区</strong>
        <p>{selection ?? '未选择文本'}</p>
      </div>

      <div className="prompt-grid">
        <button disabled={!selection || !readyProvider} onClick={() => onRun('translate_selection')}>
          翻译选区
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('explain_selection')}>
          解释概念
        </button>
        <button disabled={!selection || !readyProvider} onClick={() => onRun('summarize_selection')}>
          总结段落
        </button>
        <span className="prompt-status">{aiRun?.output ? '已自动保存' : '输出会自动保存'}</span>
      </div>

      {aiRun && aiRun.source !== 'chat' && (
        <div className="ai-output">
          <div className="ai-output-heading">
            <strong>{promptLabels[aiRun.promptType]}</strong>
            <span>{aiRun.status === 'running' ? '生成中' : aiRun.status}</span>
          </div>
          {aiRun.error ? (
            <p className="error-text">{aiRun.error}</p>
          ) : (
            <MarkdownContent text={aiRun.output || '等待模型返回...'} />
          )}
        </div>
      )}
    </div>
  )
}

type VocabularyPanelProps = {
  dictionarySources: DictionarySourceRecord[]
  hasDocument: boolean
  vocabulary: VocabularyRecord[]
  onAddDictionaryEntry: (entry: DictionaryEntryRecord) => void
  onDefine: (item: VocabularyRecord) => void
  onDelete: (id: string) => void
  onImportDictionary: () => void
}

type VocabularyDefinitionPart = {
  label: string
  text: string
}

type VocabularyDefinitionView = {
  label: string
  phonetic: string | null
  parts: VocabularyDefinitionPart[]
  tags: string[]
}

const partOfSpeechPattern =
  /(?:^|\s)(a\.|adj\.|n\.|v\.|vt\.|vi\.|adv\.|ad\.|prep\.|conj\.|pron\.|num\.|int\.)\s+/gi

const parseVocabularyDefinition = (definition: string): VocabularyDefinitionView => {
  const normalized = definition.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  const labelMatch = normalized.match(/^([^：:]{1,12})[：:]\s*/)
  const label = labelMatch?.[1] ?? '释义'
  let content = labelMatch ? normalized.slice(labelMatch[0].length).trim() : normalized
  const phoneticMatch = content.match(/^\*?\s*(\[[^\]]+\])/)
  const phonetic = phoneticMatch?.[1] ?? null

  if (phoneticMatch) {
    content = content.slice(phoneticMatch[0].length).trim()
  }

  content = content.replace(/^-?\d+\s*/, '').trim()
  const tags = Array.from(content.matchAll(/\[[^\]]+\]|\([^)]*\)$/g)).map((item) => item[0])
  const withoutTags = content.replace(/\[[^\]]+\]|\([^)]*\)$/g, ' ').replace(/\s+/g, ' ').trim()
  const matches = Array.from(withoutTags.matchAll(partOfSpeechPattern))
  const parts: VocabularyDefinitionPart[] = []

  if (matches.length > 0) {
    matches.forEach((match, index) => {
      const next = matches[index + 1]
      const start = (match.index ?? 0) + match[0].length
      const end = next?.index ?? withoutTags.length
      const text = withoutTags.slice(start, end).trim()

      if (text) {
        parts.push({ label: match[1], text })
      }
    })
  }

  if (parts.length === 0 && withoutTags) {
    parts.push({ label, text: withoutTags })
  }

  return { label, phonetic, parts, tags }
}

function VocabularyDefinition({ definition }: { definition: string }): JSX.Element {
  const parsed = parseVocabularyDefinition(definition)

  return (
    <div className="vocabulary-definition">
      <div className="vocabulary-definition-meta">
        <span>{parsed.label}</span>
        {parsed.phonetic && <code>{parsed.phonetic}</code>}
      </div>
      <div className="vocabulary-definition-parts">
        {parsed.parts.map((part, index) => (
          <div className="vocabulary-definition-part" key={`${part.label}-${index}`}>
            <strong>{part.label}</strong>
            <span>{part.text}</span>
          </div>
        ))}
      </div>
      {parsed.tags.length > 0 && (
        <div className="vocabulary-definition-tags">
          {parsed.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function DictionaryEntryCard({
  entry,
  hasDocument,
  isSaved,
  onAdd
}: {
  entry: DictionaryEntryRecord
  hasDocument: boolean
  isSaved: boolean
  onAdd: (entry: DictionaryEntryRecord) => void
}): JSX.Element {
  const definition = makeDefinitionFromDictionary(entry)
  const sourceLabel = formatDictionarySource(entry.source)

  return (
    <article className="dictionary-entry-card">
      <div className="dictionary-entry-heading">
        <strong>{entry.word}</strong>
        <span title={entry.source}>{sourceLabel}</span>
      </div>
      <VocabularyDefinition definition={definition} />
      {entry.exchange && (
        <div className="dictionary-exchange">
          <strong>词形</strong>
          <span>{entry.exchange}</span>
        </div>
      )}
      <button disabled={!hasDocument || isSaved} onClick={() => onAdd(entry)}>
        <BookMarked size={15} />
        {!hasDocument ? '先打开 PDF' : isSaved ? '已在生词本' : '加入本 PDF 生词'}
      </button>
    </article>
  )
}

function formatDictionarySource(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) {
    return '本地词典'
  }

  const normalized = trimmed.replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).pop() ?? trimmed
  const label = fileName.replace(/\.(ifo|csv|db|sqlite)$/i, '')

  return label || '本地词典'
}

function VocabularyPanel({
  dictionarySources,
  hasDocument,
  vocabulary,
  onAddDictionaryEntry,
  onDefine,
  onDelete,
  onImportDictionary
}: VocabularyPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [dictionaryQuery, setDictionaryQuery] = useState('')
  const [dictionarySuggestions, setDictionarySuggestions] = useState<DictionaryEntryRecord[]>([])
  const [hasDictionarySearched, setHasDictionarySearched] = useState(false)
  const [isDictionarySearching, setIsDictionarySearching] = useState(false)
  const [dictionaryError, setDictionaryError] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredVocabulary = normalizedQuery
    ? vocabulary.filter((item) =>
        [item.word, item.definition, item.sourceSentence ?? '']
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : vocabulary
  const savedWords = useMemo(
    () => new Set(vocabulary.map((item) => item.word.trim().toLocaleLowerCase())),
    [vocabulary]
  )

  useEffect(() => {
    const trimmed = dictionaryQuery.trim()

    if (!trimmed) {
      setDictionarySuggestions([])
      setDictionaryError(null)
      setHasDictionarySearched(false)
      setIsDictionarySearching(false)
      return
    }

    setIsDictionarySearching(true)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.readingPartner
        .suggestDictionary(trimmed, 8)
        .then((result) => {
          if (cancelled) {
            return
          }

          setDictionarySuggestions(result.entries)
          setHasDictionarySearched(true)
          setDictionaryError(null)
        })
        .catch((error) => {
          if (cancelled) {
            return
          }

          setDictionarySuggestions([])
          setHasDictionarySearched(true)
          setDictionaryError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (cancelled) {
            return
          }

          setIsDictionarySearching(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [dictionaryQuery])

  return (
    <div className="inspector-content vocabulary-panel">
      <div className="vocab-tools">
        <section className="dictionary-lookup-panel">
          <div className="vocab-tool-heading">
            <strong>本地词典</strong>
            <button className="secondary-action" onClick={onImportDictionary}>
              <Upload size={16} />
              导入词典
            </button>
          </div>
          <p className="dictionary-status">
            {dictionarySources.length > 0
              ? `已加载 ${dictionarySources.length} 个本地词典`
              : '尚未加载本地词典'}
          </p>
          <form
            className="dictionary-search-form"
            onSubmit={(event) => {
              event.preventDefault()
            }}
          >
            <input
              placeholder="查询任意单词或短语"
              value={dictionaryQuery}
              onChange={(event) => setDictionaryQuery(event.target.value)}
            />
            <button disabled type="submit">
              <Search size={15} />
              {isDictionarySearching ? '联想中' : '自动联想'}
            </button>
          </form>
          {dictionaryError ? (
            <p className="error-text">{dictionaryError}</p>
          ) : dictionarySuggestions.length > 0 ? (
            <div className="dictionary-suggestion-list">
              {dictionarySuggestions.map((entry) => (
                <DictionaryEntryCard
                  entry={entry}
                  hasDocument={hasDocument}
                  isSaved={savedWords.has(entry.word.trim().toLocaleLowerCase())}
                  key={entry.id}
                  onAdd={onAddDictionaryEntry}
                />
              ))}
            </div>
          ) : hasDictionarySearched ? (
            <p className="muted">本地词典中没有找到“{dictionaryQuery.trim()}”。</p>
          ) : (
            <p className="muted">输入时会自动联想本地词典候选，再按需加入当前 PDF 生词本。</p>
          )}
        </section>

        <section className="vocabulary-search-panel">
          <div className="vocab-tool-heading">
            <strong>本 PDF 生词</strong>
            <span>{vocabulary.length} 条</span>
          </div>
          <input
            placeholder="搜索已加入的生词、释义或原句"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </section>
      </div>

      <div className="vocabulary-list">
        {vocabulary.length === 0 ? (
          <p className="muted">选中 PDF 里的单词或短语后点击“生词”，词条会出现在这里。</p>
        ) : filteredVocabulary.length === 0 ? (
          <p className="muted">没有匹配的词汇。</p>
        ) : (
          filteredVocabulary.map((item) => (
            <article className="vocabulary-item" key={item.id}>
              <div className="vocabulary-heading">
                <strong>{item.word}</strong>
                {item.pageNumber && <span>第 {item.pageNumber} 页</span>}
              </div>
              <VocabularyDefinition definition={item.definition} />
              {item.sourceSentence && <blockquote>{item.sourceSentence}</blockquote>}
              <button className="text-button" disabled={!hasDocument} onClick={() => onDefine(item)}>
                <Sparkles size={14} />
                AI 释义
              </button>
              <button className="text-button" onClick={() => onDelete(item.id)}>
                <Trash2 size={14} />
                删除
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

type SettingsPanelProps = {
  configuredProviderIds: Set<string>
  providers: AIProviderRecord[]
  readerName: string
  onClearKey: (providerId: string) => void
  onReaderNameChange: (value: string) => void
  onSaveKey: (providerId: string, apiKey: string) => void
  onToggle: (provider: AIProviderRecord, enabled: boolean) => void
}

function SettingsPanel({
  configuredProviderIds,
  providers,
  readerName,
  onClearKey,
  onReaderNameChange,
  onSaveKey,
  onToggle
}: SettingsPanelProps): JSX.Element {
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})

  return (
    <div className="inspector-content">
      <div className="settings-intro">
        <h2>AI Provider</h2>
        <p>API Key 会在主进程通过 Electron safeStorage 加密保存，页面只显示是否已配置。</p>
      </div>

      <section className="identity-card">
        <div>
          <strong>阅读身份</strong>
          <span>新建批注、高亮和书签会带上这个名字。</span>
        </div>
        <input
          placeholder="例如：Rain"
          value={readerName}
          onChange={(event) => onReaderNameChange(event.target.value)}
        />
      </section>

      <div className="provider-list">
        {providers.map((provider) => {
          const configured = configuredProviderIds.has(provider.id)

          return (
            <article className="provider-item" key={provider.id}>
              <div className="provider-heading">
                <div>
                  <strong>{provider.label}</strong>
                  <span>{provider.defaultModel}</span>
                </div>
                <label className="switch">
                  <input
                    checked={provider.enabled}
                    type="checkbox"
                    onChange={(event) => onToggle(provider, event.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <code>{provider.baseUrl}</code>
              <div className="provider-tags">
                {provider.supportsThinking && <span>thinking</span>}
                {provider.supportsLongContext && <span>long context</span>}
                <span className={configured ? 'tag-ok' : 'tag-warn'}>
                  <KeyRound size={12} />
                  {configured ? 'key saved' : 'no key'}
                </span>
              </div>
              <div className="key-row">
                <input
                  placeholder={configured ? '输入新 Key 可覆盖当前保存值' : '粘贴 API Key'}
                  type="password"
                  value={draftKeys[provider.id] ?? ''}
                  onChange={(event) =>
                    setDraftKeys((items) => ({ ...items, [provider.id]: event.target.value }))
                  }
                />
                <button
                  disabled={!draftKeys[provider.id]?.trim()}
                  onClick={() => {
                    onSaveKey(provider.id, draftKeys[provider.id] ?? '')
                    setDraftKeys((items) => ({ ...items, [provider.id]: '' }))
                  }}
                >
                  保存
                </button>
                <button disabled={!configured} onClick={() => onClearKey(provider.id)}>
                  清除
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export default App
