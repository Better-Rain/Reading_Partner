import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { openReadingService } from '../src/main/index.ts'
import { accounts } from './accounts.mjs'

export async function openLibrary(data) {
  const sql = new DatabaseSync(join(data, 'library.sqlite'))
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,filePath TEXT NOT NULL UNIQUE,fileSize INTEGER NOT NULL,pageCount INTEGER,createdAt TEXT NOT NULL,sha TEXT);
    CREATE INDEX IF NOT EXISTS books_sha ON books(sha);
    CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY);`)
  const all = sql.prepare(
    'SELECT id,title,filePath,fileSize,pageCount,createdAt FROM books ORDER BY createdAt,id',
  )
  const insert = sql.prepare('INSERT INTO books VALUES(?,?,?,?,?,?,?)')
  const profiles = new Map()
  let generation = 0
  function load(uid) {
    if (!profiles.has(uid)) {
      const handlers = new Map()
      const dir = uid === 'owner' ? data : join(data, 'profiles', uid)
      const task = openReadingService(dir, {
        handle: (name, fn) => handlers.set(name, fn),
      })
        .then(({ database }) => ({ db: database, handlers, generation: -1 }))
        .catch((e) => {
          profiles.delete(uid)
          throw e
        })
      profiles.set(uid, task)
    }
    return profiles.get(uid)
  }
  if (
    !sql.prepare("SELECT 1 FROM migrations WHERE name='legacy-books'").get()
  ) {
    const owner = await load('owner')
    const rows = []
    for (const d of owner.db.listDocuments()) {
      let sha = null
      try {
        const digest = createHash('sha256')
        for await (const chunk of createReadStream(d.filePath))
          digest.update(chunk)
        sha = digest.digest('hex')
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      rows.push([
        d.id,
        d.title,
        d.filePath,
        d.fileSize,
        d.pageCount,
        d.createdAt,
        sha,
      ])
    }
    sql.exec('BEGIN')
    try {
      for (const row of rows) insert.run(...row)
      sql.exec("INSERT INTO migrations VALUES('legacy-books');COMMIT")
    } catch (e) {
      sql.exec('ROLLBACK')
      throw e
    }
  }
  async function profile(uid) {
    const p = await load(uid)
    if (p.generation !== generation) {
      for (const d of all.all()) p.db.addSharedDocument(d)
      p.generation = generation
    }
    return p
  }
  const auth = await accounts(sql, data, async uid => (await profile(uid)).db.getReaderOverview())
  return {
    auth,
    profile,
    byId: (id) => sql.prepare('SELECT * FROM books WHERE id=?').get(id),
    byHash: (sha) =>
      sql.prepare('SELECT * FROM books WHERE sha=? LIMIT 1').get(sha),
    missing: (title, size) =>
      sql
        .prepare(
          'SELECT * FROM books WHERE title=? AND fileSize=? AND sha IS NULL',
        )
        .get(title, size),
    repair: (id, sha) =>
      sql
        .prepare('UPDATE books SET sha=? WHERE id=? AND sha IS NULL')
        .run(sha, id),
    publish(title, path, size, sha) {
      const existing = this.byHash(sha)
      if (existing) return existing.id
      const id = randomUUID()
      insert.run(id, title, path, size, null, new Date().toISOString(), sha)
      generation++
      return id
    },
    async close() {
      for (const p of profiles.values()) await (await p).db.flush()
      sql.close()
    },
  }
}
