import { app } from 'electron'
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import Tesseract from 'tesseract.js'
import type { OcrTextLine } from '../shared/types'

const require = createRequire(import.meta.url)
const languages = ['chi_sim', 'eng'] as const
let workerPromise: Promise<Tesseract.Worker> | null = null

const normalizeCjkSpacing = (value: string): string =>
  value.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')

const normalizeOcrText = (value: string): string =>
  normalizeCjkSpacing(value)
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const roundLayoutValue = (value: number): number => Number(value.toFixed(2))

const toOcrLines = (page: Tesseract.Page, imageScale: number): OcrTextLine[] => {
  const scale = Number.isFinite(imageScale) && imageScale > 0 ? imageScale : 1
  const lines = page.blocks
    ?.flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .map((line) => {
      const text = normalizeOcrText(line.text)
      const left = line.bbox.x0 / scale
      const top = line.bbox.y0 / scale
      const width = (line.bbox.x1 - line.bbox.x0) / scale
      const height = (line.bbox.y1 - line.bbox.y0) / scale

      if (!text || width <= 1 || height <= 1) {
        return null
      }

      return {
        text,
        left: roundLayoutValue(left),
        top: roundLayoutValue(top),
        width: roundLayoutValue(width),
        height: roundLayoutValue(height)
      }
    })
    .filter((line): line is OcrTextLine => Boolean(line))

  return lines ?? []
}

const resolveLanguagePackagePath = (language: (typeof languages)[number]): string => {
  const packageJsonPath = require.resolve(`@tesseract.js-data/${language}/package.json`)
  return join(dirname(packageJsonPath), '4.0.0', `${language}.traineddata.gz`)
}

const ensureLocalLanguageData = async (): Promise<string> => {
  const targetDir = join(app.getPath('userData'), 'tessdata')
  await mkdir(targetDir, { recursive: true })

  for (const language of languages) {
    const targetPath = join(targetDir, `${language}.traineddata.gz`)

    if (!existsSync(targetPath)) {
      await copyFile(resolveLanguagePackagePath(language), targetPath)
    }
  }

  return targetDir
}

const getWorker = async (): Promise<Tesseract.Worker> => {
  if (!workerPromise) {
    workerPromise = ensureLocalLanguageData().then(async (langPath) => {
      const worker = await Tesseract.createWorker(languages.join('+'), undefined, {
        cachePath: langPath,
        gzip: true,
        langPath
      })

      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO
      })

      return worker
    })
  }

  return workerPromise
}

export const recognizePageImageText = async (
  imageDataUrl: string,
  imageScale: number
): Promise<{ text: string; lines: OcrTextLine[] }> => {
  const worker = await getWorker()
  const result = await worker.recognize(imageDataUrl, {}, { blocks: true })

  return {
    text: normalizeOcrText(result.data.text),
    lines: toOcrLines(result.data, imageScale)
  }
}
