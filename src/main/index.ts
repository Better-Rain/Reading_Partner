import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AIChatToolDefinition,
  ChatMessage,
  ChatToolCall,
  aiAnnotationCapabilityPrompt,
  runOpenAICompatibleChatCompletion,
  runOpenAICompatibleCompletion
} from './ai'
import { askLibraryBoard } from './libraryBoard'
import { ReadingPartnerDatabase } from './database'
import { parseDictionaryCsv } from './dictionaryImport'
import { KeyStore } from './keyStore'
import { recognizePageImageText } from './ocr'
import { extractPdfText, PdfTextExtractionCancelledError } from './pdfText'
import { resolveStarDictIfoPath, StarDictSource } from './stardict'
import { searchBookTool, searchReferencesTool, searchReferences, type Reference } from './readingReferences'
import { annotationScopes, type AnnotationScope, type DocumentQuestionContext } from '../shared/types'
import { finalizeReadingLinks } from '../shared/readingLinks'
import { declinesAnnotations, hasExplicitAnnotationIntent } from '../shared/aiAnnotationIntent'
import {
  AIStreamEvent,
  AnnotationRecord,
  AskDocumentQuestionInput,
  CreateAnnotationInput,
  CreateVocabularyInput,
  DocumentTextIndexEvent,
  OcrPageTextInput,
  RunAIChatInput,
  RunAIActionInput,
  UpdateAnnotationInput,
  UpdateAIConversationTitleInput,
  UpdateVocabularyDefinitionInput,
  UpsertAIProviderInput
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const sanitizeFileName = (value: string): string =>
  (value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'reading-marks').slice(0, 120)

const stripAIAnnotationDirectives = (value: string): string =>
  value
    .replace(/<!--\s*RP_ANNOTATIONS\s*[\s\S]*?\s*-->/gi, '')
    .replace(/<!--\s*RP_ANNOTATIONS[\s\S]*$/i, '')
    .trim()

const stripAIReasoningDirectives = (value: string): string =>
  value.replace(/<!--\s*RP_REASONING\s*[\s\S]*?\s*-->/gi, '').trim()

const stripAIControlDirectives = (value: string): string =>
  stripAIAnnotationDirectives(stripAIReasoningDirectives(value))

const makeAIErrorEvent = (requestId: string, error: unknown): AIStreamEvent => {
  const normalized = error instanceof Error ? error : new Error(String(error))
  const partial = normalized as Error & {
    partialOutput?: unknown
    partialReasoning?: unknown
  }

  return {
    requestId,
    type: 'error',
    message: normalized.message,
    ...(typeof partial.partialOutput === 'string' ? { partialOutput: partial.partialOutput } : {}),
    ...(typeof partial.partialReasoning === 'string'
      ? { partialReasoning: partial.partialReasoning }
      : {})
  }
}

const aiAnnotationTool: AIChatToolDefinition = {
  type: 'function',
  function: {
    name: 'create_annotations',
    description:
      'Create up to five candidate PDF notes for durable reading marks. The app will validate the page and show the notes for user approval.',
    parameters: {
      type: 'object',
      properties: {
        annotations: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              pageNumber: { type: 'integer', minimum: 1 },
              scope: {
                type: 'string',
                enum: ['vocabulary', 'paragraph', 'margin', 'summary', 'question', 'note']
              },
              selectedText: { type: ['string', 'null'] },
              externalDoi: { type: 'string', description: 'Optional DOI returned by search_references in this turn' },
              externalQuote: { type: 'string', description: 'Optional short verbatim quote from the returned abstract' },
              note: { type: 'string', minLength: 1, maxLength: 900 },
              color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }
            },
            required: ['pageNumber', 'scope', 'selectedText', 'note'],
            additionalProperties: false
          }
        }
      },
      required: ['annotations'],
      additionalProperties: false
    }
  }
}

const normalizeAIAnchor = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

const normalizeAIAnnotationColor = (value: unknown): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : '#c7d2fe'

const isLocalAIProvider = (provider: { baseUrl: string; apiKeyRef: string | null }): boolean =>
  /(?:localhost|127\.0\.0\.1):18080(?:\/|$)/i.test(provider.baseUrl)

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    show: false,
    title: 'Reading Partner',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Every cloud account gets its own handlers, database, provider keys and in-flight operations.
export async function openReadingService(dataDir: string, registry: Pick<typeof ipcMain, 'handle'> = ipcMain) {
  const database = await ReadingPartnerDatabase.open(join(dataDir, 'reading-partner.sqlite'))
  const keyStore = new KeyStore(join(dataDir, 'secrets.json'))
  const starDictSources = new Map<string, StarDictSource>()
  const aiRequestControllers = new Map<string, AbortController>()
  const documentTextIndexControllers = new Map<string, AbortController>()
  const getAIProviderApiKey = (provider: { baseUrl: string; apiKeyRef: string | null }): string => {
    if (isLocalAIProvider(provider) && !provider.apiKeyRef) {
      return 'local-only'
    }

    return keyStore.get(provider.apiKeyRef)
  }

  const makeAIAnnotationToolHandler = (options: {
    requestId: string
    documentId: string
    pageNumber: number
    selectedText: string | null
    evidence?: Map<string, DocumentQuestionContext>
    references?: Map<string, Reference>
    visited?: Set<number>
    pageExcerpts?: string[]
    selectionRects?: RunAIChatInput['selectionRects']
    providerModel: string
    conversationId?: string
    sendEvent: (payload: AIStreamEvent) => void
  }): ((call: ChatToolCall) => Promise<string>) => {
    const createdKeys = new Set<string>()

    return async (call: ChatToolCall): Promise<string> => {
      if (call.name !== 'create_annotations') {
        return JSON.stringify({ ok: false, error: `Unsupported AI tool: ${call.name}` })
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(call.arguments)
      } catch {
        return JSON.stringify({ ok: false, error: 'The annotation tool arguments were not valid JSON.' })
      }

      const rawItems =
        parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown }).annotations)
          ? (parsed as { annotations: unknown[] }).annotations
          : []
      const document = database.getDocument(options.documentId)
      const created: AnnotationRecord[] = []
      const errors: string[] = []

      for (const rawItem of rawItems.slice(0, 5)) {
        if (!rawItem || typeof rawItem !== 'object') {
          errors.push('Ignored a malformed annotation item.')
          continue
        }

        const item = rawItem as Record<string, unknown>
        const requestedPage = Number(item.pageNumber)
        const pageNumber = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : options.pageNumber
        const boundedPage =
          pageNumber >= 1 && (!document.pageCount || pageNumber <= document.pageCount) ? pageNumber : null
        const note = typeof item.note === 'string' ? item.note.replace(/\s+/g, ' ').trim().slice(0, 900) : ''
        const selectedText =
          typeof item.selectedText === 'string' && item.selectedText.trim()
            ? item.selectedText.replace(/\s+/g, ' ').trim().slice(0, 500)
            : null

        if (!boundedPage || !note) {
          errors.push('Ignored an annotation with an invalid page or empty note.')
          continue
        }

        const scope = typeof item.scope === 'string' && Object.hasOwn(annotationScopes, item.scope) ? item.scope as AnnotationScope : 'note'
        if (options.evidence) {
          const onPage = [...options.evidence.values()].filter(chunk => chunk.pageNumber === boundedPage)
          if (!onPage.length || (!selectedText && scope !== 'margin') || (selectedText && !onPage.some(chunk => normalizeAIAnchor(chunk.text).includes(normalizeAIAnchor(selectedText))))) {
            errors.push(`Page ${boundedPage}: copy a short exact quote from a retrieved excerpt, or search_book first.`)
            continue
          }
        }
        const ref = options.references?.get(String(item.externalDoi).toLowerCase())
        const quote = typeof item.externalQuote === 'string' ? item.externalQuote.trim() : ''
        if ((item.externalDoi && !ref) || (quote && (!ref || quote.length > 150 || !ref.excerpt.includes(quote)))) {
          errors.push('Use only a DOI returned in this turn and a short exact quote from its abstract.')
          continue
        }
        const citation = ref ? `\n\n外部资料 · ${ref.title} ${[ref.author, ref.year].filter(Boolean).join(', ')}\nhttps://doi.org/${ref.doi}${quote ? `\n摘要摘录：“${quote}”` : ''}` : ''
        const pageRelation = options.visited && boundedPage !== options.pageNumber ? `\n\n关联位置 · 第 ${boundedPage} 页（${options.visited.has(boundedPage) ? '此前打开过' : '尚无打开记录'}）` : ''
        if (options.pageExcerpts && (boundedPage !== options.pageNumber || !selectedText ||
          !options.pageExcerpts.some((text) => normalizeAIAnchor(text).includes(normalizeAIAnchor(selectedText))))) {
          errors.push('Use a short verbatim quote from the supplied page, including its original spelling.')
          continue
        }
        if (createdKeys.size >= (options.pageExcerpts ? 3 : 5)) break
        const key = `${boundedPage}:${normalizeAIAnchor(selectedText)}:${normalizeAIAnchor(note)}`
        if (createdKeys.has(key)) {
          continue
        }

        const selectedAnchor = normalizeAIAnchor(selectedText)
        const currentAnchor = normalizeAIAnchor(options.selectedText)
        const canUseSelectionRects = Boolean(
          selectedAnchor &&
            boundedPage === options.pageNumber &&
            currentAnchor &&
            (selectedAnchor === currentAnchor || selectedAnchor.includes(currentAnchor) || currentAnchor.includes(selectedAnchor))
        )

        try {
          const annotation = database.createAnnotation({
            documentId: options.documentId,
            type: 'note',
            scope,
            pageNumber: boundedPage,
            selectedText,
            color: normalizeAIAnnotationColor(item.color),
            note: `模型：${options.providerModel}\n\n${note}${pageRelation}${citation}`,
            rectsJson: canUseSelectionRects && options.selectionRects?.length ? JSON.stringify(options.selectionRects) : null,
            authorName: 'AI'
          })
          createdKeys.add(key)
          created.push(annotation)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error))
        }
      }

      if (created.length > 0) {
        options.sendEvent({
          requestId: options.requestId,
          type: 'annotations',
          annotations: created,
          source: 'tool',
          conversationId: options.conversationId
        })
      }

      return JSON.stringify({
        ok: errors.length === 0,
        created: created.length,
        annotationIds: created.map((annotation) => annotation.id),
        errors
      })
    }
  }

  const createAIRequestController = (requestId: string): AbortController => {
    aiRequestControllers.get(requestId)?.abort()
    const controller = new AbortController()
    aiRequestControllers.set(requestId, controller)
    return controller
  }

  const releaseAIRequestController = (requestId: string, controller: AbortController): void => {
    if (aiRequestControllers.get(requestId) === controller) {
      aiRequestControllers.delete(requestId)
    }
  }

  const createDocumentTextIndexController = (documentId: string): AbortController => {
    documentTextIndexControllers.get(documentId)?.abort()
    const controller = new AbortController()
    documentTextIndexControllers.set(documentId, controller)
    return controller
  }

  const releaseDocumentTextIndexController = (
    documentId: string,
    controller: AbortController
  ): void => {
    if (documentTextIndexControllers.get(documentId) === controller) {
      documentTextIndexControllers.delete(documentId)
    }
  }

  const closeStarDictSources = (): void => {
    for (const source of starDictSources.values()) {
      source.close()
    }

    starDictSources.clear()
  }

  const registerIpc = (): void => {
    registry.handle('window:minimize', () => {
      mainWindow?.minimize()
    })

    registry.handle('window:toggleMaximize', () => {
      if (!mainWindow) {
        return false
      }

      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
        return false
      }

      mainWindow.maximize()
      return true
    })

    registry.handle('window:close', () => {
      mainWindow?.close()
    })

    registry.handle('board:conversations', (_event, groupId) => database.listBoardConversations(groupId))
    registry.handle('board:renameConversation', (_event, groupId, id, title) => database.renameBoardConversation(groupId, id, title))
    registry.handle('board:history', (_event, groupId, before, id) => database.getBoardHistory(groupId, before, 30, id))
    registry.handle('board:get', () => database.getBoard())
    registry.handle('board:save', (_event, state) => database.saveBoard(state))
    registry.handle('board:ask', async (event, groupId, providerId, question, mode, placement, options) => {
      const provider = database.getAIProvider(providerId)
      const apiKey = getAIProviderApiKey(provider)
      if (!options) return askLibraryBoard(database, provider, apiKey, groupId, question, mode, placement)
      if (typeof options.requestId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(options.requestId) || aiRequestControllers.has(options.requestId)) throw new Error('请求编号无效或重复')
      const controller = new AbortController()
      aiRequestControllers.set(options.requestId, controller)
      try {
        return await askLibraryBoard(database, provider, apiKey, groupId, question, mode, placement, options,
          controller.signal, payload => event.sender.send('board:streamEvent', payload))
      } finally { aiRequestControllers.delete(options.requestId) }
    })
    registry.handle('documents:list', () => database.listDocuments())

    registry.handle('documents:saveProgress', (_event, documentId: string, pageNumber: number) =>
      database.saveDocumentProgress(documentId, pageNumber)
    )

    registry.handle('documents:openPdfDialog', async () => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Open PDF',
        properties: ['openFile'],
        filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
      })

      if (result.canceled || !result.filePaths[0]) {
        return null
      }

      const document = database.importDocument(result.filePaths[0])
      const data = toArrayBuffer(await readFile(document.filePath))

      return { document, data }
    })

    registry.handle('documents:readPdf', async (_event, documentId: string) => {
      const document = database.getDocument(documentId)
      return toArrayBuffer(await readFile(document.filePath))
    })

    registry.handle('documents:textIndexStatus', (_event, documentId: string) =>
      database.getDocumentTextIndexStatus(documentId)
    )

    registry.handle('documents:cancelTextIndex', (_event, documentId: string) => {
      const controller = documentTextIndexControllers.get(documentId)

      if (!controller) {
        return false
      }

      controller.abort()
      return true
    })

    registry.handle('documents:indexText', async (event, documentId: string) => {
      const document = database.getDocument(documentId)
      const currentStatus = database.getDocumentTextIndexStatus(documentId)
      const sendEvent = (payload: DocumentTextIndexEvent): void => {
        event.sender.send('documents:textIndexEvent', payload)
      }

      if (
        currentStatus.pageCount &&
        currentStatus.pagesIndexed >= currentStatus.pageCount
      ) {
        const result = {
          ...currentStatus,
          skipped: true
        }

        sendEvent({
          documentId,
          type: 'done',
          result
        })

        return result
      }

      const controller = createDocumentTextIndexController(documentId)

      try {
        const extracted = await extractPdfText(document.filePath, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.pagesIndexed === 0) {
              sendEvent({
                documentId,
                type: 'start',
                pageCount: progress.pageCount
              })
              return
            }

            sendEvent({
              documentId,
              type: 'progress',
              pageCount: progress.pageCount,
              pagesIndexed: progress.pagesIndexed,
              chunksIndexed: progress.chunksIndexed
            })
          }
        })
        const result = database.replaceDocumentTextIndex({
          documentId,
          pageCount: extracted.pageCount,
          pages: extracted.pages,
          chunks: extracted.chunks
        })

        sendEvent({
          documentId,
          type: 'done',
          result
        })

        return result
      } catch (error) {
        if (error instanceof PdfTextExtractionCancelledError) {
          sendEvent({
            documentId,
            type: 'cancelled'
          })

          return {
            ...database.getDocumentTextIndexStatus(documentId),
            skipped: true,
            cancelled: true
          }
        }

        sendEvent({
          documentId,
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      } finally {
        releaseDocumentTextIndexController(documentId, controller)
      }
    })

    registry.handle('documents:ocrPageText', async (_event, input: OcrPageTextInput) => {
      const document = database.getDocument(input.documentId)
      const pageNumber = Math.max(1, Math.floor(input.pageNumber))

      if (
        typeof document.pageCount === 'number' &&
        document.pageCount > 0 &&
        pageNumber > document.pageCount
      ) {
        throw new Error(`Page ${pageNumber} is outside this document.`)
      }

      const recognized = await recognizePageImageText(input.imageDataUrl, input.imageScale)

      if (!recognized.text) {
        throw new Error('OCR did not detect readable text on this page.')
      }

      return database.upsertDocumentPageText({
        documentId: input.documentId,
        layout: {
          documentId: input.documentId,
          pageNumber,
          lines: recognized.lines
        },
        pageNumber,
        text: recognized.text
      })
    })

    registry.handle('documents:pageOcrLayout', (_event, documentId: string, pageNumber: number) =>
      database.getDocumentPageOcrLayout(documentId, pageNumber)
    )

    registry.handle('documents:searchText', (_event, documentId: string, query: string) =>
      database.searchDocumentText(documentId, query)
    )

    registry.handle('annotations:list', (_event, documentId: string) =>
      database.listAnnotations(documentId)
    )

    registry.handle('annotations:create', (_event, input: CreateAnnotationInput) =>
      database.createAnnotation(input)
    )

    registry.handle('annotations:update', (_event, input: UpdateAnnotationInput) =>
      database.updateAnnotation(input)
    )

    registry.handle('annotations:delete', (_event, id: string) => {
      database.deleteAnnotation(id)
    })

    registry.handle('annotations:restore', (_event, annotation: AnnotationRecord) =>
      database.restoreAnnotation(annotation)
    )

    registry.handle('readingMarks:exportDialog', async (_event, documentId: string) => {
      const document = database.getDocument(documentId)
      const bundle = database.exportReadingMarkBundle(documentId)
      const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
        title: 'Export Reading Marks',
        defaultPath: `${sanitizeFileName(document.title.replace(/\.pdf$/i, ''))}.reading-partner-marks.json`,
        filters: [{ name: 'Reading Partner Marks', extensions: ['json'] }]
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      await writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf8')

      return {
        filePath: result.filePath,
        annotationCount: bundle.annotations.length
      }
    })

    registry.handle('readingMarks:importDialog', async (_event, documentId: string) => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Import Reading Marks',
        properties: ['openFile'],
        filters: [
          { name: 'Reading Partner Marks', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePaths[0]) {
        return null
      }

      const filePath = result.filePaths[0]
      const bundle = JSON.parse(await readFile(filePath, 'utf8')) as { annotations?: unknown[] }
      const annotationCount = database.importReadingMarkBundle(documentId, bundle)

      return {
        filePath,
        annotationCount
      }
    })

    registry.handle('vocabulary:list', (_event, documentId?: string | null) =>
      database.listVocabulary(documentId)
    )

    registry.handle('vocabulary:create', (_event, input: CreateVocabularyInput) =>
      database.createVocabulary(input)
    )

    registry.handle('vocabulary:linkAnnotation', (_event, vocabularyId: string, annotationId: string) =>
      database.linkVocabularyAnnotation(vocabularyId, annotationId)
    )

    registry.handle('vocabulary:updateDefinition', (_event, input: UpdateVocabularyDefinitionInput) =>
      database.updateVocabularyDefinition(input)
    )

    registry.handle('vocabulary:delete', (_event, id: string) => {
      database.deleteVocabulary(id)
    })

    registry.handle('dictionary:lookup', (_event, query: string) => {
      const sqlEntry = database.lookupDictionary(query)

      if (sqlEntry) {
        return {
          query,
          entry: sqlEntry
        }
      }

      for (const source of starDictSources.values()) {
        const entry = source.lookup(query)

        if (entry) {
          return {
            query,
            entry
          }
        }
      }

      return {
        query,
        entry: null
      }
    })

    registry.handle('dictionary:suggest', (_event, query: string, limit?: number) => {
      const cappedLimit = Math.min(20, Math.max(1, Math.floor(limit ?? 8)))
      const entries = database.suggestDictionary(query, cappedLimit)
      const seen = new Set(entries.map((entry) => entry.word.toLocaleLowerCase()))

      for (const source of starDictSources.values()) {
        if (entries.length >= cappedLimit) {
          break
        }

        for (const entry of source.suggest(query, cappedLimit - entries.length)) {
          const key = entry.word.toLocaleLowerCase()

          if (!seen.has(key)) {
            entries.push(entry)
            seen.add(key)
          }
        }
      }

      return {
        query,
        entries
      }
    })

    registry.handle('dictionary:sources', () => database.listDictionarySources())

    registry.handle('dictionary:importCsvDialog', async () => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: 'Import Dictionary',
        properties: ['openFile'],
        filters: [
          { name: 'Dictionary', extensions: ['csv', 'ifo', 'idx', 'dict'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePaths[0]) {
        return null
      }

      const sourcePath = result.filePaths[0]

      if (/\.(ifo|idx|dict)$/i.test(sourcePath)) {
        const ifoPath = resolveStarDictIfoPath(sourcePath)
        const source = new StarDictSource(ifoPath)
        starDictSources.get(ifoPath)?.close()
        starDictSources.set(ifoPath, source)
        database.registerDictionarySource({
          type: 'stardict',
          label: source.label,
          path: ifoPath,
          entryCount: source.entryCount
        })

        return {
          imported: source.entryCount ?? 0,
          skipped: 0,
          sourcePath: ifoPath,
          sourceType: 'stardict'
        }
      }

      const content = await readFile(sourcePath, 'utf8')
      const entries = parseDictionaryCsv(content, sourcePath)
      const imported = database.importDictionaryEntries(entries)

      return {
        ...imported,
        sourcePath,
        sourceType: 'csv'
      }
    })

    registry.handle('aiProviders:list', () => database.listAIProviders())

    registry.handle('aiProviders:upsert', (_event, input: UpsertAIProviderInput) =>
      database.upsertAIProvider(input)
    )

    registry.handle('aiProviders:setApiKey', (_event, providerId: string, apiKey: string) => {
      const ref = `provider:${providerId}`
      keyStore.set(ref, apiKey)
      return database.setAIProviderKeyRef(providerId, ref)
    })

    registry.handle('aiProviders:clearApiKey', (_event, providerId: string) => {
      const provider = database.getAIProvider(providerId)
      keyStore.delete(provider.apiKeyRef)
      return database.setAIProviderKeyRef(providerId, null)
    })

    registry.handle('aiProviders:keyStatus', () =>
      keyStore
        .listConfigured(
          database.listAIProviders().map((provider) => ({
            providerId: provider.id,
            apiKeyRef: provider.apiKeyRef
          }))
        )
        .map((status) => {
          const provider = database.getAIProvider(status.providerId)
          return isLocalAIProvider(provider) && !provider.apiKeyRef
            ? { ...status, configured: true }
            : status
        })
    )

    registry.handle('ai:conversations', (_event, documentId: string) =>
      database.listAIConversations(documentId)
    )

    registry.handle('ai:createConversation', (_event, documentId: string, title?: string | null) =>
      database.createAIConversation({ documentId, title })
    )

    registry.handle('ai:updateConversationTitle', (_event, input: UpdateAIConversationTitleInput) =>
      database.updateAIConversationTitle(input)
    )

    registry.handle('ai:chatMessages', (_event, conversationId: string) =>
      database.listAIChatMessages(conversationId)
    )

    registry.handle('ai:cancelRequest', (_event, requestId: string) => {
      const controller = aiRequestControllers.get(requestId)

      if (!controller) {
        return false
      }

      controller.abort()
      return true
    })

    registry.handle('ai:runAction', async (event, input: RunAIActionInput) => {
      const sendEvent = (payload: AIStreamEvent): void => {
        event.sender.send('ai:streamEvent', payload)
      }
      let controller: AbortController | null = null

      try {
        const provider = database.getAIProvider(input.providerId)
        const apiKey = getAIProviderApiKey(provider)
        controller = createAIRequestController(input.requestId)
        sendEvent({
          requestId: input.requestId,
          type: 'start',
          providerId: provider.id,
          model: provider.defaultModel
        })
        await runOpenAICompatibleCompletion({
          input,
          provider,
          apiKey,
          signal: controller.signal,
          onEvent: sendEvent,
          saveArtifact: (output) =>
            database.createAIArtifact({
              documentId: input.documentId,
              providerId: provider.id,
              model: provider.defaultModel,
              promptType: input.promptType,
              inputText: input.selectedText,
              outputMarkdown: output,
              pageNumber: input.pageNumber
            })
        })
      } catch (error) {
        sendEvent(makeAIErrorEvent(input.requestId, error))
      } finally {
        if (controller) {
          releaseAIRequestController(input.requestId, controller)
        }
      }
    })

    registry.handle('ai:askDocument', async (event, input: AskDocumentQuestionInput) => {
      const sendEvent = (payload: AIStreamEvent): void => {
        event.sender.send('ai:streamEvent', payload)
      }
      let controller: AbortController | null = null

      try {
        const provider = database.getAIProvider(input.providerId)
        const apiKey = getAIProviderApiKey(provider)
        controller = createAIRequestController(input.requestId)
        sendEvent({
          requestId: input.requestId,
          type: 'start',
          providerId: provider.id,
          model: provider.defaultModel
        })
        const context = database.getRelevantDocumentChunks(
          input.documentId,
          input.question,
          input.pageNumber,
          provider.supportsLongContext ? 16 : 10
        )
        const excerpts = input.annotatePage ? context.filter((chunk) => chunk.pageNumber === input.pageNumber) : context
        if (input.annotatePage && !excerpts.length) throw new Error('本页尚无文本索引。请等待索引完成，或先运行本页 OCR。')
        const explicitAnnotationRequest = input.annotatePage || hasExplicitAnnotationIntent(input.question)
        await runOpenAICompatibleCompletion({
          input: {
            requestId: input.requestId,
            providerId: input.providerId,
            documentId: input.documentId,
            pageNumber: input.pageNumber,
            promptType: 'ask_document',
            selectedText: input.question,
            context: excerpts
          },
          provider,
          apiKey,
          signal: controller.signal,
          onEvent: sendEvent,
          finishAfterAnnotations: Boolean(input.annotatePage),
          ...(explicitAnnotationRequest
            ? {
                tools: [aiAnnotationTool],
                onToolCall: makeAIAnnotationToolHandler({
                  requestId: input.requestId,
                  documentId: input.documentId,
                  pageNumber: input.pageNumber,
                  selectedText: null,
                  pageExcerpts: input.annotatePage ? excerpts.map((chunk) => chunk.text) : undefined,
                  providerModel: provider.defaultModel,
                  sendEvent
                })
              }
            : {}),
          saveArtifact: (output) =>
            database.createAIArtifact({
              documentId: input.documentId,
              providerId: provider.id,
              model: provider.defaultModel,
              promptType: 'ask_document',
              inputText: input.question,
              outputMarkdown: output,
              pageNumber: input.pageNumber
            })
        })
      } catch (error) {
        sendEvent(makeAIErrorEvent(input.requestId, error))
      } finally {
        if (controller) {
          releaseAIRequestController(input.requestId, controller)
        }
      }
    })

    registry.handle('ai:runChat', async (event, input: RunAIChatInput) => {
      const sendEvent = (payload: AIStreamEvent): void => {
        event.sender.send('ai:streamEvent', payload)
      }
      let controller: AbortController | null = null

      try {
        const conversation = database.getAIConversation(input.conversationId)

        if (conversation.documentId !== input.documentId) {
          throw new Error('AI conversation does not belong to the active document.')
        }

        const provider = database.getAIProvider(input.providerId)
        const apiKey = getAIProviderApiKey(provider)
        const selectedText = input.selectedText?.trim() || null
        const explicitAnnotationRequest = hasExplicitAnnotationIntent(input.message)
        const readOnly = declinesAnnotations(input.message)
        const created: AnnotationRecord[] = []
        database.createAIChatMessage({
          conversationId: input.conversationId,
          role: 'user',
          content: input.message,
          selectedText,
          pageNumber: input.pageNumber
        })

        const context = database.getRelevantDocumentChunks(
          input.documentId,
          selectedText ? `${input.message} ${selectedText}` : input.message,
          input.pageNumber,
          provider.supportsLongContext ? 18 : 10
        )
        const recentMessages = database.getRecentAIChatMessages(
          input.conversationId,
          provider.supportsLongContext ? 32 : 12
        )
        const visited = database.visitedPages(input.documentId)
        const evidence = new Map(context.map(chunk => [chunk.id, chunk]))
        const references = new Map<string, Reference>()
        const describe = (chunk: DocumentQuestionContext) => `第 ${chunk.pageNumber} 页（${chunk.pageNumber === input.pageNumber ? '当前页' : visited.has(chunk.pageNumber) ? '此前打开过' : '尚无打开记录'}）\n${chunk.text}`
        for (const past of recentMessages.filter(m => m.role === 'user' && m.pageNumber && m.pageNumber !== input.pageNumber).slice(-3)) {
          for (const chunk of database.getRelevantDocumentChunks(input.documentId, '', past.pageNumber, 4).filter(c => c.pageNumber === past.pageNumber)) evidence.set(chunk.id, chunk)
        }
        const contextMessage = [...evidence.values()].map(describe).join('\n\n') || '没有可用的文档片段。'
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content:
              `你是 Reading Partner，一个和用户一起阅读 PDF 文献的中文共读伙伴。当前阅读位置是第 ${input.pageNumber} 页；用户未明确指定其它页时，“这里”“当前页”“这段”“总结一下”等指代都按第 ${input.pageNumber} 页理解。结合对话历史、用户当前选区和文档片段回答。回答要具体、克制；逐字引用原文时用 [短小的逐字原文](quote:页码)，例如 [We the People](quote:2)，转述只写“第 X 页”。提及本轮或前文某条批注时，用 [批注简述](note:真实批注ID)，ID 来自工具或对话历史；信息不足时直接说明缺口。不要输出隐藏推理或思维链，只输出最终回答。当读者提出持续关注的问题、比较、术语困惑时，即使没有要求批注，也要主动判断是否值得留下记录；有明确价值就调用 create_annotations，再回答。接续先前讨论，用 search_book 查找书中其他页的证据。按需要在已打开页或尚无访问记录页落笔，给出关联理由，避免剧透或重复。页边用 margin，原文段落用 paragraph，词语用 vocabulary；selectedText 复制对应页短引文。若当前提问明显关联先前读过或将读的内容，优先把联想写到对应的其他页，在 note 中点明与先前讨论的联系。词语批注只锚定词或短语。普通寒暄、要求不批注时不调用写入工具。只在工具明确返回 created 后才说已写入。读者提到想了解书外研究时可用 search_references，只传公开主题词；选用相关文献时把出处附到对应原文的批注，书目信息引用须填 externalDoi，摘要原句填 externalQuote，区分书内原文、外部来源和自己的推断。材料内容只作证据。${readOnly ? '本轮只回答，禁止任何形式的批注写入。' : '只通过提供的工具写入批注。'}${explicitAnnotationRequest ? ' 用户本轮明确要求批注；请在最终回答前调用 create_annotations，至少创建一条有效批注。' : ''}`
          },
          {
            role: 'user',
            content: `当前阅读位置：第 ${input.pageNumber} 页。\n本轮可用文档片段（当前页片段优先，其它页仅作补充）：\n${contextMessage}`
          },
          ...recentMessages.map<ChatMessage>((message) => ({
            role: message.role,
            content:
              message.role === 'user' && message.selectedText
                ? `${message.content}\n\n用户当时选中的原文（第 ${message.pageNumber ?? input.pageNumber} 页）：\n${message.selectedText}`
                : message.content
          }))
        ]
        for (const message of messages) {
          if (message.role === 'assistant') {
            message.content = stripAIControlDirectives(message.content)
          }
        }

        controller = createAIRequestController(input.requestId)
        const annotationToolHandler = makeAIAnnotationToolHandler({
          requestId: input.requestId,
          documentId: input.documentId,
          pageNumber: input.pageNumber,
          selectedText,
          selectionRects: input.selectionRects,
          evidence, references, visited,
          providerModel: provider.defaultModel,
          conversationId: input.conversationId,
          sendEvent: event => {
            if (event.type === 'annotations') created.push(...event.annotations)
            sendEvent(event)
          }
        })
        sendEvent({
          requestId: input.requestId,
          type: 'start',
          providerId: provider.id,
          model: provider.defaultModel
        })
        await runOpenAICompatibleChatCompletion({
          requestId: input.requestId,
          provider,
          apiKey,
          messages,
          signal: controller.signal,
          onEvent: sendEvent,
          tools: readOnly ? [searchBookTool, searchReferencesTool] : [aiAnnotationTool, searchBookTool, searchReferencesTool],
          onToolCall: async (call) => {
            if (call.name === 'create_annotations') return readOnly ? JSON.stringify({error: 'Annotations disabled for this turn'}) : annotationToolHandler(call)
            const args = JSON.parse(call.arguments)
            if (call.name === 'search_book') {
              const results = database.searchDocumentText(input.documentId, String(args.keyword ?? '').slice(0, 120), 7)
              for (const result of results) evidence.set(result.id, result)
              return JSON.stringify(results.map(describe))
            }
            if (call.name === 'search_references') {
              const results = await searchReferences(String(args.keywords ?? ''), controller?.signal)
              for (const ref of results) references.set(ref.doi, ref)
              return JSON.stringify(results)
            }
            return JSON.stringify({error: 'Unknown tool'})
          },
          saveArtifact: (output) => {
            const previousNoteIds = new Set(recentMessages.filter(message => message.role === 'assistant')
              .flatMap(message => Array.from(message.content.matchAll(/\]\(note:([a-f0-9-]+)\)/g), match => match[1]!)))
            const answer = finalizeReadingLinks(stripAIAnnotationDirectives(output), evidence.values(), created, previousNoteIds)
            const artifact = database.createAIArtifact({
              documentId: input.documentId,
              providerId: provider.id,
              model: provider.defaultModel,
              promptType: 'chat_document',
              inputText: input.message,
              outputMarkdown: answer,
              pageNumber: input.pageNumber
            })

            database.createAIChatMessage({
              conversationId: input.conversationId,
              role: 'assistant',
              content: answer,
              pageNumber: input.pageNumber,
              providerId: provider.id,
              model: provider.defaultModel,
              artifactId: artifact.id
            })

            return artifact
          }
        })
      } catch (error) {
        sendEvent(makeAIErrorEvent(input.requestId, error))
      } finally {
        if (controller) {
          releaseAIRequestController(input.requestId, controller)
        }
      }
    })
  }

  for (const source of database.listDictionarySources()) {
    if (source.type !== 'stardict') {
      continue
    }

    try {
      starDictSources.set(source.path, new StarDictSource(source.path))
    } catch (error) {
      console.error(`Failed to load StarDict source ${source.path}`, error)
    }
  }
  registerIpc()
  return { database, closeStarDictSources }
}

if (!process.env.RP_HEADLESS_SERVICE) {
  let desktop: Awaited<ReturnType<typeof openReadingService>> | undefined
  let isReadyToQuit = false
  let isPreparingToQuit = false
  app.whenReady().then(() => {
    void openReadingService(app.getPath('userData')).then(service => {
      desktop = service
      createWindow()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (isReadyToQuit) {
      desktop?.closeStarDictSources()
      return
    }

    event.preventDefault()

    if (isPreparingToQuit) {
      return
    }

    if (!desktop) {
      isReadyToQuit = true
      app.quit()
      return
    }

    isPreparingToQuit = true
    void desktop.database
      .flush()
      .catch((error) => {
        console.error('Failed to flush Reading Partner database before quit', error)
      })
      .finally(() => {
        desktop?.closeStarDictSources()
        isReadyToQuit = true
        app.quit()
      })
  })
}
