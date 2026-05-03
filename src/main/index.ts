import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runOpenAICompatibleCompletion } from './ai'
import { ReadingPartnerDatabase } from './database'
import { parseDictionaryCsv } from './dictionaryImport'
import { KeyStore } from './keyStore'
import { extractPdfText } from './pdfText'
import { resolveStarDictIfoPath, StarDictSource } from './stardict'
import {
  AIStreamEvent,
  CreateAnnotationInput,
  CreateVocabularyInput,
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
    minWidth: 1100,
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
