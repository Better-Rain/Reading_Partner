import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ChatMessage,
  aiAnnotationCapabilityPrompt,
  runOpenAICompatibleChatCompletion,
  runOpenAICompatibleCompletion
} from './ai'
import { ReadingPartnerDatabase } from './database'
import { parseDictionaryCsv } from './dictionaryImport'
import { KeyStore } from './keyStore'
import { recognizePageImageText } from './ocr'
import { extractPdfText, PdfTextExtractionCancelledError } from './pdfText'
import { resolveStarDictIfoPath, StarDictSource } from './stardict'
import { hasExplicitAnnotationIntent } from '../shared/aiAnnotationIntent'
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
let database: ReadingPartnerDatabase
let keyStore: KeyStore
const starDictSources = new Map<string, StarDictSource>()
const aiRequestControllers = new Map<string, AbortController>()
const documentTextIndexControllers = new Map<string, AbortController>()
let isReadyToQuit = false
let isPreparingToQuit = false

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

const buildExplicitSelectedAnnotationPrompt = (pageNumber: number, selectedText: string): string =>
  [
    '本轮用户明确要求把当前选区创建为 PDF 批注。',
    '你必须在回答末尾追加一个且仅一个 RP_ANNOTATIONS HTML 注释块，且至少包含 1 条批注，最多 5 条。',
    `第一条批注必须使用 pageNumber ${pageNumber}，selectedText 必须对应下面的当前选区。`,
    '如果这段内容里有值得单独解释的术语、概念、段落观点或页边总结，可以继续补充其它批注并自行选择 scope 与颜色。',
    'visible answer 可以简短说明批注要点，但真正写入 PDF 的批注内容必须放在 RP_ANNOTATIONS 的 note 字段。',
    `当前选区（第 ${pageNumber} 页）：`,
    selectedText
  ].join('\n')

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

const registerIpc = (): void => {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.handle('window:toggleMaximize', () => {
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

  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('documents:list', () => database.listDocuments())

  ipcMain.handle('documents:saveProgress', (_event, documentId: string, pageNumber: number) =>
    database.saveDocumentProgress(documentId, pageNumber)
  )

  ipcMain.handle('documents:openPdfDialog', async () => {
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

  ipcMain.handle('documents:readPdf', async (_event, documentId: string) => {
    const document = database.getDocument(documentId)
    return toArrayBuffer(await readFile(document.filePath))
  })

  ipcMain.handle('documents:textIndexStatus', (_event, documentId: string) =>
    database.getDocumentTextIndexStatus(documentId)
  )

  ipcMain.handle('documents:cancelTextIndex', (_event, documentId: string) => {
    const controller = documentTextIndexControllers.get(documentId)

    if (!controller) {
      return false
    }

    controller.abort()
    return true
  })

  ipcMain.handle('documents:indexText', async (event, documentId: string) => {
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

  ipcMain.handle('documents:ocrPageText', async (_event, input: OcrPageTextInput) => {
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

  ipcMain.handle('documents:pageOcrLayout', (_event, documentId: string, pageNumber: number) =>
    database.getDocumentPageOcrLayout(documentId, pageNumber)
  )

  ipcMain.handle('documents:searchText', (_event, documentId: string, query: string) =>
    database.searchDocumentText(documentId, query)
  )

  ipcMain.handle('annotations:list', (_event, documentId: string) =>
    database.listAnnotations(documentId)
  )

  ipcMain.handle('annotations:create', (_event, input: CreateAnnotationInput) =>
    database.createAnnotation(input)
  )

  ipcMain.handle('annotations:update', (_event, input: UpdateAnnotationInput) =>
    database.updateAnnotation(input)
  )

  ipcMain.handle('annotations:delete', (_event, id: string) => {
    database.deleteAnnotation(id)
  })

  ipcMain.handle('annotations:restore', (_event, annotation: AnnotationRecord) =>
    database.restoreAnnotation(annotation)
  )

  ipcMain.handle('readingMarks:exportDialog', async (_event, documentId: string) => {
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

  ipcMain.handle('readingMarks:importDialog', async (_event, documentId: string) => {
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

  ipcMain.handle('vocabulary:list', (_event, documentId?: string | null) =>
    database.listVocabulary(documentId)
  )

  ipcMain.handle('vocabulary:create', (_event, input: CreateVocabularyInput) =>
    database.createVocabulary(input)
  )

  ipcMain.handle('vocabulary:linkAnnotation', (_event, vocabularyId: string, annotationId: string) =>
    database.linkVocabularyAnnotation(vocabularyId, annotationId)
  )

  ipcMain.handle('vocabulary:updateDefinition', (_event, input: UpdateVocabularyDefinitionInput) =>
    database.updateVocabularyDefinition(input)
  )

  ipcMain.handle('vocabulary:delete', (_event, id: string) => {
    database.deleteVocabulary(id)
  })

  ipcMain.handle('dictionary:lookup', (_event, query: string) => {
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

  ipcMain.handle('dictionary:suggest', (_event, query: string, limit?: number) => {
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

  ipcMain.handle('dictionary:sources', () => database.listDictionarySources())

  ipcMain.handle('dictionary:importCsvDialog', async () => {
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

  ipcMain.handle('aiProviders:list', () => database.listAIProviders())

  ipcMain.handle('aiProviders:upsert', (_event, input: UpsertAIProviderInput) =>
    database.upsertAIProvider(input)
  )

  ipcMain.handle('aiProviders:setApiKey', (_event, providerId: string, apiKey: string) => {
    const ref = `provider:${providerId}`
    keyStore.set(ref, apiKey)
    return database.setAIProviderKeyRef(providerId, ref)
  })

  ipcMain.handle('aiProviders:clearApiKey', (_event, providerId: string) => {
    const provider = database.getAIProvider(providerId)
    keyStore.delete(provider.apiKeyRef)
    return database.setAIProviderKeyRef(providerId, null)
  })

  ipcMain.handle('aiProviders:keyStatus', () =>
    keyStore.listConfigured(
      database.listAIProviders().map((provider) => ({
        providerId: provider.id,
        apiKeyRef: provider.apiKeyRef
      }))
    )
  )

  ipcMain.handle('ai:conversations', (_event, documentId: string) =>
    database.listAIConversations(documentId)
  )

  ipcMain.handle('ai:createConversation', (_event, documentId: string, title?: string | null) =>
    database.createAIConversation({ documentId, title })
  )

  ipcMain.handle('ai:updateConversationTitle', (_event, input: UpdateAIConversationTitleInput) =>
    database.updateAIConversationTitle(input)
  )

  ipcMain.handle('ai:chatMessages', (_event, conversationId: string) =>
    database.listAIChatMessages(conversationId)
  )

  ipcMain.handle('ai:cancelRequest', (_event, requestId: string) => {
    const controller = aiRequestControllers.get(requestId)

    if (!controller) {
      return false
    }

    controller.abort()
    return true
  })

  ipcMain.handle('ai:runAction', async (event, input: RunAIActionInput) => {
    const provider = database.getAIProvider(input.providerId)
    const apiKey = keyStore.get(provider.apiKeyRef)
    const controller = createAIRequestController(input.requestId)
    const sendEvent = (payload: AIStreamEvent): void => {
      event.sender.send('ai:streamEvent', payload)
    }

    try {
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
      sendEvent({
        requestId: input.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      releaseAIRequestController(input.requestId, controller)
    }
  })

  ipcMain.handle('ai:askDocument', async (event, input: AskDocumentQuestionInput) => {
    const provider = database.getAIProvider(input.providerId)
    const apiKey = keyStore.get(provider.apiKeyRef)
    const controller = createAIRequestController(input.requestId)
    const context = database.getRelevantDocumentChunks(
      input.documentId,
      input.question,
      input.pageNumber,
      provider.supportsLongContext ? 10 : 6
    )
    const sendEvent = (payload: AIStreamEvent): void => {
      event.sender.send('ai:streamEvent', payload)
    }

    try {
      await runOpenAICompatibleCompletion({
        input: {
          requestId: input.requestId,
          providerId: input.providerId,
          documentId: input.documentId,
          pageNumber: input.pageNumber,
          promptType: 'ask_document',
          selectedText: input.question,
          context
        },
        provider,
        apiKey,
        signal: controller.signal,
        onEvent: sendEvent,
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
      sendEvent({
        requestId: input.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      releaseAIRequestController(input.requestId, controller)
    }
  })

  ipcMain.handle('ai:runChat', async (event, input: RunAIChatInput) => {
    const conversation = database.getAIConversation(input.conversationId)

    if (conversation.documentId !== input.documentId) {
      throw new Error('AI conversation does not belong to the active document.')
    }

    const provider = database.getAIProvider(input.providerId)
    const apiKey = keyStore.get(provider.apiKeyRef)
    const selectedText = input.selectedText?.trim() || null
    const explicitSelectedAnnotationRequest =
      Boolean(selectedText) && hasExplicitAnnotationIntent(input.message)
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
      provider.supportsLongContext ? 12 : 5
    )
    const recentMessages = database.getRecentAIChatMessages(
      input.conversationId,
      provider.supportsLongContext ? 32 : 12
    )
    const contextMessage = context.length
      ? context
          .map(
            (chunk, index) =>
              `[${index + 1}] 第 ${chunk.pageNumber} 页，片段 ${chunk.chunkIndex + 1}\n${chunk.text}`
          )
          .join('\n\n')
      : '没有可用的文档片段。'
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `你是 Reading Partner，一个和用户一起阅读 PDF 文献的中文共读伙伴。当前阅读位置是第 ${input.pageNumber} 页；用户未明确指定其它页时，“这里”“当前页”“这段”“总结一下”等指代都按第 ${input.pageNumber} 页理解。结合对话历史、用户当前选区和文档片段回答。回答要具体、克制；引用文档内容时标注“第 X 页”；信息不足时直接说明缺口。不要输出隐藏推理或思维链，只输出最终回答。`
      },
      {
        role: 'user',
        content: `当前阅读位置：第 ${input.pageNumber} 页。\n本轮可用文档片段（当前页片段优先，其它页仅作补充）：\n${contextMessage}`
      },
      ...(explicitSelectedAnnotationRequest && selectedText
        ? [
            {
              role: 'user' as const,
              content: buildExplicitSelectedAnnotationPrompt(input.pageNumber, selectedText)
            }
          ]
        : []),
      ...recentMessages.map<ChatMessage>((message) => ({
        role: message.role,
        content:
          message.role === 'user' && message.selectedText
            ? `${message.content}\n\n用户当时选中的原文（第 ${message.pageNumber ?? input.pageNumber} 页）：\n${message.selectedText}`
            : message.content
      }))
    ]
    const systemMessage = messages[0]

    if (systemMessage) {
      systemMessage.content = `${systemMessage.content}\n\n${aiAnnotationCapabilityPrompt}`
    }

    for (const message of messages) {
      if (message.role === 'assistant') {
        message.content = stripAIControlDirectives(message.content)
      }
    }

    const sendEvent = (payload: AIStreamEvent): void => {
      event.sender.send('ai:streamEvent', payload)
    }
    const controller = createAIRequestController(input.requestId)

    try {
      await runOpenAICompatibleChatCompletion({
        requestId: input.requestId,
        provider,
        apiKey,
        messages,
        signal: controller.signal,
        onEvent: sendEvent,
        saveArtifact: (output) => {
          const artifact = database.createAIArtifact({
            documentId: input.documentId,
            providerId: provider.id,
            model: provider.defaultModel,
            promptType: 'chat_document',
            inputText: input.message,
            outputMarkdown: output,
            pageNumber: input.pageNumber
          })

          database.createAIChatMessage({
            conversationId: input.conversationId,
            role: 'assistant',
            content: stripAIAnnotationDirectives(output),
            pageNumber: input.pageNumber,
            providerId: provider.id,
            model: provider.defaultModel,
            artifactId: artifact.id
          })

          return artifact
        }
      })
    } catch (error) {
      sendEvent({
        requestId: input.requestId,
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      releaseAIRequestController(input.requestId, controller)
    }
  })
}

app.whenReady().then(() => {
  keyStore = new KeyStore(join(app.getPath('userData'), 'secrets.json'))

  void ReadingPartnerDatabase.open(join(app.getPath('userData'), 'reading-partner.sqlite')).then(
    (store) => {
      database = store
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
      createWindow()
    }
  )

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
    closeStarDictSources()
    return
  }

  event.preventDefault()

  if (isPreparingToQuit) {
    return
  }

  if (!database) {
    closeStarDictSources()
    isReadyToQuit = true
    app.quit()
    return
  }

  isPreparingToQuit = true
  void database
    .flush()
    .catch((error) => {
      console.error('Failed to flush Reading Partner database before quit', error)
    })
    .finally(() => {
      closeStarDictSources()
      isReadyToQuit = true
      app.quit()
    })
})
