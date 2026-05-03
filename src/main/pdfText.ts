import { readFile } from 'node:fs/promises'

type PdfTextItem = {
  str?: string
  hasEOL?: boolean
}

export type ExtractedPdfPage = {
  pageNumber: number
  text: string
}

export type ExtractedPdfChunk = {
  pageNumber: number
  chunkIndex: number
  text: string
}

export type ExtractedPdfText = {
  pageCount: number
  pages: ExtractedPdfPage[]
  chunks: ExtractedPdfChunk[]
}

const maxChunkLength = 1200
const minChunkLength = 320

const normalizeText = (value: string): string =>
  value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

const joinTextItems = (items: PdfTextItem[]): string => {
  let output = ''

  for (const item of items) {
    const text = item.str ?? ''

    if (!text) {
      continue
    }

    output += text

    if (item.hasEOL) {
      output += '\n'
    } else if (!/\s$/.test(output)) {
      output += ' '
    }
  }

  return normalizeText(output)
}

const splitPageIntoChunks = (pageNumber: number, text: string): ExtractedPdfChunk[] => {
  if (!text) {
    return []
  }

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const chunks: ExtractedPdfChunk[] = []
  let current = ''

  const pushCurrent = (): void => {
    const normalized = normalizeText(current)

    if (!normalized) {
      current = ''
      return
    }

    chunks.push({
      pageNumber,
      chunkIndex: chunks.length,
      text: normalized
    })
    current = ''
  }

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [text]) {
    if (paragraph.length > maxChunkLength) {
      pushCurrent()

      for (let start = 0; start < paragraph.length; start += maxChunkLength) {
        const slice = normalizeText(paragraph.slice(start, start + maxChunkLength))

        if (slice) {
          chunks.push({
            pageNumber,
            chunkIndex: chunks.length,
            text: slice
          })
        }
      }
      continue
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph

    if (next.length > maxChunkLength && current.length >= minChunkLength) {
      pushCurrent()
      current = paragraph
    } else {
      current = next
    }
  }

  pushCurrent()
  return chunks
}

export const extractPdfText = async (filePath: string): Promise<ExtractedPdfText> => {
  const pdfjs = await import('pdfjs-dist')
  const data = new Uint8Array(await readFile(filePath))
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  const pages: ExtractedPdfPage[] = []
  const chunks: ExtractedPdfChunk[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = joinTextItems(content.items as PdfTextItem[])

      pages.push({
        pageNumber,
        text
      })
      chunks.push(...splitPageIntoChunks(pageNumber, text))
      page.cleanup()
    }

    return {
      pageCount: pdf.numPages,
      pages,
      chunks
    }
  } finally {
    await pdf.destroy()
  }
}
