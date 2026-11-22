import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { BookConnection, DocumentRecord, LibraryBoardState, ShelfAnswer, ShelfGroup, ShelfTag, TagPlacement } from '../shared/types'
import type { ReadingPartnerDatabase } from './database'
import type { AIChatToolDefinition, ChatToolCall } from './ai'

function tool(name: string, description: string, properties: Record<string, object>, required: string[]): AIChatToolDefinition {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }
}
const id = { type: 'string' }
const ids = { type: 'array', items: id, uniqueItems: true }
export const readBookTool = tool('read_book', '仅在需要原文证据时读取组内一本书。可指定一个 PDF 页码，或用书籍原语言的简短关键词搜索。两者都省略时只抽样。',
  { documentId: id, page: { type: 'integer', minimum: 1 }, query: { type: 'string', maxLength: 160 } }, ['documentId'])
export const createTagTool = tool('create_board_tag', '钉一条值得保留的阅读问题、比较线索或批注。可关联组内书籍和已有标签。',
  { text: { type: 'string', maxLength: 800 }, books: ids, relatedTagIds: ids }, ['text', 'books', 'relatedTagIds'])
export const connectTool = tool('connect_books', '在组内两本书之间创建连线并写简述。',
  { from: id, to: id, summary: { type: 'string', maxLength: 800 } }, ['from', 'to', 'summary'])

type Excerpt = { pageNumber: number; text: string }
async function readPdf(book: DocumentRecord, page?: number): Promise<Excerpt[]> {
  const { getDocument } = await import('pdfjs-dist')
  const task = getDocument({ url: pathToFileURL(book.filePath).href, useSystemFonts: true, isEvalSupported: false })
  try {
    const pdf = await task.promise
    const count = Math.min(5, pdf.numPages)
    const pages = page ? [page] : Array.from({ length: count }, (_, i) => 1 + Math.round(i * (pdf.numPages - 1) / Math.max(1, count - 1)))
    const excerpts: Excerpt[] = []
    for (const pageNumber of pages) {
      if (pageNumber > pdf.numPages) continue
      const current = await pdf.getPage(pageNumber)
      const content = await current.getTextContent()
      const text = content.items.map(item => 'str' in item ? item.str : '').join(' ').trim()
      if (text) excerpts.push({ pageNumber, text: text.slice(0, page ? 2200 : 900) })
      current.cleanup()
    }
    return excerpts
  } finally { await task.destroy() }
}

export function boardScope(board: LibraryBoardState, groupId: string | null): ShelfGroup | LibraryBoardState {
  if (groupId === null) return board
  const group = board.groups.find(g => g.id === groupId)
  if (!group) throw new Error('分组已删除，请重新打开书库。')
  return group
}

function textArg(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 800) throw new Error('请输入 1 至 800 字的内容')
  return value.trim()
}
function references(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error('关联对象必须在线索板内')
  return [...new Set<string>(value)]
}

// Stage writes until the model has answered. A failed request leaves neither a partial turn nor orphan tags.
export function boardActions(database: ReadingPartnerDatabase, groupId: string | null, books: DocumentRecord[], mode?: 'tag' | 'connect', placement?: TagPlacement) {
  const byId = new Map(books.map(book => [book.id, book]))
  const selected = references(placement?.selectedBookIds ?? [], new Set(byId.keys()))
  const sources = new Map<string, ShelfAnswer['sources'][number]>()
  const connections: BookConnection[] = []
  let tag: ShelfTag | undefined
  let reads = 0

  function liveScope() {
    const board = database.getBoard()
    const scope = boardScope(board, groupId)
    const members = 'books' in scope ? scope.books : database.listDocuments().map(book => book.id)
    return { board, scope, members: new Set(members.filter(id => byId.has(id))) }
  }

  async function run(call: ChatToolCall) {
    const args = JSON.parse(call.arguments)
    const { scope, members } = liveScope()
    if (call.name === 'read_book') {
      if (++reads > 8) throw new Error('已达本轮查书上限，请根据已有资料回答')
      const book = byId.get(args.documentId)
      if (!book || !members.has(book.id)) throw new Error('请选择当前组内的书籍')
      const { page, query } = args
      if (page != null && (!Number.isSafeInteger(page) || page < 1)) throw new Error('PDF 页码无效')
      if (query != null && (typeof query !== 'string' || query.length > 160)) throw new Error('关键词无效')
      let excerpts: Excerpt[]
      let method: string
      if (page) {
        method = '指定 PDF 页'
        const text = database.getBoardPageText(book.id, page)
        excerpts = text ? [{ pageNumber: page, text }] : await readPdf(book, page)
      } else if (query?.trim()) {
        method = '关键词检索'
        excerpts = database.searchDocumentText(book.id, query.trim(), 4).map(hit => ({ pageNumber: hit.pageNumber, text: hit.text.slice(0, 1200) }))
        if (!excerpts.length && !database.getDocumentTextIndexStatus(book.id).chunksIndexed) {
          method = '尚无索引，在少量抽样页中匹配关键词'
          excerpts = (await readPdf(book)).filter(part => part.text.toLowerCase().includes(query.trim().toLowerCase()))
        }
      } else {
        method = '跨页抽样'
        excerpts = database.sampleBoardPages(book.id)
        if (!excerpts.length) excerpts = await readPdf(book)
      }
      if (!excerpts.length) return { ok: false, method, message: '没有取到匹配正文。可换用原语言关键词、指定页码，扫描件可能需要 OCR。' }
      const entry = sources.get(book.id) ?? { documentId: book.id, title: book.title, pages: [] }
      entry.pages = [...new Set([...entry.pages, ...excerpts.map(part => part.pageNumber)])].sort((a,b) => a-b)
      sources.set(book.id, entry)
      return { ok: true, method, documentId: book.id, title: book.title, excerpts }
    }
    if (call.name === 'create_board_tag' && mode !== 'connect') {
      if (tag) throw new Error('本轮已有一条标签，请直接回复')
      const text = textArg(args.text)
      if (scope.tags?.some(item => item.text === text)) throw new Error('相同内容的标签已经存在')
      const links = references(selected.length ? selected : args.books, members)
      const relatedTagIds = references(args.relatedTagIds ?? [], new Set(scope.tags?.map(t => t.id)))
      tag = { id: randomUUID(), author: 'ai', text, books: links, relatedTagIds,
        ...(placement?.position ? { position: placement.position } : {}), ...(placement?.color ? { color: placement.color } : {}) }
      return { ok: true, id: tag.id }
    }
    if (call.name === 'connect_books' && mode !== 'tag') {
      const { from, to } = args
      if (connections.length >= 2 || from === to || !members.has(from) || !members.has(to)) throw new Error('请连接组内不同的两本书，每轮至多两条')
      if (mode === 'connect' && (!sources.has(from) || !sources.has(to))) throw new Error('请先查阅这两本书，再给出有原文依据的连线')
      if ([...scope.connections ?? [], ...connections].some(link => (link.from === from && link.to === to) || (link.from === to && link.to === from))) throw new Error('这两本书已有连线')
      const link: BookConnection = { id: randomUUID(), author: 'ai', from, to, summary: textArg(args.summary) }
      connections.push(link)
      return { ok: true, id: link.id }
    }
    throw new Error('此操作不可用')
  }

  function finish(question: string, text: string, conversationId?: string | null, title?: string): ShelfAnswer {
    const { board, scope, members } = liveScope()
    references([...sources.keys(), ...tag?.books ?? [], ...connections.flatMap(c => [c.from, c.to])], members)
    if (tag && scope.tags?.some(item => item.text === tag!.text)) throw new Error('该标签已在另一台设备上创建，请重试')
    const patch = { tags: [...scope.tags ?? [], ...tag ? [tag] : []], connections: [...scope.connections ?? [], ...connections] }
    const next = tag || connections.length ? groupId === null ? { ...board, ...patch } : {
      ...board, groups: board.groups.map(group => group.id === groupId ? { ...group, ...patch } : group)
    } : undefined
    const answer: ShelfAnswer = { text, sources: [...sources.values()], ...(tag ? { savedTagId: tag.id } : {}),
      ...(connections.length ? { savedConnectionIds: connections.map(link => link.id) } : {}) }
    database.finishBoardTurn(groupId, question, answer, next, conversationId, title)
    return answer
  }
  return { run, finish }
}
