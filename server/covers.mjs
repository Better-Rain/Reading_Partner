import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const convert = promisify(execFile)
const pending = new Map()
let queue = Promise.resolve()

// sips renders the first PDF page with the Mac's built-in PDF decoder.
export async function bookCover(data, book) {
  const dir = join(data, 'cover-cache')
  const key = createHash('sha256').update(book.sha || book.id).digest('hex')
  const target = join(dir, key + '.jpg')
  try { return await readFile(target) } catch (err) { if (err.code !== 'ENOENT') throw err }
  if (!pending.has(target)) {
    const work = queue.then(async () => {
      await mkdir(dir, { recursive: true })
      const temp = join(dir, randomUUID() + '.jpg')
      try {
        await convert('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', '360', book.filePath, '--out', temp], { timeout: 30000 })
        const bytes = await readFile(temp)
        if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('封面生成失败')
        await rename(temp, target)
        return bytes
      } finally { await unlink(temp).catch(() => {}) }
    })
    pending.set(target, work)
    queue = work.catch(() => {}).finally(() => pending.delete(target))
  }
  return pending.get(target)
}
