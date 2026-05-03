type ParsedDictionaryEntry = {
  word: string
  phonetic?: string | null
  definition?: string | null
  translation?: string | null
  pos?: string | null
  exchange?: string | null
  source: string
}

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells.map((cell) => cell.trim())
}

const looksLikeHeader = (cells: string[]): boolean =>
  cells.some((cell) => ['word', 'translation', 'definition', 'phonetic'].includes(cell.toLowerCase()))

const makeHeaderMap = (header: string[]): Map<string, number> => {
  const aliases: Record<string, string> = {
    sw: 'word',
    phrase: 'word',
    phone: 'phonetic',
    phonetic_uk: 'phonetic',
    trans: 'translation',
    chinese: 'translation',
    def: 'definition',
    collins: 'definition',
    part_of_speech: 'pos',
    exchange_detail: 'exchange'
  }
  const map = new Map<string, number>()

  header.forEach((cell, index) => {
    const normalized = cell.trim().toLowerCase()
    map.set(aliases[normalized] ?? normalized, index)
  })

  return map
}

const cellAt = (cells: string[], index: number | undefined): string | null => {
  if (index === undefined || index < 0) {
    return null
  }

  return cells[index]?.trim() || null
}

export const parseDictionaryCsv = (content: string, source: string): ParsedDictionaryEntry[] => {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())

  if (lines.length === 0) {
    return []
  }

  const first = parseCsvLine(lines[0] ?? '')
  const hasHeader = looksLikeHeader(first)
  const headerMap = hasHeader ? makeHeaderMap(first) : null
  const rows = hasHeader ? lines.slice(1) : lines

  return rows.flatMap((line) => {
    const cells = parseCsvLine(line)

    if (cells.length < 2) {
      return []
    }

    if (headerMap) {
      return [
        {
          word: cellAt(cells, headerMap.get('word')) ?? '',
          phonetic: cellAt(cells, headerMap.get('phonetic')),
          definition: cellAt(cells, headerMap.get('definition')),
          translation: cellAt(cells, headerMap.get('translation')),
          pos: cellAt(cells, headerMap.get('pos')),
          exchange: cellAt(cells, headerMap.get('exchange')),
          source
        }
      ]
    }

    return [
      {
        word: cells[0] ?? '',
        phonetic: cells[1] || null,
        definition: cells[2] || null,
        translation: cells[3] || null,
        pos: cells[4] || null,
        exchange: cells[10] || null,
        source
      }
    ]
  })
}

