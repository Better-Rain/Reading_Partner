import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ChatMessage,
  runOpenAICompatibleChatCompletion,
  runOpenAICompatibleCompletion
} from './ai'
import { ReadingPartnerDatabase } from './database'
import { parseDictionaryCsv } from './dictionaryImport'
import { KeyStore } from './keyStore'
import { extractPdfText } from './pdfText'
import { resolveStarDictIfoPath, StarDictSource } from './stardict'
import {
  AIStreamEvent,
  AskDocumentQuestionInput,
  CreateAnnotationInput,
  CreateVocabularyInput,
  RunAIChatInput,
  RunAIActionInput,
  UpdateVocabularyDefinitionInput,
  UpsertAIProviderInput
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let database: ReadingPartnerDatabase
let keyStore: KeyStore
const starDictSources = new Map<string, StarDictSource>()

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1320,
    minHeight: 720,
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
  ipcMain.handle('documents:list', () => database.listDocuments())

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

  ipcMain.handle('documents:indexText', async (_event, documentId: string) => {
    const document = database.getDocument(documentId)
    const currentStatus = database.getDocumentTextIndexStatus(documentId)

    if (
      currentStatus.pageCount &&
      currentStatus.pagesIndexed >= currentStatus.pageCount
    ) {
      return {
        ...currentStatus,
        skipped: true
      }
    }

    const extracted = await extractPdfText(document.filePath)
    return database.replaceDocumentTextIndex({
      documentId,
      pageCount: extracted.pageCount,
      pages: extracted.pages,
      chunks: extracted.chunks
    })
  })

  ipcMain.handle('documents:searchText', (_event, documentId: string, query: string) =>
    database.searchDocumentText(documentId, query)
  )

  ipcMain.handle('annotations:list', (_event, documentId: string) =>
    database.listAnnotations(documentId)
  )

  ipcMain.handle('annotations:create', (_event, input: CreateAnnotationInput) =>
    database.createAnnotation(input)
  )

  ipcMain.handle('annotations:delete', (_event, id: string) => {
    database.deleteAnnotation(id)
  })

  ipcMain.handle('vocabulary:list', (_event, documentId?: string | null) =>
    database.listVocabulary(documentId)
  )

  ipcMain.handle('vocabulary:create', (_event, input: CreateVocabularyInput) =>
    database.createVocabulary(input)
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

  ipcMain.handle('ai:chatMessages', (_event, conversationId: string) =>
    database.listAIChatMessages(conversationId)
  )

  ipcMain.handle('ai:runAction', async (event, input: RunAIActionInput) => {
    const provider = database.getAIProvider(input.providerId)
    const apiKey = keyStore.get(provider.apiKeyRef)
    const sendEvent = (payload: AIStreamEvent): void => {
      event.sender.send('ai:streamEvent', payload)
    }

    try {
      await runOpenAICompatibleCompletion({
        input,
        provider,
        apiKey,
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
    }
  })

  ipcMain.handle('ai:askDocument', async (event, input: AskDocumentQuestionInput) => {
    const provider = database.getAIProvider(input.providerId)
    const apiKey = keyStore.get(provider.apiKeyRef)
    const context = database.getRelevantDocumentChunks(
      input.documentId,
      input.question,
      input.pageNumber
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
      5
    )
    const recentMessages = database.getRecentAIChatMessages(input.conversationId, 12)
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
          '你是 Reading Partner，一个和用户一起阅读 PDF 文献的中文共读伙伴。结合对话历史、用户当前选区和文档片段回答。回答要具体、克制；引用文档内容时标注“第 X 页”；信息不足时直接说明缺口。不要输出隐藏推理或思维链，只输出最终回答。'
      },
      {
        role: 'user',
        content: `本轮可用文档片段：\n${contextMessage}`
      },
      ...recentMessages.map<ChatMessage>((message) => ({
        role: message.role,
        content:
          message.role === 'user' && message.selectedText
            ? `${message.content}\n\n用户当时选中的原文（第 ${message.pageNumber ?? input.pageNumber} 页）：\n${message.selectedText}`
            : message.content
      }))
    ]
    const sendEvent = (payload: AIStreamEvent): void => {
      event.sender.send('ai:streamEvent', payload)
    }

    try {
      await runOpenAICompatibleChatCompletion({
        requestId: input.requestId,
        provider,
        apiKey,
        messages,
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
            content: output,
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
