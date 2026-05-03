import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runOpenAICompatibleCompletion } from './ai'
import { ReadingPartnerDatabase } from './database'
import { KeyStore } from './keyStore'
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
