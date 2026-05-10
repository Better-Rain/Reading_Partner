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

export type PdfTextExtractionProgress = {
  pageCount: number
  pagesIndexed: number
  chunksIndexed: number
}

export class PdfTextExtractionCancelledError extends Error {
  constructor() {
    super('PDF text indexing was cancelled.')
    this.name = 'PdfTextExtractionCancelledError'
  }
}

const maxChunkLength = 1200
const minChunkLength = 320
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new PdfTextExtractionCancelledError()
  }
}

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

export const splitPageIntoChunks = (pageNumber: number, text: string): ExtractedPdfChunk[] => {
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

export const extractPdfText = async (
  filePath: string,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: PdfTextExtractionProgress) => void
  } = {}
): Promise<ExtractedPdfText> => {
  throwIfAborted(options.signal)
  const pdfjs = await import('pdfjs-dist')
  throwIfAborted(options.signal)
  const data = new Uint8Array(await readFile(filePath))
  throwIfAborted(options.signal)
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  throwIfAborted(options.signal)
  const pages: ExtractedPdfPage[] = []
  const chunks: ExtractedPdfChunk[] = []

  try {
    options.onProgress?.({
      pageCount: pdf.numPages,
      pagesIndexed: 0,
      chunksIndexed: 0
    })

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      throwIfAborted(options.signal)
      const page = await pdf.getPage(pageNumber)
      throwIfAborted(options.signal)
      const content = await page.getTextContent()
      throwIfAborted(options.signal)
      const text = joinTextItems(content.items as PdfTextItem[])

      pages.push({
        pageNumber,
        text
      })
      chunks.push(...splitPageIntoChunks(pageNumber, text))
      page.cleanup()
      options.onProgress?.({
        pageCount: pdf.numPages,
        pagesIndexed: pageNumber,
        chunksIndexed: chunks.length
      })

      if (pageNumber < pdf.numPages) {
        await yieldToEventLoop()
      }
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
