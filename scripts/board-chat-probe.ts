import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import initSqlJs from 'sql.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadingPartnerDatabase } from '../src/main/database'
import { askLibraryBoard } from '../src/main/libraryBoard'

// Run via esbuild (platform=node, format=esm, packages=external). Capture the actual model request bodies.
const dir = await mkdtemp(join(tmpdir(), 'reading-partner-board-'))
const dbFile = join(dir, 'test.sqlite')
const db = await ReadingPartnerDatabase.open(dbFile)
const provider = { ...db.listAIProviders()[0]!, baseUrl: 'http://local.test/v1', enabled: true }
const originalFetch = globalThis.fetch
const marker = 'EXCERPT_ONLY_AVAILABLE_THROUGH_READ_BOOK'
let step: (body: any) => any = () => { throw Error('Unexpected request') }
globalThis.fetch = async (_url, init) => new Response(JSON.stringify({ choices: [{ message: step(JSON.parse(String(init?.body))) }] }), { headers: { 'content-type': 'application/json' } })
function call(name: string, args: object) {
  return { tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
try {
  for (const id of ['a','b','outside']) db.addSharedDocument({ id, title: `${id}.pdf`, filePath: join(dir,`${id}.pdf`), fileSize: 1, createdAt: new Date().toISOString(), pageCount: 8 })
  db.replaceDocumentTextIndex({ documentId: 'b', pageCount: 8, pages: [{ pageNumber: 7, text: marker }], chunks: [{ pageNumber: 7, chunkIndex: 0, text: marker }] })
  db.saveBoard({ ...db.getBoard(), groups: [{ id: 'media', name: '美国社会', books: ['a','b'], tags: [{ id: 'goal', author: 'user', text: '了解美国传媒', books: ['a'] }] }] })
  let requests = 0
  step = body => {
    const wire = JSON.stringify(body.messages)
    assert.ok(!wire.includes(marker) && !wire.includes('outside.pdf'))
    if (++requests === 1) return { content: JSON.stringify(['a','b'].map(id => ({ id, overview: '尚待核实的书目介绍' }))) }
    assert.match(wire, /尚待核实的书目介绍/); assert.match(wire, /了解美国传媒/)
    return { content: '先列出采访问题。' }
  }
  const ask = (q: string) => askLibraryBoard(db, provider, '', 'media', q)
  assert.deepEqual((await ask('我从哪开始？')).sources, []); assert.equal(requests, 2)
  requests = 0
  step = body => {
    const wire = JSON.stringify(body.messages)
    assert.match(wire, /先列出采访问题/)
    const last = body.messages.at(-1)
    switch (++requests) {
      case 1: assert.ok(!wire.includes(marker)); return call('read_book', { documentId: 'outside', page: 7 })
      case 2: assert.equal(JSON.parse(last.content).ok, false); assert.ok(!wire.includes(marker)); return call('read_book', { documentId: 'b', page: 7 })
      case 3: assert.match(last.content, new RegExp(marker)); return call('create_board_tag', { text: '采访问题清单', books: ['a','b'], relatedTagIds: ['goal'] })
      case 4: assert.equal(JSON.parse(last.content).ok, true); return call('connect_books', { from: 'a', to: 'b', summary: '两种提问角度' })
      default: assert.equal(JSON.parse(last.content).ok, true); return { content: '已整理好。' }
    }
  }
  const answer = await ask('他们在第七页怎么讨论？请记录下来')
  assert.deepEqual(answer.sources.map(s => [s.documentId,s.pages]), [['b',[7]]]); assert.ok(answer.savedTagId); assert.equal(answer.savedConnectionIds?.length,1)
  assert.deepEqual(db.getBoard().groups[0]!.tags![0]!.relatedTagIds, [answer.savedTagId]); assert.equal(db.getBoardHistory(null).length,0)
  requests = 0
  step = () => { if (++requests === 1) return call('create_board_tag', { text:'应回滚',books:[],relatedTagIds:[] }); throw Error('fixture model failure') }
  await assert.rejects(ask('失败回滚'), /fixture model failure/)
  assert.equal(db.getBoard().groups[0]!.tags!.length, 2); assert.equal(db.getBoardHistory('media').length, 2)
  const topicAsk = (conversationId: string | null, question: string, title?: string) =>
    askLibraryBoard(db, provider, '', 'media', question, undefined, undefined, { requestId: crypto.randomUUID(), conversationId, title })
  step = body => {
    const messages = JSON.stringify(body.messages)
    assert.ok(!messages.includes('先列出采访问题。') && !messages.includes('私人话题 A'))
    return {content: '私人话题 A'}
  }
  await topicAsk('first','第一问','新闻调查')
  step = body => {
    assert.match(JSON.stringify(body.messages), /私人话题 A/)
    return {content: '只属于这个话题的续答'}
  }
  await topicAsk('first','继续')
  step = body => {
    assert.doesNotMatch(JSON.stringify(body.messages), /只属于这个话题的续答|私人话题 A|第一问/)
    return {content: '独立的回答'}
  }
  await topicAsk('second','另一个话题'); await topicAsk(null,'临时一问')
  db.renameBoardConversation('media','first','新闻框架'); assert.throws(() => db.renameBoardConversation(null,'first','错组'))
  assert.equal(db.listBoardConversations('media').length,3); assert.equal(db.getBoardHistory('media', undefined, 30, 'first').length,2)
  const ctl = new AbortController()
  step = () => { ctl.abort(); return {content: '取消后的结果不能保存'} }
  await assert.rejects(askLibraryBoard(db,provider,'','media','测试停止',undefined,undefined,{requestId:crypto.randomUUID(),conversationId:'unsaved'},ctl.signal))
  assert.equal(db.listBoardConversations('media').length,3)
  // Open a database with the actual pre-topic table shape and no topic metadata.
  const oldFile = join(dir,'old.sqlite'), SQL = await initSqlJs(), old = new SQL.Database()
  old.exec('create table board_turns(id integer primary key autoincrement, scope text not null, question text not null, answer text not null)')
  old.run('insert into board_turns(scope,question,answer) values (?,?,?)',['g','旧问题', JSON.stringify({text:'旧回答',sources:[]})])
  await writeFile(oldFile, old.export()); old.close()
  const migrated = await ReadingPartnerDatabase.open(oldFile)
  assert.equal(migrated.listBoardConversations('g')[0]?.title,'此前的共读对话')
  assert.equal(migrated.getBoardHistory('g',undefined,30,'legacy')[0]?.result.text,'旧回答'); await migrated.flush()
  await db.flush(); const reopened = await ReadingPartnerDatabase.open(dbFile)
  assert.equal(reopened.getBoardHistory('media').length,2); reopened.saveBoard({ ...reopened.getBoard(),groups:[] }); assert.deepEqual(reopened.getBoardHistory('media'),[]); await reopened.flush()
  console.log('PASS: cold/warm request payloads, group isolation, scoped retrieval, verified pages, staged writes, restart history and delete cleanup')
} finally { globalThis.fetch = originalFetch; await db.flush(); await rm(dir, { recursive:true,force:true }) }
