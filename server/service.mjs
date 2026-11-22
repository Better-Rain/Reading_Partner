import { createServer } from 'node:https'
import { readFile, link, rename, unlink, stat } from 'node:fs/promises'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { join, resolve, sep, basename, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { bookCover } from './covers.mjs'
import { openLibrary } from './library.mjs'
import { parseDictionaryCsv } from '../src/main/dictionaryImport.ts'

const compress = promisify(gzip)
const largeReadChannels = new Set(['annotations:list', 'vocabulary:list', 'ai:chatMessages'])
const root = process.env.RP_ROOT
const port = Number(process.env.RP_PORT || (typeof RP_BUILD_PORT === 'number' ? RP_BUILD_PORT : 8443))
const data = process.env.RP_DATA
const www = join(root, 'service/web')
const library = await openLibrary(data)
const json = (res, value) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(value))
}
const fail = (status, message) => Object.assign(new Error(message), { status })
const devices = () =>
  JSON.parse(readFileSync(join(data, 'devices.json'), 'utf8'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const media = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}
async function body(req, max) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > max) throw fail(413, '文件过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function importPdf(req, name) {
  const books = join(data, 'books'),
    temp = join(books, randomUUID() + '.part')
  const digest = createHash('sha256')
  let size = 0,
    head = Buffer.alloc(0)
  try {
    await pipeline(
      req,
      new Transform({
        transform(chunk, _, cb) {
          size += chunk.length
          if (size > 1024 ** 3) return cb(fail(413, 'PDF 上限为 1 GiB'))
          if (head.length < 1024)
            head = Buffer.concat([head, chunk.subarray(0, 1024 - head.length)])
          digest.update(chunk)
          cb(null, chunk)
        },
      }),
      createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
    )
    if (!head.includes('%PDF-')) throw fail(400, '请选择有效 PDF')
    const sha = digest.digest('hex')
    const existing = library.byHash(sha)
    if (existing) return existing.id
    const title =
      basename(name)
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .slice(0, 150) || 'Book.pdf'
    const missing = library.missing(title, size)
    if (missing && !(await stat(missing.filePath).catch(() => null))) {
      try {
        await link(temp, missing.filePath)
        library.repair(missing.id, sha)
        return missing.id
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const restored = library.byHash(sha)
        if (restored) return restored.id
      }
    }
    const dest = join(books, sha + '.pdf')
    await rename(temp, dest)
    return library.publish(title, dest, size, sha)
  } finally {
    await unlink(temp).catch(() => {})
  }
}
const tls = {
  cert: await readFile(join(root, 'tls/server.pem')),
  key: await readFile(join(root, 'tls/server.key')),
  minVersion: 'TLSv1.2',
}
async function handle(req, res) {
  const url = new URL(req.url, 'https://localhost'),
    path = url.pathname
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cache-Control', 'no-store')
  if (
    req.method === 'POST' &&
    req.headers.origin &&
    req.headers.origin !== `https://${req.headers.host}`
  )
    throw fail(403, '来源无效')
  if (path === '/health') return json(res, { ok: true })
  if (req.method === 'POST' && path === '/pair') {
    const token = (await body(req, 256)).toString().trim()
    if (!Object.values(devices()).includes(hash(token)))
      throw fail(401, '配对码无效')
    res.setHeader(
      'Set-Cookie',
      `__Host-rp=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
    )
    return json(res, true)
  }
  const cookie = req.headers.cookie?.match(
    /(?:^|; )__Host-rp=([a-f0-9]{64})(?:;|$)/,
  )?.[1]
  if (!cookie || !Object.values(devices()).includes(hash(cookie)))
    throw fail(401, '请在已配对的 Reading Partner 客户端打开')
  const device = hash(cookie)
  const current = library.auth.user(req, device)
  if (
    req.method === 'GET' &&
    (path === '/account' || path === '/auth/register')
  )
    return library.auth.form(res, path, current)
  if (req.method === 'POST' && path.startsWith('/auth/')) {
    if (req.headers.origin !== `https://${req.headers.host}`)
      throw fail(403, '来源无效')
    return library.auth.post(
      res,
      path,
      new URLSearchParams((await body(req, 2048)).toString()),
      device,
      current,
    )
  }
  const entry = path === '/' || path === '/index.html'
  if (!current) {
    if (entry && req.method === 'GET')
      return library.auth.form(res, '/account', null)
    throw fail(403, '请重新登录阅读账号')
  }
  if (req.method === 'GET' && path.startsWith('/cover/')) {
    const doc = library.byId(path.slice(7))
    if (!doc) throw fail(404, '书目不存在')
    const bytes = await bookCover(data, doc)
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    return res.end(bytes)
  }
  const sessionTag = hash(current.token)
  if (req.method === 'GET' && entry) {
    const html = await readFile(join(www, 'index.html'), 'utf8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(
      html.replace(
        '<head>',
        `<head><meta name="rp-session" content="${sessionTag}"><meta name="rp-user" content="${current.name}">`,
      ),
    )
  }
  const api =
    path === '/books' || path.startsWith('/rpc/') || path.startsWith('/pdf/')
  if (api && req.headers['x-rp-session'] !== sessionTag)
    throw fail(409, '账号已切换，请重新打开书库')
  if (req.method === 'POST' && path === '/books') {
    const id = await importPdf(req, url.searchParams.get('name') || 'Book.pdf')
    const { db } = await library.profile(current.id)
    await db.flush()
    return json(res, db.getDocument(id))
  }
  if (req.method === 'GET' && path.startsWith('/pdf/')) {
    const doc = library.byId(path.slice(5))
    if (!doc) throw fail(404, '书目不存在')
    const info = await stat(doc.filePath).catch(() => {
      throw fail(404, '找不到这份 PDF，请重新导入原文件')
    })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Accept-Ranges', 'bytes')
    const range = req.headers.range
    if (range === undefined) {
      res.setHeader('Content-Length', info.size)
      return pipeline(createReadStream(doc.filePath), res)
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = match?.[1] ? Number(match[1]) : Math.max(0, info.size - Number(match?.[2]))
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
      return res.end()
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
      'Content-Length': end - start + 1,
    })
    return pipeline(createReadStream(doc.filePath, { start, end }), res)
  }
  if (req.method === 'POST' && path.startsWith('/rpc/')) {
    const channel = path.slice(5),
      args = JSON.parse((await body(req, 32 * 1024 ** 2)).toString())
    if (!Array.isArray(args)) throw fail(400, '参数无效')
    if (
      channel === 'documents:ocrPageText' &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        args[0]?.imageDataUrl ?? '',
      )
    )
      throw fail(400, 'OCR 需要页面截图')
    const { db, handlers } = await library.profile(current.id)
    const handler = handlers.get(channel)
    if (channel === 'marks:export')
      return json(res, db.exportReadingMarkBundle(args[0]))
    if (channel === 'marks:import') {
      const count = db.importReadingMarkBundle(args[0], args[1])
      await db.flush()
      return json(res, count)
    }
    if (channel === 'dictionary:csv') {
      const result = db.importDictionaryEntries(
        parseDictionaryCsv(args[0], basename(args[1])),
      )
      await db.flush()
      return json(res, result)
    }
    if (!handler || /Dialog$|^window:|^documents:readPdf$/.test(channel))
      throw fail(404, '未知操作')
    res.setHeader('Content-Type', 'application/x-ndjson')
    if (largeReadChannels.has(channel)) {
      const value = await handler({}, ...args)
      const payload = JSON.stringify({ done: true, value }) + '\n'
      res.setHeader('Vary', 'Accept-Encoding')
      if (payload.length >= 4096 && /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers['accept-encoding'] || '')) {
        res.setHeader('Content-Encoding', 'gzip')
        return res.end(await compress(payload, { level: 1 }))
      }
      return res.end(payload)
    }
    res.flushHeaders()
    const frame = (data) => {
      if (!res.destroyed) res.write(JSON.stringify(data) + '\n')
    }
    try {
      const value = await handler(
        { sender: { send: (name, event) => frame({ name, event }) } },
        ...args,
      )
      await db.flush()
      frame({ done: true, value: value ?? null })
    } catch (e) {
      frame({ error: e.message })
    }
    return res.end()
  }
  if (req.method !== 'GET') throw fail(405, '方法无效')
  const file = resolve(
    www,
    '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)),
  )
  if (!file.startsWith(www + sep)) throw fail(404, '页面不存在')
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw fail(404, '页面不存在')
  res.setHeader(
    'Content-Type',
    media[extname(file)] || 'application/octet-stream',
  )
  return pipeline(createReadStream(file), res)
}
for (const host of process.env.RP_BINDS.split(',')) {
  const srv = createServer(tls, (req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent || res.destroyed) return res.end()
      res.statusCode = e.status || 400
      json(res, { error: e.message })
    })
  })
  srv.on('error', (e) => {
    if (e.code === 'EADDRNOTAVAIL')
      setTimeout(() => srv.listen(port, host), 15000)
    else console.error(host, e.message)
  })
  srv.listen(port, host)
}
process.on('SIGTERM', async () => {
  await library.close()
  process.exit(0)
})
