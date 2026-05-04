import { readFileSync, openSync, closeSync, readSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DictionaryEntryRecord } from '../shared/types'

type IfoMetadata = {
  bookname: string
  wordcount: number | null
  sametypesequence: string | null
}

const parseIfo = (content: string): IfoMetadata => {
  const fields = new Map<string, string>()

  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf('=')

    if (index <= 0) {
      continue
    }

    fields.set(line.slice(0, index), line.slice(index + 1))
  }

  const wordcount = Number(fields.get('wordcount'))

  return {
    bookname: fields.get('bookname') ?? 'StarDict',
    wordcount: Number.isFinite(wordcount) ? wordcount : null,
    sametypesequence: fields.get('sametypesequence') ?? null
  }
}

const makeBasePath = (ifoPath: string): string => ifoPath.replace(/\.ifo$/i, '')

const normalize = (value: string): string => value.trim().toLocaleLowerCase()

const buildEntryPositions = (idx: Buffer): Int32Array => {
  const positions: number[] = []
  let position = 0

  while (position < idx.length) {
    const wordEnd = idx.indexOf(0, position)

    if (wordEnd < 0 || wordEnd + 9 > idx.length) {
      break
    }

    positions.push(position)
    position = wordEnd + 9
  }

  return Int32Array.from(positions)
}

const readEntryAt = (
  idx: Buffer,
  position: number
): { word: string; offset: number; size: number } | null => {
  const wordEnd = idx.indexOf(0, position)

  if (wordEnd < 0 || wordEnd + 9 > idx.length) {
    return null
  }

  return {
    word: idx.slice(position, wordEnd).toString('utf8'),
    offset: idx.readUInt32BE(wordEnd + 1),
    size: idx.readUInt32BE(wordEnd + 5)
  }
}

const findIdxEntry = (
  idx: Buffer,
  positions: Int32Array,
  query: string
): { word: string; offset: number; size: number } | null => {
  const normalized = normalize(query)
  let low = 0
  let high = positions.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const entry = readEntryAt(idx, positions[middle] ?? 0)

    if (!entry) {
      return null
    }

    const current = normalize(entry.word)

    if (current === normalized) {
      return entry
    }

    if (current < normalized) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return null
}

export class StarDictSource {
  readonly ifoPath: string
  readonly label: string
  readonly entryCount: number | null

  private readonly idx: Buffer
  private readonly positions: Int32Array
  private readonly dictPath: string

  constructor(ifoPath: string) {
    const basePath = makeBasePath(ifoPath)
    const metadata = parseIfo(readFileSync(ifoPath, 'utf8'))

    this.ifoPath = ifoPath
    this.label = metadata.bookname || basename(basePath)
    this.entryCount = metadata.wordcount
    this.idx = readFileSync(`${basePath}.idx`)
    this.positions = buildEntryPositions(this.idx)
    this.dictPath = `${basePath}.dict`
  }

  private makeRecord(entry: { word: string; offset: number; size: number }): DictionaryEntryRecord {
    const file = openSync(this.dictPath, 'r')
    const buffer = Buffer.alloc(entry.size)

    try {
      readSync(file, buffer, 0, entry.size, entry.offset)
    } finally {
      closeSync(file)
    }

    const translation = buffer.toString('utf8').trim()
    const now = new Date().toISOString()

    return {
      id: `${this.ifoPath}:${entry.word}`,
      word: entry.word,
      phonetic: null,
      definition: null,
      translation,
      pos: null,
      exchange: null,
      source: this.ifoPath,
      updatedAt: now
    }
  }

  lookup(query: string): DictionaryEntryRecord | null {
    const entry = findIdxEntry(this.idx, this.positions, query)

    return entry ? this.makeRecord(entry) : null
  }

  suggest(query: string, limit = 8): DictionaryEntryRecord[] {
    const normalized = normalize(query)

    if (!normalized) {
      return []
    }

    const cappedLimit = Math.min(20, Math.max(1, Math.floor(limit)))
    const results: DictionaryEntryRecord[] = []
    let low = 0
    let high = this.positions.length - 1
    let start = this.positions.length

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const entry = readEntryAt(this.idx, this.positions[middle] ?? 0)

      if (!entry) {
        break
      }

      if (normalize(entry.word) >= normalized) {
        start = middle
        high = middle - 1
      } else {
        low = middle + 1
      }
    }

    for (let index = start; index < this.positions.length && results.length < cappedLimit; index += 1) {
      const entry = readEntryAt(this.idx, this.positions[index] ?? 0)

      if (!entry || !normalize(entry.word).startsWith(normalized)) {
        break
      }

      results.push(this.makeRecord(entry))
    }

    return results
  }
}

export const resolveStarDictIfoPath = (selectedPath: string): string => {
  if (/\.ifo$/i.test(selectedPath)) {
    return selectedPath
  }

  const folder = dirname(selectedPath)
  const baseName = basename(selectedPath).replace(/\.(idx|dict)$/i, '')
  return join(folder, `${baseName}.ifo`)
}
