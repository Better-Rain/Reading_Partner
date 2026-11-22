import initSqlJs, { Database as SqlDatabase, SqlValue } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  LibraryBoardState,
  BoardTurn,
  BoardConversation,
  ShelfAnswer,
  ShelfTag,
  BookConnection,
  AIProviderRecord,
  AIArtifactRecord,
  AIChatMessageRecord,
  AIChatMessageRole,
  AIConversationRecord,
  AIPromptType,
  AnnotationRecord,
  CreateAnnotationInput,
  CreateVocabularyInput,
  DictionaryEntryRecord,
  DictionarySourceRecord,
  DocumentQuestionContext,
  DocumentSearchResult,
  DocumentTextIndexResult,
  DocumentTextIndexStatus,
  DocumentRecord,
  OcrPageLayout,
  OcrTextLine,
  OcrPageTextResult,
  UpdateAnnotationInput,
  UpdateAIConversationTitleInput,
  UpdateVocabularyDefinitionInput,
  UpsertAIProviderInput,
  VocabularyRecord
} from '../shared/types'
import { ExtractedPdfChunk, ExtractedPdfPage, splitPageIntoChunks } from './pdfText'

const now = (): string => new Date().toISOString()
const require = createRequire(import.meta.url)

type DocumentRow = {
  id: string
  title: string
  file_path: string
  file_size: number
  page_count: number | null
  last_page_number: number
  created_at: string
  last_opened_at: string
}

type AnnotationRow = {
  id: string
  document_id: string
  type: AnnotationRecord['type']
  page_number: number
  selected_text: string | null
  color: string | null
  note: string | null
  rects_json: string | null
  scope: AnnotationRecord['scope']
  vocabulary_id: string | null
  author_name: string
  created_at: string
  updated_at: string
}

type AIProviderRow = {
  id: string
  label: string
  base_url: string
  default_model: string
  api_key_ref: string | null
  supports_thinking: 0 | 1
  supports_long_context: 0 | 1
  enabled: 0 | 1
  updated_at: string
}

type AIArtifactRow = {
  id: string
  document_id: string
  annotation_id: string | null
  provider_id: string
  model: string
  prompt_type: AIPromptType
  input_text: string
  output_markdown: string
  page_number: number | null
  created_at: string
}

type AIConversationRow = {
  id: string
  document_id: string
  title: string
  created_at: string
  updated_at: string
}

type AIChatMessageRow = {
  id: string
  conversation_id: string
  role: AIChatMessageRole
  content: string
  selected_text: string | null
  page_number: number | null
  provider_id: string | null
  model: string | null
  artifact_id: string | null
  created_at: string
}

type VocabularyRow = {
  id: string
  document_id: string | null
  annotation_id: string | null
  word: string
  definition: string
  source_sentence: string | null
  page_number: number | null
  created_at: string
}

type DictionaryEntryInput = {
  word: string
  phonetic?: string | null
  definition?: string | null
  translation?: string | null
  pos?: string | null
  exchange?: string | null
  source: string
}

type DictionaryEntryRow = {
  id: string
  word: string
  normalized_word: string
  phonetic: string | null
  definition: string | null
  translation: string | null
  pos: string | null
  exchange: string | null
  source: string
  updated_at: string
}

type DictionarySourceRow = {
  id: string
  type: DictionarySourceRecord['type']
  label: string
  path: string
  entry_count: number | null
  created_at: string
}

type DocumentTextIndexStatusRow = {
  page_count: number | null
  pages_indexed: number
  chunks_indexed: number
  indexed_at: string | null
}

type DocumentPageRow = {
  document_id: string
  page_number: number
  text: string
  char_count: number
  indexed_at: string
  ocr_layout_json: string | null
}

type DocumentChunkRow = {
  id: string
  document_id: string
  page_number: number
  chunk_index: number
  text: string
}

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  title: row.title,
  filePath: row.file_path,
  fileSize: row.file_size,
  pageCount: row.page_count,
  lastPageNumber: Math.max(1, row.last_page_number ?? 1),
  createdAt: row.created_at,
  lastOpenedAt: row.last_opened_at
})

const parseOcrPageLayout = (
  documentId: string,
  pageNumber: number,
  value: string | null
): OcrPageLayout | null => {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const lines = (parsed as { lines?: unknown }).lines

    if (!Array.isArray(lines)) {
      return null
    }

    const normalizedLines = lines
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const line = item as Partial<Record<keyof OcrTextLine, unknown>>
        const text = typeof line.text === 'string' ? line.text.trim() : ''
        const left = Number(line.left)
        const top = Number(line.top)
        const width = Number(line.width)
        const height = Number(line.height)

        if (!text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
          return null
        }

        return { text, left, top, width, height }
      })
      .filter((line): line is OcrTextLine => Boolean(line))

    return normalizedLines.length
      ? {
          documentId,
          pageNumber,
          lines: normalizedLines
        }
      : null
  } catch {
    return null
  }
}

const toAnnotation = (row: AnnotationRow): AnnotationRecord => ({
  id: row.id,
  documentId: row.document_id,
  type: row.type,
  pageNumber: row.page_number,
  selectedText: row.selected_text,
  color: row.color,
  note: row.note,
  rectsJson: row.rects_json,
  scope: row.scope ?? null,
  vocabularyId: row.vocabulary_id,
  authorName: row.author_name || 'Reader',
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const toAIProvider = (row: AIProviderRow): AIProviderRecord => ({
  id: row.id,
  label: row.label,
  baseUrl: row.base_url,
  defaultModel: row.default_model,
  apiKeyRef: row.api_key_ref,
  supportsThinking: row.supports_thinking === 1,
  supportsLongContext: row.supports_long_context === 1,
  enabled: row.enabled === 1,
  updatedAt: row.updated_at
})

const toAIArtifact = (row: AIArtifactRow): AIArtifactRecord => ({
  id: row.id,
  documentId: row.document_id,
  annotationId: row.annotation_id,
  providerId: row.provider_id,
  model: row.model,
  promptType: row.prompt_type,
  inputText: row.input_text,
  outputMarkdown: row.output_markdown,
  pageNumber: row.page_number,
  createdAt: row.created_at
})

const toAIConversation = (row: AIConversationRow): AIConversationRecord => ({
  id: row.id,
  documentId: row.document_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const toAIChatMessage = (row: AIChatMessageRow): AIChatMessageRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  selectedText: row.selected_text,
  pageNumber: row.page_number,
  providerId: row.provider_id,
  model: row.model,
  artifactId: row.artifact_id,
  createdAt: row.created_at
})

const toVocabulary = (row: VocabularyRow): VocabularyRecord => ({
  id: row.id,
  documentId: row.document_id,
  annotationId: row.annotation_id,
  word: row.word,
  definition: row.definition,
  sourceSentence: row.source_sentence,
  pageNumber: row.page_number,
  createdAt: row.created_at
})

const toDictionaryEntry = (row: DictionaryEntryRow): DictionaryEntryRecord => ({
  id: row.id,
  word: row.word,
  phonetic: row.phonetic,
  definition: row.definition,
  translation: row.translation,
  pos: row.pos,
  exchange: row.exchange,
  source: row.source,
  updatedAt: row.updated_at
})

const toDictionarySource = (row: DictionarySourceRow): DictionarySourceRecord => ({
  id: row.id,
  type: row.type,
  label: row.label,
  path: row.path,
  entryCount: row.entry_count,
  createdAt: row.created_at
})

const normalizeDictionaryWord = (word: string): string => word.trim().toLocaleLowerCase()
const escapeSqlLikePattern = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`)
const questionStopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'what',
  'which',
  'why',
  'with'
])
const normalizeSearchQuery = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .trim()
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 0)
    )
  ).slice(0, 8)

const normalizeQuestionQuery = (query: string): string[] =>
  normalizeSearchQuery(query)
    .filter((term) => term.length > 1 && !questionStopWords.has(term))
    .slice(0, 10)

const escapeLikeTerm = (term: string): string =>
  term.replace(/[\\%_]/g, (match) => `\\${match}`)

const countOccurrences = (text: string, term: string): number => {
  let count = 0
  let index = text.indexOf(term)

  while (index !== -1) {
    count += 1
    index = text.indexOf(term, index + term.length)
  }

  return count
}

const createSearchSnippet = (text: string, terms: string[]): string => {
  const compact = text.replace(/\s+/g, ' ').trim()
  const lower = compact.toLocaleLowerCase()
  const firstMatch = terms.reduce<number>((best, term) => {
    const index = lower.indexOf(term)
    return index === -1 ? best : Math.min(best, index)
  }, Number.POSITIVE_INFINITY)

  if (!Number.isFinite(firstMatch)) {
    return compact.slice(0, 240)
  }

  const start = Math.max(0, firstMatch - 80)
  const end = Math.min(compact.length, firstMatch + 220)
  return `${start > 0 ? '...' : ''}${compact.slice(start, end)}${end < compact.length ? '...' : ''}`
}

export class ReadingPartnerDatabase {
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private writeInProgress: Promise<void> | null = null

  private constructor(
    private readonly db: SqlDatabase,
    private readonly databasePath: string
  ) {}

  static async open(databasePath: string): Promise<ReadingPartnerDatabase> {
    mkdirSync(dirname(databasePath), { recursive: true })
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    })
    const db = existsSync(databasePath)
      ? new SQL.Database(readFileSync(databasePath))
      : new SQL.Database()
    const store = new ReadingPartnerDatabase(db, databasePath)

    store.db.run('pragma foreign_keys = ON')
    store.migrate()
    store.seedProviders()

    return store
  }

  getBoard(): LibraryBoardState {
    const row = this.get<{ revision: number; contents: string }>('select revision, contents from library_board where id=1')
    return row ? { ...JSON.parse(row.contents), revision: row.revision } : { revision: 0, order: [], groups: [] }
  }

  saveBoard(input: LibraryBoardState): LibraryBoardState {
    const previous = this.getBoard()
    if (input.revision !== previous.revision) throw new Error('另一台设备已调整书库，请按最新布局重试。')
    const ids = new Set(this.listDocuments().map(doc => doc.id))
    const bookList = (values: string[]): string[] => {
      if (!Array.isArray(values) || values.length > ids.size || values.some(id => !ids.has(id))) throw new Error('书目列表无效')
      return [...new Set(values)]
    }
    if (!Array.isArray(input.groups) || input.groups.length > 200) throw new Error('最多支持 200 个分组')
    function normalizeTags(tags: ShelfTag[], previousTags: ShelfTag[], books: string[]) {
      if (!Array.isArray(tags) || tags.length > 200) throw new Error('每组最多保存 200 条标签')
      const seenTags = new Set<string>()
      const tagIds = new Set(tags.map(tag => tag?.id))
      const neighbors = new Map<string, Set<string>>()
      for (const id of tagIds) neighbors.set(id, new Set())
      const normalized = tags.map(tag => {
        if (!tag || typeof tag.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(tag.id) || seenTags.has(tag.id)
          || typeof tag.text !== 'string' || !tag.text.trim() || tag.text.length > 800
          || !['user', 'ai'].includes(tag.author)) throw new Error('标签内容或编号无效')
        seenTags.add(tag.id)
        // An older client can remove a book without knowing about its tags.
        const oldTag = previousTags.find(item => item.id === tag.id)
        const related = tag.relatedTagIds === undefined ? oldTag?.relatedTagIds ?? [] : tag.relatedTagIds
        if (!Array.isArray(related) || related.length > 199) throw new Error('关联标签列表无效')
        for (const id of related) {
          if (!tagIds.has(id) && oldTag?.relatedTagIds?.includes(id)) continue // A linked tag was deleted.
          if (!tagIds.has(id) || id === tag.id) throw new Error('请选择同一块线索板上的其他标签')
          neighbors.get(tag.id)!.add(id)
          neighbors.get(id)!.add(tag.id)
        }
        const previousLinks = oldTag?.books ?? []
        const links = bookList(tag.books).filter(id => {
          if (books.includes(id)) return true
          if (previousLinks.includes(id)) return false
          throw new Error('标签只能关联组内书籍')
        })
        const position = tag.position === undefined ? oldTag?.position : tag.position
        if (position !== undefined && (!position || ![position.x, position.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1000000))) {
          throw new Error('标签坐标无效')
        }
        const color = tag.color === undefined ? oldTag?.color : tag.color
        if (color !== undefined && (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color))) throw new Error('标签颜色无效')
        return { ...(color ? { color } : {}), id: tag.id, text: tag.text.trim(), author: tag.author, books: links,
          ...(position ? { position: { x: position.x, y: position.y } } : {}) }
      })
      return normalized.map(tag => ({ ...tag, relatedTagIds: [...neighbors.get(tag.id)!] }))
    }
    function normalizeConnections(incoming: BookConnection[] | undefined, previousLinks: BookConnection[], members: Set<string>) {
      const links = incoming === undefined ? previousLinks : incoming
      if (!Array.isArray(links) || links.length > 500) throw new Error('每块线索板最多保存 500 条书间连线')
      const usedIds = new Set<string>(), pairs = new Set<string>()
      const result: BookConnection[] = []
      for (const link of links) {
        if (!link || typeof link.id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(link.id) || usedIds.has(link.id)
          || typeof link.summary !== 'string' || link.summary.length > 800 || !['user','ai'].includes(link.author)
          || typeof link.from !== 'string' || typeof link.to !== 'string' || link.from === link.to) throw new Error('书间连线无效')
        if (!members.has(link.from) || !members.has(link.to)) {
          // Removing a member also removes its previously saved edges.
          if (previousLinks.some(old => old.id === link.id && old.from === link.from && old.to === link.to)) continue
          throw new Error('只能连接当前线索板上的书籍')
        }
        const pair = JSON.stringify([link.from,link.to].sort())
        if (pairs.has(pair)) throw new Error('这两本书之间已有连线')
        pairs.add(pair); usedIds.add(link.id)
        result.push({id: link.id, from: link.from, to: link.to, summary: link.summary.trim(), author: link.author})
      }
      return result
    }
    const used = new Set<string>()
    const groups = input.groups.map(group => {
      if (!/^[a-z0-9-]{1,64}$/i.test(group.id) || used.has(group.id) || !group.name?.trim() || group.name.length > 80) throw new Error('分组名称或编号无效')
      used.add(group.id)
      const books = bookList(group.books)
      const previousGroup = previous.groups.find(item => item.id === group.id)
      const tags = group.tags === undefined ? previousGroup?.tags ?? [] : group.tags
      const normalized = normalizeTags(tags, previousGroup?.tags ?? [], books)
      return { id: group.id, name: group.name.trim(), books, tags: normalized, connections: normalizeConnections(group.connections, previousGroup?.connections ?? [], new Set(books)) }
    })
    // Older clients only send order and groups when updating a shelf.
    const positions = input.positions ?? previous.positions ?? {}
    for (const [id, point] of Object.entries(positions)) {
      if (!ids.has(id) || !point || ![point.x, point.y].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1000000)) {
        throw new Error('书籍坐标无效')
      }
    }
    const tags = normalizeTags(input.tags ?? previous.tags ?? [], previous.tags ?? [], [...ids])
    const connections = normalizeConnections(input.connections, previous.connections ?? [], ids)
    const contents = { connections, tags, groups, order: bookList(input.order), positions }
    const revision = input.revision + 1
    this.db.run('insert or replace into library_board values (1,?,?)', [revision, JSON.stringify(contents)])
    for (const group of previous.groups) {
      if (!used.has(group.id)) {
        this.db.run('delete from board_turns where scope = ?', [group.id])
        this.db.run('delete from board_conversations where scope = ?', [group.id])
      }
    }
    this.persist()
    return { revision, ...contents }
  }

  listBoardConversations(groupId: string | null): BoardConversation[] {
    return this.query<BoardConversation>(`select id,title,updated_at as updatedAt from board_conversations
      where scope=? order by updated_at desc, rowid desc`, [groupId ?? ''])
  }

  renameBoardConversation(groupId: string | null, id: string, title: string): void {
    if (typeof title !== 'string' || !title.trim() || title.length > 100) throw new Error('对话名称请填写 1 至 100 字')
    this.db.run('update board_conversations set title=?, updated_at=? where scope=? and id=?', [title.trim(), now(), groupId ?? '', id])
    if (!this.db.getRowsModified()) throw new Error('此对话不在当前分组内')
    this.persist()
  }

  getBoardHistory(groupId: string | null, before?: number, limit = 30, conversationId = 'legacy'): BoardTurn[] {
    const rows = this.query<{ id: number; question: string; answer: string }>(
      'select id, question, answer from board_turns where scope = ? and conversation_id = ? and id < ? order by id desc limit ?',
      [groupId ?? '', conversationId, before ?? Number.MAX_SAFE_INTEGER, limit]
    )
    return rows.reverse().map(row => ({ id: row.id, question: row.question, result: JSON.parse(row.answer) }))
  }

  finishBoardTurn(groupId: string | null, question: string, result: ShelfAnswer, next?: LibraryBoardState, conversationId: string | null = 'legacy', title?: string): void {
    this.db.run('begin transaction')
    try {
      if (next) this.saveBoard(next)
      if (conversationId !== null) {
        const scope = groupId ?? ''
        this.db.run(`insert into board_conversations(scope,id,title,updated_at) values (?,?,?,?)
          on conflict(scope,id) do update set updated_at=excluded.updated_at`,
          [scope, conversationId, title?.trim().slice(0, 100) || question.slice(0, 24), now()])
        this.db.run('insert into board_turns(scope, conversation_id, question, answer) values (?,?,?,?)',
          [scope, conversationId, question, JSON.stringify(result)])
      }
      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
    this.persist()
  }

  getBookOverview(id: string, title: string): string | undefined {
    return this.get<{ overview: string }>('select overview from board_book_overviews where document_id=? and title=?', [id, title])?.overview
  }

  saveBookOverview(id: string, title: string, overview: string): void {
    this.db.run('insert or replace into board_book_overviews(document_id,title,overview) values (?,?,?)', [id, title, overview])
    this.persist()
  }

  getBoardPageText(id: string, page: number): string | undefined {
    return this.get<{ text: string }>('select substr(text,1,2200) as text from document_pages where document_id=? and page_number=?', [id, page])?.text.trim()
  }

  sampleBoardPages(id: string): { pageNumber: number; text: string }[] {
    const rows = this.query<{ page_number: number }>('select page_number from document_pages where document_id=? and length(trim(text))>20 order by page_number', [id])
    const count = Math.min(rows.length, 6)
    return Array.from({ length: count }, (_, i) => {
      const pageNumber = rows[Math.round(i * (rows.length - 1) / Math.max(1, count - 1))]!.page_number
      const row = this.get<{ text: string }>('select substr(text,1,1000) as text from document_pages where document_id=? and page_number=?', [id, pageNumber])!
      return { pageNumber, text: row.text }
    })
  }

  listDocuments(): DocumentRecord[] {
    const rows = this.query<DocumentRow>('select * from documents order by last_opened_at desc')
    return rows.map(toDocument)
  }

  getReaderOverview() {
    // Shared imports start on page one, even if this reader has never opened them.
    const started = `d.last_page_number > 1 or exists (
      select 1 from reading_visits v where v.document_id = d.id)`
    const stats = this.get<{ books: number; notes: number; chats: number }>(`
      select (select count(*) from documents d where ${started}) as books,
        (select count(*) from annotations) as notes,
        (select count(*) from ai_conversations) + (select count(*) from board_conversations) as chats`)!
    const books = this.query<{ id: string; title: string; page: number; total: number | null }>(`
      select id, title, last_page_number as page, page_count as total from documents d
      where ${started} order by last_opened_at desc, d.id limit 4`)
    const notes = this.query<{
      id: string; book: string; title: string; page: number; kind: string; excerpt: string
    }>(`select a.id, d.id as book, d.title, a.page_number as page, coalesce(a.scope, a.type) as kind,
        substr(coalesce(nullif(trim(a.note), ''), a.selected_text, ''), 1, 160) as excerpt
      from annotations a join documents d on d.id = a.document_id
      order by a.updated_at desc, a.rowid desc limit 3`)
    const recent = this.query<{ id: string; title: string; book: string | null; scope: string | null; source: string | null }>(`
      select id, title, book, scope, source from (
        select c.id, c.title, d.id as book, null as scope, d.title as source, c.updated_at
        from ai_conversations c join documents d on d.id = c.document_id
        union all select id, title, null, scope, null, updated_at from board_conversations
      ) order by updated_at desc, id limit 3`)
    const groups = recent.some(chat => chat.scope) ? this.getBoard().groups : []
    const chats = recent.map(chat => ({ ...chat, source: chat.source ??
      (chat.scope ? groups.find(group => group.id === chat.scope)?.name ?? '书库分组' : '全部书籍') }))
    return { stats, books, notes, chats }
  }

  getDocument(id: string): DocumentRecord {
    const row = this.get<DocumentRow>('select * from documents where id = ?', [id])

    if (!row) {
      throw new Error(`Document not found: ${id}`)
    }

    return toDocument(row)
  }

  importDocument(filePath: string): DocumentRecord {
    const fileStat = statSync(filePath)
    const title = filePath.split(/[\\/]/).at(-1) ?? 'Untitled PDF'
    const existing = this.get<DocumentRow>('select * from documents where file_path = ?', [filePath])
    const timestamp = now()

    if (existing) {
      this.db.run('update documents set file_size = ?, last_opened_at = ? where id = ?', [
        fileStat.size,
        timestamp,
        existing.id
      ])
      this.persist()

      return this.getDocument(existing.id)
    }

    const id = randomUUID()

    this.db.run(
      `insert into documents (
          id, title, file_path, file_size, page_count, last_page_number, created_at, last_opened_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, filePath, fileStat.size, null, 1, timestamp, timestamp]
    )
    this.persist()

    return this.getDocument(id)
  }

  addSharedDocument(doc: Pick<DocumentRecord, 'id' | 'title' | 'filePath' | 'fileSize' | 'createdAt' | 'pageCount'>): void {
    this.db.run(`insert or ignore into documents
      (id,title,file_path,file_size,page_count,last_page_number,created_at,last_opened_at)
      values (?,?,?,?,?,1,?,?)`, [doc.id,doc.title,doc.filePath,doc.fileSize,doc.pageCount,doc.createdAt,doc.createdAt])
    if (this.db.getRowsModified()) this.persist()
  }

  saveDocumentProgress(documentId: string, pageNumber: number): DocumentRecord {
    const document = this.getDocument(documentId)
    const normalizedPageNumber = Number.isFinite(pageNumber) ? Math.max(1, Math.floor(pageNumber)) : 1
    const safePageNumber =
      typeof document.pageCount === 'number' && document.pageCount > 0
        ? Math.min(normalizedPageNumber, document.pageCount)
        : normalizedPageNumber
    const timestamp = now()
    this.db.run('insert or ignore into reading_visits values (?, ?)', [documentId, safePageNumber])
    this.db.run(
      `update documents
       set last_page_number = ?,
           last_opened_at = ?
       where id = ?`,
      [safePageNumber, timestamp, documentId]
    )
    this.persist()

    return this.getDocument(documentId)
  }

  visitedPages(documentId: string): Set<number> {
    return new Set(this.query<{ page_number: number }>(
      'select page_number from reading_visits where document_id = ?', [documentId]
    ).map(row => row.page_number))
  }

  getDocumentTextIndexStatus(documentId: string): DocumentTextIndexStatus {
    const document = this.getDocument(documentId)
    const row = this.get<DocumentTextIndexStatusRow>(
      `select
         d.page_count,
         coalesce(p.pages_indexed, 0) as pages_indexed,
         coalesce(c.chunks_indexed, 0) as chunks_indexed,
         p.indexed_at as indexed_at
       from documents d
       left join (
         select document_id, count(*) as pages_indexed, max(indexed_at) as indexed_at
         from document_pages
         group by document_id
       ) p on p.document_id = d.id
       left join (
         select document_id, count(*) as chunks_indexed
         from document_chunks
         group by document_id
       ) c on c.document_id = d.id
       where d.id = ?
       limit 1`,
      [documentId]
    )

    return {
      documentId,
      pageCount: row?.page_count ?? document.pageCount,
      pagesIndexed: row?.pages_indexed ?? 0,
      chunksIndexed: row?.chunks_indexed ?? 0,
      indexedAt: row?.indexed_at ?? null
    }
  }

  replaceDocumentTextIndex(input: {
    documentId: string
    pageCount: number
    pages: ExtractedPdfPage[]
    chunks: ExtractedPdfChunk[]
  }): DocumentTextIndexResult {
    const timestamp = now()
    const existingPages = this.query<{
      page_number: number
      text: string
      ocr_layout_json: string | null
    }>(
      `select page_number, text, ocr_layout_json
       from document_pages
       where document_id = ? and char_count > 0`,
      [input.documentId]
    )
    const existingChunks = this.query<DocumentChunkRow>(
      `select id, document_id, page_number, chunk_index, text
       from document_chunks
       where document_id = ?
       order by page_number, chunk_index`,
      [input.documentId]
    )
    const existingPageText = new Map(existingPages.map((page) => [page.page_number, page.text]))
    const existingPageLayout = new Map(
      existingPages.map((page) => [page.page_number, page.ocr_layout_json])
    )
    const preservedPageNumbers = new Set(
      input.pages
        .filter((page) => !page.text && existingPageText.has(page.pageNumber))
        .map((page) => page.pageNumber)
    )
    const pages = input.pages.map((page) =>
      preservedPageNumbers.has(page.pageNumber)
        ? { ...page, text: existingPageText.get(page.pageNumber) ?? page.text }
        : page
    )
    const chunks = [
      ...input.chunks.filter((chunk) => !preservedPageNumbers.has(chunk.pageNumber)),
      ...existingChunks
        .filter((chunk) => preservedPageNumbers.has(chunk.page_number))
        .map<ExtractedPdfChunk>((chunk) => ({
          pageNumber: chunk.page_number,
          chunkIndex: chunk.chunk_index,
          text: chunk.text
        }))
    ]
    const pageStatement = this.db.prepare(
      `insert into document_pages (
        document_id, page_number, text, char_count, indexed_at, ocr_layout_json
      ) values (?, ?, ?, ?, ?, ?)`
    )
    const chunkStatement = this.db.prepare(
      `insert into document_chunks (
        id, document_id, page_number, chunk_index, text, char_count, indexed_at
      ) values (?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.run('begin transaction')

    try {
      this.db.run('update documents set page_count = ? where id = ?', [
        input.pageCount,
        input.documentId
      ])
      this.db.run('delete from document_chunks where document_id = ?', [input.documentId])
      this.db.run('delete from document_pages where document_id = ?', [input.documentId])

      for (const page of pages) {
        pageStatement.run([
          input.documentId,
          page.pageNumber,
          page.text,
          page.text.length,
          timestamp,
          preservedPageNumbers.has(page.pageNumber)
            ? existingPageLayout.get(page.pageNumber) ?? null
            : null
        ])
      }

      for (const chunk of chunks) {
        chunkStatement.run([
          randomUUID(),
          input.documentId,
          chunk.pageNumber,
          chunk.chunkIndex,
          chunk.text,
          chunk.text.length,
          timestamp
        ])
      }

      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    } finally {
      pageStatement.free()
      chunkStatement.free()
    }

    this.persist()

    return {
      ...this.getDocumentTextIndexStatus(input.documentId),
      skipped: false
    }
  }

  upsertDocumentPageText(input: {
    documentId: string
    layout: OcrPageLayout | null
    pageNumber: number
    text: string
  }): OcrPageTextResult {
    const document = this.getDocument(input.documentId)
    const pageNumber = Math.max(1, Math.floor(input.pageNumber))
    const timestamp = now()
    const text = input.text.trim()
    const chunks = splitPageIntoChunks(pageNumber, text)
    const pageCount =
      typeof document.pageCount === 'number' && document.pageCount > 0
        ? Math.max(document.pageCount, pageNumber)
        : pageNumber
    const chunkStatement = this.db.prepare(
      `insert into document_chunks (
        id, document_id, page_number, chunk_index, text, char_count, indexed_at
      ) values (?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.run('begin transaction')

    try {
      this.db.run('update documents set page_count = ? where id = ?', [
        pageCount,
        input.documentId
      ])
      this.db.run('delete from document_chunks where document_id = ? and page_number = ?', [
        input.documentId,
        pageNumber
      ])
      this.db.run(
        `insert into document_pages (
          document_id, page_number, text, char_count, indexed_at, ocr_layout_json
        ) values (?, ?, ?, ?, ?, ?)
        on conflict(document_id, page_number) do update set
          text = excluded.text,
          char_count = excluded.char_count,
          indexed_at = excluded.indexed_at,
          ocr_layout_json = excluded.ocr_layout_json`,
        [
          input.documentId,
          pageNumber,
          text,
          text.length,
          timestamp,
          input.layout ? JSON.stringify(input.layout) : null
        ]
      )

      for (const chunk of chunks) {
        chunkStatement.run([
          randomUUID(),
          input.documentId,
          pageNumber,
          chunk.chunkIndex,
          chunk.text,
          chunk.text.length,
          timestamp
        ])
      }

      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    } finally {
      chunkStatement.free()
    }

    this.persist()

    return {
      ...this.getDocumentTextIndexStatus(input.documentId),
      pageNumber,
      charCount: text.length,
      pageChunkCount: chunks.length,
      layout: input.layout
    }
  }

  getDocumentPageOcrLayout(documentId: string, pageNumber: number): OcrPageLayout | null {
    this.getDocument(documentId)
    const normalizedPageNumber = Math.max(1, Math.floor(pageNumber))
    const row = this.get<DocumentPageRow>(
      `select *
       from document_pages
       where document_id = ? and page_number = ?
       limit 1`,
      [documentId, normalizedPageNumber]
    )

    return parseOcrPageLayout(documentId, normalizedPageNumber, row?.ocr_layout_json ?? null)
  }

  searchDocumentText(documentId: string, query: string, limit = 30): DocumentSearchResult[] {
    this.getDocument(documentId)
    const terms = normalizeSearchQuery(query)

    if (terms.length === 0) {
      return []
    }

    const whereTerms = terms.map(() => "lower(text) like ? escape '\\'").join(' and ')
    const rows = this.query<DocumentChunkRow>(
      `select id, document_id, page_number, chunk_index, text
       from document_chunks
       where document_id = ? and ${whereTerms}
       order by page_number asc, chunk_index asc
       limit ?`,
      [
        documentId,
        ...terms.map((term) => `%${escapeLikeTerm(term)}%`),
        Math.max(1, Math.min(limit * 4, 200))
      ]
    )

    return rows
      .map((row) => {
        const lower = row.text.toLocaleLowerCase()
        const score = terms.reduce((total, term) => total + countOccurrences(lower, term), 0)

        return {
          id: row.id,
          documentId: row.document_id,
          pageNumber: row.page_number,
          chunkIndex: row.chunk_index,
          text: row.text,
          snippet: createSearchSnippet(row.text, terms),
          score
        }
      })
      .sort((left, right) => right.score - left.score || left.pageNumber - right.pageNumber)
      .slice(0, limit)
  }

  getRelevantDocumentChunks(
    documentId: string,
    query: string,
    pageNumber: number | null,
    limit = 6
  ): DocumentQuestionContext[] {
    this.getDocument(documentId)
    const terms = normalizeQuestionQuery(query)
    const maxRows = Math.max(limit * 8, 48)
    const normalizedPageNumber =
      pageNumber && Number.isFinite(pageNumber) ? Math.max(1, Math.floor(pageNumber)) : null
    const results: DocumentQuestionContext[] = []
    const seenChunkIds = new Set<string>()
    const addRows = (rows: DocumentChunkRow[], score = 0): void => {
      for (const row of rows) {
        if (results.length >= limit || seenChunkIds.has(row.id)) {
          continue
        }

        seenChunkIds.add(row.id)
        results.push({
          id: row.id,
          documentId: row.document_id,
          pageNumber: row.page_number,
          chunkIndex: row.chunk_index,
          text: row.text,
          score
        })
      }
    }
    const addContexts = (contexts: DocumentQuestionContext[]): void => {
      for (const context of contexts) {
        if (results.length >= limit || seenChunkIds.has(context.id)) {
          continue
        }

        seenChunkIds.add(context.id)
        results.push(context)
      }
    }

    if (normalizedPageNumber) {
      const currentPageLimit = Math.max(2, Math.min(limit, Math.ceil(limit * 0.5)))
      const neighborEdgeLimit = limit >= 14 ? 2 : 1
      const neighborRadius = limit >= 14 ? 2 : 1
      const currentPageRows = this.query<DocumentChunkRow>(
        `select id, document_id, page_number, chunk_index, text
         from document_chunks
         where document_id = ? and page_number = ?
         order by chunk_index asc
         limit ?`,
        [documentId, normalizedPageNumber, currentPageLimit]
      )

      addRows(currentPageRows)

      for (let offset = 1; offset <= neighborRadius; offset += 1) {
        const previousPage = normalizedPageNumber - offset

        if (previousPage >= 1) {
          const previousRows = this.query<DocumentChunkRow>(
            `select id, document_id, page_number, chunk_index, text
             from document_chunks
             where document_id = ? and page_number = ?
             order by chunk_index desc
             limit ?`,
            [documentId, previousPage, neighborEdgeLimit]
          ).reverse()

          addRows(previousRows)
        }

        const nextRows = this.query<DocumentChunkRow>(
          `select id, document_id, page_number, chunk_index, text
           from document_chunks
           where document_id = ? and page_number = ?
           order by chunk_index asc
           limit ?`,
          [documentId, normalizedPageNumber + offset, neighborEdgeLimit]
        )

        addRows(nextRows)
      }
    }

    if (terms.length > 0) {
      const whereTerms = terms.map(() => "lower(text) like ? escape '\\'").join(' or ')
      const rows = this.query<DocumentChunkRow>(
        `select id, document_id, page_number, chunk_index, text
         from document_chunks
         where document_id = ? and (${whereTerms})
         order by page_number asc, chunk_index asc
         limit ?`,
        [
          documentId,
          ...terms.map((term) => `%${escapeLikeTerm(term)}%`),
          Math.min(maxRows, 240)
        ]
      )

      const scored = rows
        .map((row) => {
          const lower = row.text.toLocaleLowerCase()
          const score = terms.reduce((total, term) => total + countOccurrences(lower, term), 0)
          const pageDistance = normalizedPageNumber
            ? Math.abs(row.page_number - normalizedPageNumber)
            : 0

          return {
            id: row.id,
            documentId: row.document_id,
            pageNumber: row.page_number,
            chunkIndex: row.chunk_index,
            text: row.text,
            score,
            pageDistance
          }
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.pageDistance - right.pageDistance ||
            left.pageNumber - right.pageNumber ||
            left.chunkIndex - right.chunkIndex
        )

      if (scored.length > 0) {
        addContexts(scored.map(({ pageDistance: _pageDistance, ...row }) => row))
      }
    }

    if (results.length > 0) {
      return results
    }

    if (normalizedPageNumber) {
      const rows = this.query<DocumentChunkRow>(
        `select id, document_id, page_number, chunk_index, text
         from document_chunks
         where document_id = ? and page_number between ? and ?
         order by page_number asc, chunk_index asc
         limit ?`,
        [documentId, Math.max(1, normalizedPageNumber - 1), normalizedPageNumber + 1, limit]
      )

      if (rows.length > 0) {
        return rows.map((row) => ({
          id: row.id,
          documentId: row.document_id,
          pageNumber: row.page_number,
          chunkIndex: row.chunk_index,
          text: row.text,
          score: 0
        }))
      }
    }

    return this.query<DocumentChunkRow>(
      `select id, document_id, page_number, chunk_index, text
       from document_chunks
       where document_id = ?
       order by page_number asc, chunk_index asc
       limit ?`,
      [documentId, limit]
    ).map((row) => ({
      id: row.id,
      documentId: row.document_id,
      pageNumber: row.page_number,
      chunkIndex: row.chunk_index,
      text: row.text,
      score: 0
    }))
  }

  listAnnotations(documentId: string): AnnotationRecord[] {
    const rows = this.query<AnnotationRow>(
      `select * from annotations
         where document_id = ?
         order by page_number asc, created_at asc`,
      [documentId]
    )

    return rows.map(toAnnotation)
  }

  createAnnotation(input: CreateAnnotationInput): AnnotationRecord {
    const id = randomUUID()
    const timestamp = now()
    const authorName = input.authorName?.trim() || 'Reader'

    this.db.run(
      `insert into annotations (
          id, document_id, type, page_number, selected_text, color, note, rects_json, vocabulary_id, author_name, created_at, updated_at, scope
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.documentId,
        input.type,
        input.pageNumber,
        input.selectedText ?? null,
        input.color ?? null,
        input.note ?? null,
        input.rectsJson ?? null,
        input.vocabularyId ?? null,
        authorName,
        timestamp,
        timestamp,
        input.scope ?? null
      ]
    )
    this.persist()

    const row = this.get<AnnotationRow>('select * from annotations where id = ?', [id])
    if (!row) {
      throw new Error(`Annotation not found after insert: ${id}`)
    }
    return toAnnotation(row)
  }

  updateAnnotation(input: UpdateAnnotationInput): AnnotationRecord {
    const row = this.get<AnnotationRow>('select * from annotations where id = ?', [input.id])

    if (!row) {
      throw new Error(`Annotation not found: ${input.id}`)
    }

    const timestamp = now()
    this.db.run(
      `update annotations
         set note = ?, color = ?, updated_at = ?
       where id = ?`,
      [
        input.note === undefined ? row.note : input.note,
        input.color === undefined ? row.color : input.color,
        timestamp,
        input.id
      ]
    )
    this.persist()

    const updated = this.get<AnnotationRow>('select * from annotations where id = ?', [input.id])
    if (!updated) {
      throw new Error(`Annotation not found after update: ${input.id}`)
    }

    return toAnnotation(updated)
  }

  deleteAnnotation(id: string): void {
    const annotation = this.get<AnnotationRow>('select * from annotations where id = ?', [id])
    const linkedVocabularyIds = new Set<string>()

    if (annotation?.vocabulary_id) {
      linkedVocabularyIds.add(annotation.vocabulary_id)
    }

    this.query<{ id: string }>('select id from vocabulary where annotation_id = ?', [id]).forEach((row) =>
      linkedVocabularyIds.add(row.id)
    )

    this.db.run('begin transaction')

    try {
      for (const vocabularyId of linkedVocabularyIds) {
        this.db.run('delete from vocabulary where id = ?', [vocabularyId])
      }

      this.db.run('delete from annotations where id = ?', [id])
      this.db.run('commit')
      this.persist()
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
  }

  restoreAnnotation(annotation: AnnotationRecord): AnnotationRecord {
    this.getDocument(annotation.documentId)
    this.db.run(
      `insert into annotations (
          id, document_id, type, page_number, selected_text, color, note, rects_json, vocabulary_id, author_name, created_at, updated_at, scope
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          document_id = excluded.document_id,
          type = excluded.type,
          page_number = excluded.page_number,
          selected_text = excluded.selected_text,
          color = excluded.color,
          note = excluded.note,
          rects_json = excluded.rects_json,
          vocabulary_id = excluded.vocabulary_id,
          author_name = excluded.author_name,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at, scope = excluded.scope`,
      [
        annotation.id,
        annotation.documentId,
        annotation.type,
        annotation.pageNumber,
        annotation.selectedText,
        annotation.color,
        annotation.note,
        annotation.rectsJson,
        annotation.vocabularyId,
        annotation.authorName || 'Reader',
        annotation.createdAt,
        annotation.updatedAt,
        annotation.scope ?? null
      ]
    )
    this.persist()

    const row = this.get<AnnotationRow>('select * from annotations where id = ?', [annotation.id])
    if (!row) {
      throw new Error(`Annotation not found after restore: ${annotation.id}`)
    }

    return toAnnotation(row)
  }

  exportReadingMarkBundle(documentId: string) {
    const document = this.getDocument(documentId)
    const annotations = this.listAnnotations(documentId)
      .filter((annotation) => annotation.authorName !== 'AI' && !annotation.note?.trim().startsWith('AI '))
      .map(({ documentId: _documentId, vocabularyId: _vocabularyId, ...annotation }) => annotation)

    return {
      version: 1 as const,
      exportedAt: now(),
      sourceDocument: {
        title: document.title,
        pageCount: document.pageCount
      },
      annotations
    }
  }

  importReadingMarkBundle(documentId: string, bundle: { annotations?: unknown[] }): number {
    this.getDocument(documentId)

    if (!Array.isArray(bundle.annotations)) {
      throw new Error('Invalid reading mark bundle.')
    }

    let imported = 0

    this.db.run('begin transaction')

    try {
      for (const item of bundle.annotations) {
        if (!item || typeof item !== 'object') {
          continue
        }

        const annotation = item as Partial<AnnotationRecord>
        const type = annotation.type
        const pageNumber = Number(annotation.pageNumber)

        if (!type || !['highlight', 'note', 'bookmark'].includes(type) || !Number.isFinite(pageNumber)) {
          continue
        }

        const requestedId = typeof annotation.id === 'string' && annotation.id ? annotation.id : randomUUID()
        const existing = this.get<{ document_id: string }>(
          'select document_id from annotations where id = ?',
          [requestedId]
        )
        const id = existing && existing.document_id !== documentId ? randomUUID() : requestedId
        const createdAt = typeof annotation.createdAt === 'string' ? annotation.createdAt : now()
        const updatedAt = typeof annotation.updatedAt === 'string' ? annotation.updatedAt : createdAt

        this.db.run(
          `insert into annotations (
              id, document_id, type, page_number, selected_text, color, note, rects_json, vocabulary_id, author_name, created_at, updated_at, scope
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              document_id = excluded.document_id,
              type = excluded.type,
              page_number = excluded.page_number,
              selected_text = excluded.selected_text,
              color = excluded.color,
              note = excluded.note,
              rects_json = excluded.rects_json,
              vocabulary_id = excluded.vocabulary_id,
              author_name = excluded.author_name,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at, scope = excluded.scope`,
          [
            id,
            documentId,
            type,
            Math.max(1, Math.floor(pageNumber)),
            annotation.selectedText ?? null,
            annotation.color ?? null,
            annotation.note ?? null,
            annotation.rectsJson ?? null,
            null,
            annotation.authorName?.trim() || 'Reader',
            createdAt,
            updatedAt,
            annotation.scope ?? null
          ]
        )
        imported += 1
      }

      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    }

    this.persist()
    return imported
  }

  listVocabulary(documentId?: string | null): VocabularyRecord[] {
    const rows = documentId
      ? this.query<VocabularyRow>(
          `select * from vocabulary
           where document_id = ?
           order by created_at desc`,
          [documentId]
        )
      : this.query<VocabularyRow>('select * from vocabulary order by created_at desc')

    return rows.map(toVocabulary)
  }

  createVocabulary(input: CreateVocabularyInput): VocabularyRecord {
    const word = input.word.trim()
    const definition = input.definition.trim()

    if (!word) {
      throw new Error('Vocabulary word cannot be empty.')
    }

    if (!definition) {
      throw new Error('Vocabulary definition cannot be empty.')
    }

    const id = randomUUID()
    const timestamp = now()

    this.db.run(
      `insert into vocabulary (
        id, document_id, annotation_id, word, definition, source_sentence, page_number, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.documentId ?? null,
        input.annotationId ?? null,
        word,
        definition,
        input.sourceSentence ?? null,
        input.pageNumber ?? null,
        timestamp
      ]
    )
    this.persist()

    const row = this.get<VocabularyRow>('select * from vocabulary where id = ?', [id])
    if (!row) {
      throw new Error(`Vocabulary item not found after insert: ${id}`)
    }

    return toVocabulary(row)
  }

  linkVocabularyAnnotation(vocabularyId: string, annotationId: string): VocabularyRecord {
    const vocabulary = this.get<VocabularyRow>('select * from vocabulary where id = ?', [vocabularyId])
    const annotation = this.get<AnnotationRow>('select * from annotations where id = ?', [annotationId])

    if (!vocabulary) {
      throw new Error(`Vocabulary item not found: ${vocabularyId}`)
    }

    if (!annotation) {
      throw new Error(`Annotation not found: ${annotationId}`)
    }

    if (
      vocabulary.document_id &&
      annotation.document_id &&
      vocabulary.document_id !== annotation.document_id
    ) {
      throw new Error('Vocabulary item and annotation belong to different documents.')
    }

    this.db.run('begin transaction')

    try {
      if (vocabulary.annotation_id && vocabulary.annotation_id !== annotationId) {
        this.db.run('update annotations set vocabulary_id = null where id = ?', [
          vocabulary.annotation_id
        ])
      }

      if (annotation.vocabulary_id && annotation.vocabulary_id !== vocabularyId) {
        this.db.run('update vocabulary set annotation_id = null where id = ?', [
          annotation.vocabulary_id
        ])
      }

      this.db.run('update vocabulary set annotation_id = ? where id = ?', [
        annotationId,
        vocabularyId
      ])
      this.db.run('update annotations set vocabulary_id = ? where id = ?', [
        vocabularyId,
        annotationId
      ])
      this.db.run('commit')
      this.persist()
    } catch (error) {
      this.db.run('rollback')
      throw error
    }

    const updated = this.get<VocabularyRow>('select * from vocabulary where id = ?', [vocabularyId])
    if (!updated) {
      throw new Error(`Vocabulary item not found after linking: ${vocabularyId}`)
    }

    return toVocabulary(updated)
  }

  updateVocabularyDefinition(input: UpdateVocabularyDefinitionInput): VocabularyRecord {
    const definition = input.definition.trim()

    if (!definition) {
      throw new Error('Vocabulary definition cannot be empty.')
    }

    this.db.run('update vocabulary set definition = ? where id = ?', [definition, input.id])
    this.persist()

    const row = this.get<VocabularyRow>('select * from vocabulary where id = ?', [input.id])
    if (!row) {
      throw new Error(`Vocabulary item not found: ${input.id}`)
    }

    return toVocabulary(row)
  }

  deleteVocabulary(id: string): void {
    const vocabulary = this.get<VocabularyRow>('select * from vocabulary where id = ?', [id])
    const linkedAnnotationIds = new Set<string>()

    if (vocabulary?.annotation_id) {
      linkedAnnotationIds.add(vocabulary.annotation_id)
    }

    this.query<{ id: string }>('select id from annotations where vocabulary_id = ?', [id]).forEach((row) =>
      linkedAnnotationIds.add(row.id)
    )

    this.db.run('begin transaction')

    try {
      for (const annotationId of linkedAnnotationIds) {
        this.db.run('delete from annotations where id = ?', [annotationId])
      }

      this.db.run('delete from vocabulary where id = ?', [id])
      this.db.run('commit')
      this.persist()
    } catch (error) {
      this.db.run('rollback')
      throw error
    }
  }

  lookupDictionary(query: string): DictionaryEntryRecord | null {
    const normalized = normalizeDictionaryWord(query)

    if (!normalized) {
      return null
    }

    const row = this.get<DictionaryEntryRow>(
      'select * from dictionary_entries where normalized_word = ? limit 1',
      [normalized]
    )

    return row ? toDictionaryEntry(row) : null
  }

  suggestDictionary(query: string, limit = 8): DictionaryEntryRecord[] {
    const normalized = normalizeDictionaryWord(query)

    if (!normalized) {
      return []
    }

    const cappedLimit = Math.min(20, Math.max(1, Math.floor(limit)))
    const pattern = escapeSqlLikePattern(normalized)
    const prefixRows = this.query<DictionaryEntryRow>(
      `select * from dictionary_entries
       where normalized_word like ? escape '\\'
       order by length(normalized_word) asc, normalized_word asc
       limit ?`,
      [`${pattern}%`, cappedLimit]
    )
    const entries = prefixRows.map(toDictionaryEntry)
    const seen = new Set(entries.map((entry) => entry.word.toLocaleLowerCase()))

    if (entries.length >= cappedLimit) {
      return entries
    }

    const containsRows = this.query<DictionaryEntryRow>(
      `select * from dictionary_entries
       where normalized_word like ? escape '\\'
         and normalized_word not like ? escape '\\'
       order by length(normalized_word) asc, normalized_word asc
       limit ?`,
      [`%${pattern}%`, `${pattern}%`, cappedLimit - entries.length]
    )

    for (const entry of containsRows.map(toDictionaryEntry)) {
      const key = entry.word.toLocaleLowerCase()

      if (!seen.has(key)) {
        entries.push(entry)
        seen.add(key)
      }
    }

    return entries
  }

  importDictionaryEntries(entries: DictionaryEntryInput[]): { imported: number; skipped: number } {
    let imported = 0
    let skipped = 0
    const timestamp = now()
    const statement = this.db.prepare(
      `insert into dictionary_entries (
        id, word, normalized_word, phonetic, definition, translation, pos, exchange, source, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(normalized_word) do update set
        word = excluded.word,
        phonetic = excluded.phonetic,
        definition = excluded.definition,
        translation = excluded.translation,
        pos = excluded.pos,
        exchange = excluded.exchange,
        source = excluded.source,
        updated_at = excluded.updated_at`
    )

    this.db.run('begin transaction')

    try {
      for (const entry of entries) {
        const word = entry.word.trim()
        const normalized = normalizeDictionaryWord(word)

        if (!word || !normalized) {
          skipped += 1
          continue
        }

        statement.run([
          randomUUID(),
          word,
          normalized,
          entry.phonetic?.trim() || null,
          entry.definition?.trim() || null,
          entry.translation?.trim() || null,
          entry.pos?.trim() || null,
          entry.exchange?.trim() || null,
          entry.source,
          timestamp
        ])
        imported += 1
      }

      this.db.run('commit')
    } catch (error) {
      this.db.run('rollback')
      throw error
    } finally {
      statement.free()
    }

    this.persist()

    return { imported, skipped }
  }

  listDictionarySources(): DictionarySourceRecord[] {
    const rows = this.query<DictionarySourceRow>(
      'select * from dictionary_sources order by created_at desc'
    )

    return rows.map(toDictionarySource)
  }

  registerDictionarySource(input: {
    type: DictionarySourceRecord['type']
    label: string
    path: string
    entryCount?: number | null
  }): DictionarySourceRecord {
    const existing = this.get<DictionarySourceRow>('select * from dictionary_sources where path = ?', [
      input.path
    ])
    const timestamp = now()

    if (existing) {
      this.db.run(
        `update dictionary_sources
         set type = ?, label = ?, entry_count = ?, created_at = ?
         where id = ?`,
        [input.type, input.label, input.entryCount ?? null, timestamp, existing.id]
      )
      this.persist()

      return toDictionarySource(
        this.get<DictionarySourceRow>('select * from dictionary_sources where id = ?', [existing.id]) ??
          existing
      )
    }

    const id = randomUUID()
    this.db.run(
      `insert into dictionary_sources (
        id, type, label, path, entry_count, created_at
      ) values (?, ?, ?, ?, ?, ?)`,
      [id, input.type, input.label, input.path, input.entryCount ?? null, timestamp]
    )
    this.persist()

    const row = this.get<DictionarySourceRow>('select * from dictionary_sources where id = ?', [id])
    if (!row) {
      throw new Error(`Dictionary source not found after insert: ${id}`)
    }

    return toDictionarySource(row)
  }

  listAIProviders(): AIProviderRecord[] {
    const rows = this.query<AIProviderRow>(
      'select * from ai_providers order by enabled desc, label asc'
    )
    return rows.map(toAIProvider)
  }

  getAIProvider(id: string): AIProviderRecord {
    const row = this.get<AIProviderRow>('select * from ai_providers where id = ?', [id])

    if (!row) {
      throw new Error(`AI provider not found: ${id}`)
    }

    return toAIProvider(row)
  }

  upsertAIProvider(input: UpsertAIProviderInput): AIProviderRecord {
    const timestamp = now()

    this.db.run(
      `insert into ai_providers (
          id, label, base_url, default_model, api_key_ref,
          supports_thinking, supports_long_context, enabled, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          label = excluded.label,
          base_url = excluded.base_url,
          default_model = excluded.default_model,
          api_key_ref = excluded.api_key_ref,
          supports_thinking = excluded.supports_thinking,
          supports_long_context = excluded.supports_long_context,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at`,
      [
        input.id,
        input.label,
        input.baseUrl,
        input.defaultModel,
        input.apiKeyRef ?? null,
        input.supportsThinking ? 1 : 0,
        input.supportsLongContext ? 1 : 0,
        input.enabled === false ? 0 : 1,
        timestamp
      ]
    )
    this.persist()

    const row = this.get<AIProviderRow>('select * from ai_providers where id = ?', [input.id])
    if (!row) {
      throw new Error(`AI provider not found after upsert: ${input.id}`)
    }
    return toAIProvider(row)
  }

  setAIProviderKeyRef(providerId: string, apiKeyRef: string | null): AIProviderRecord {
    const provider = this.getAIProvider(providerId)

    return this.upsertAIProvider({
      id: provider.id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      defaultModel: provider.defaultModel,
      apiKeyRef,
      supportsThinking: provider.supportsThinking,
      supportsLongContext: provider.supportsLongContext,
      enabled: provider.enabled
    })
  }

  createAIArtifact(input: {
    documentId: string
    annotationId?: string | null
    providerId: string
    model: string
    promptType: AIPromptType
    inputText: string
    outputMarkdown: string
    pageNumber?: number | null
  }): AIArtifactRecord {
    const id = randomUUID()
    const timestamp = now()

    this.db.run(
      `insert into ai_artifacts (
        id, document_id, annotation_id, provider_id, model, prompt_type,
        input_text, output_markdown, page_number, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.documentId,
        input.annotationId ?? null,
        input.providerId,
        input.model,
        input.promptType,
        input.inputText,
        input.outputMarkdown,
        input.pageNumber ?? null,
        timestamp
      ]
    )
    this.persist()

    const row = this.get<AIArtifactRow>('select * from ai_artifacts where id = ?', [id])
    if (!row) {
      throw new Error(`AI artifact not found after insert: ${id}`)
    }

    return toAIArtifact(row)
  }

  listAIConversations(documentId: string): AIConversationRecord[] {
    this.getDocument(documentId)
    const rows = this.query<AIConversationRow>(
      `select * from ai_conversations
       where document_id = ?
       order by updated_at desc`,
      [documentId]
    )

    return rows.map(toAIConversation)
  }

  createAIConversation(input: { documentId: string; title?: string | null }): AIConversationRecord {
    this.getDocument(input.documentId)
    const id = randomUUID()
    const timestamp = now()
    const title = input.title?.trim() || '共读对话'

    this.db.run(
      `insert into ai_conversations (
        id, document_id, title, created_at, updated_at
      ) values (?, ?, ?, ?, ?)`,
      [id, input.documentId, title, timestamp, timestamp]
    )
    this.persist()

    const row = this.get<AIConversationRow>('select * from ai_conversations where id = ?', [id])
    if (!row) {
      throw new Error(`AI conversation not found after insert: ${id}`)
    }

    return toAIConversation(row)
  }

  updateAIConversationTitle(input: UpdateAIConversationTitleInput): AIConversationRecord {
    const title = input.title.trim()

    if (!title) {
      throw new Error('AI conversation title cannot be empty.')
    }

    const timestamp = now()
    this.db.run('update ai_conversations set title = ?, updated_at = ? where id = ?', [
      title,
      timestamp,
      input.id
    ])
    this.persist()

    const row = this.get<AIConversationRow>('select * from ai_conversations where id = ?', [input.id])
    if (!row) {
      throw new Error(`AI conversation not found: ${input.id}`)
    }

    return toAIConversation(row)
  }

  getAIConversation(id: string): AIConversationRecord {
    const row = this.get<AIConversationRow>('select * from ai_conversations where id = ?', [id])

    if (!row) {
      throw new Error(`AI conversation not found: ${id}`)
    }

    return toAIConversation(row)
  }

  listAIChatMessages(conversationId: string): AIChatMessageRecord[] {
    this.getAIConversation(conversationId)
    const rows = this.query<AIChatMessageRow>(
      `select * from ai_chat_messages
       where conversation_id = ?
       order by created_at asc`,
      [conversationId]
    )

    return rows.map(toAIChatMessage)
  }

  getRecentAIChatMessages(conversationId: string, limit = 10): AIChatMessageRecord[] {
    this.getAIConversation(conversationId)
    const rows = this.query<AIChatMessageRow>(
      `select * from (
         select * from ai_chat_messages
         where conversation_id = ?
         order by created_at desc
         limit ?
       )
       order by created_at asc`,
      [conversationId, limit]
    )

    return rows.map(toAIChatMessage)
  }

  createAIChatMessage(input: {
    conversationId: string
    role: AIChatMessageRole
    content: string
    selectedText?: string | null
    pageNumber?: number | null
    providerId?: string | null
    model?: string | null
    artifactId?: string | null
  }): AIChatMessageRecord {
    const conversation = this.getAIConversation(input.conversationId)
    const content = input.content.trim()

    if (!content) {
      throw new Error('AI chat message cannot be empty.')
    }

    const id = randomUUID()
    const timestamp = now()

    this.db.run(
      `insert into ai_chat_messages (
        id, conversation_id, role, content, selected_text, page_number,
        provider_id, model, artifact_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.conversationId,
        input.role,
        content,
        input.selectedText ?? null,
        input.pageNumber ?? null,
        input.providerId ?? null,
        input.model ?? null,
        input.artifactId ?? null,
        timestamp
      ]
    )
    this.db.run('update ai_conversations set updated_at = ? where id = ?', [
      timestamp,
      conversation.id
    ])
    this.persist()

    const row = this.get<AIChatMessageRow>('select * from ai_chat_messages where id = ?', [id])
    if (!row) {
      throw new Error(`AI chat message not found after insert: ${id}`)
    }

    return toAIChatMessage(row)
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists library_board (id integer primary key, revision integer not null, contents text not null);
      create table if not exists documents (
        id text primary key,
        title text not null,
        file_path text not null unique,
        file_size integer not null,
        page_count integer,
        last_page_number integer not null default 1,
        created_at text not null,
        last_opened_at text not null
      );

      create table if not exists board_turns (
        id integer primary key autoincrement, scope text not null, question text not null, answer text not null
      );
      create index if not exists idx_board_turns_scope on board_turns(scope,id);
      create table if not exists board_book_overviews (
        document_id text primary key references documents(id) on delete cascade, title text not null, overview text not null
      );
      create table if not exists annotations (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        type text not null check(type in ('highlight', 'note', 'bookmark')),
        page_number integer not null,
        selected_text text,
        color text,
        note text,
        rects_json text,
        vocabulary_id text,
        author_name text not null default 'Reader',
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_annotations_document_page
        on annotations(document_id, page_number);

      create table if not exists document_pages (
        document_id text not null references documents(id) on delete cascade,
        page_number integer not null,
        text text not null,
        char_count integer not null,
        indexed_at text not null,
        ocr_layout_json text,
        primary key(document_id, page_number)
      );

      create index if not exists idx_document_pages_document
        on document_pages(document_id, page_number);

      create table if not exists document_chunks (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        page_number integer not null,
        chunk_index integer not null,
        text text not null,
        char_count integer not null,
        indexed_at text not null
      );

      create index if not exists idx_document_chunks_document_page
        on document_chunks(document_id, page_number, chunk_index);

      create table if not exists ai_providers (
        id text primary key,
        label text not null,
        base_url text not null,
        default_model text not null,
        api_key_ref text,
        supports_thinking integer not null default 0,
        supports_long_context integer not null default 0,
        enabled integer not null default 1,
        updated_at text not null
      );

      create table if not exists ai_artifacts (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        annotation_id text references annotations(id) on delete set null,
        provider_id text not null,
        model text not null,
        prompt_type text not null,
        input_text text not null,
        output_markdown text not null,
        page_number integer,
        created_at text not null
      );

      create table if not exists ai_conversations (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        title text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_ai_conversations_document_updated
        on ai_conversations(document_id, updated_at);

      create table if not exists ai_chat_messages (
        id text primary key,
        conversation_id text not null references ai_conversations(id) on delete cascade,
        role text not null check(role in ('user', 'assistant')),
        content text not null,
        selected_text text,
        page_number integer,
        provider_id text,
        model text,
        artifact_id text references ai_artifacts(id) on delete set null,
        created_at text not null
      );

      create index if not exists idx_ai_chat_messages_conversation_created
        on ai_chat_messages(conversation_id, created_at);

      create table if not exists vocabulary (
        id text primary key,
        document_id text references documents(id) on delete set null,
        annotation_id text,
        word text not null,
        definition text not null,
        source_sentence text,
        page_number integer,
        created_at text not null
      );

      create index if not exists idx_vocabulary_document_created
        on vocabulary(document_id, created_at);

      create table if not exists dictionary_entries (
        id text primary key,
        word text not null,
        normalized_word text not null unique,
        phonetic text,
        definition text,
        translation text,
        pos text,
        exchange text,
        source text not null,
        updated_at text not null
      );

      create index if not exists idx_dictionary_entries_word
        on dictionary_entries(normalized_word);

      create table if not exists dictionary_sources (
        id text primary key,
        type text not null check(type in ('csv', 'stardict')),
        label text not null,
        path text not null unique,
        entry_count integer,
        created_at text not null
      );
    `)

    this.db.run(`create table if not exists reading_visits (document_id text not null, page_number integer not null, primary key(document_id,page_number))`)
    this.ensureColumn('board_turns', 'conversation_id', "text not null default 'legacy'")
    this.db.exec(`create table if not exists board_conversations (
      scope text not null, id text not null, title text not null, updated_at text not null, primary key(scope,id));
      create index if not exists idx_board_turns_thread on board_turns(scope,conversation_id,id);
      insert or ignore into board_conversations(scope,id,title,updated_at)
        select scope,'legacy','此前的共读对话',strftime('%Y-%m-%dT%H:%M:%fZ','now') from board_turns
        where conversation_id='legacy' group by scope;`)
    this.ensureColumn('annotations', 'scope', 'text')
    this.ensureColumn('annotations', 'author_name', "text not null default 'Reader'")
    this.ensureColumn('annotations', 'vocabulary_id', 'text')
    this.ensureColumn('documents', 'last_page_number', 'integer not null default 1')
    this.ensureColumn('document_pages', 'ocr_layout_json', 'text')
    this.ensureColumn('vocabulary', 'annotation_id', 'text')
    this.db.run('create index if not exists idx_annotations_vocabulary on annotations(vocabulary_id)')
    this.db.run('create index if not exists idx_vocabulary_annotation on vocabulary(annotation_id)')
    this.persist()
  }

  private seedProviders(): void {
    const count = this.get<{ count: number }>('select count(*) as count from ai_providers')

    const localProvider: UpsertAIProviderInput = {
      id: 'local-hub',
      label: '本地 LLM Hub',
      baseUrl: 'http://127.0.0.1:18080/v1',
      defaultModel: 'qwen-local',
      supportsThinking: true,
      supportsLongContext: true
    }

    if (count && count.count > 0) {
      if (!this.get<AIProviderRow>('select id from ai_providers where id = ?', [localProvider.id])) {
        this.upsertAIProvider(localProvider)
      }
      return
    }

    const providers: UpsertAIProviderInput[] = [
      localProvider,
      {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-flash',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'qwen',
        label: 'Alibaba Bailian / Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen3.5-flash',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'kimi',
        label: 'Kimi / Moonshot',
        baseUrl: 'https://api.moonshot.ai/v1',
        defaultModel: 'kimi-k2-0905-preview',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'zhipu',
        label: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4.5-flash',
        supportsThinking: true,
        supportsLongContext: false
      }
    ]

    for (const provider of providers) {
      this.upsertAIProvider(provider)
    }
  }

  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }

    while (this.dirty || this.writeInProgress) {
      if (this.writeInProgress) {
        await this.writeInProgress
        continue
      }

      await this.writeSnapshot()
    }
  }

  private persist(): void {
    this.dirty = true

    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null

      void this.writeSnapshot().catch((error) => {
        console.error('Failed to persist Reading Partner database', error)
      })
    }, 250)

    this.persistTimer.unref?.()
  }

  private async writeSnapshot(): Promise<void> {
    while (this.dirty || this.writeInProgress) {
      if (this.writeInProgress) {
        await this.writeInProgress
        continue
      }

      const snapshot = this.db.export()
      this.dirty = false
      const tempPath = `${this.databasePath}.${process.pid}.tmp`
      this.writeInProgress = (async () => {
        await writeFile(tempPath, snapshot)
        await rename(tempPath, this.databasePath)
      })()

      try {
        await this.writeInProgress
      } catch (error) {
        this.dirty = true
        throw error
      } finally {
        this.writeInProgress = null
      }
    }
  }

  private get<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.query<T>(sql, params)[0]
  }

  private query<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql, params)
    const rows: T[] = []

    try {
      while (statement.step()) {
        rows.push(statement.getAsObject() as T)
      }
    } finally {
      statement.free()
    }

    return rows
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.query<{ name: string }>(`pragma table_info(${tableName})`)

    if (!columns.some((column) => column.name === columnName)) {
      this.db.run(`alter table ${tableName} add column ${columnName} ${definition}`)
    }
  }
}
