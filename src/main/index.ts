import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ReadingPartnerDatabase } from './database'
import { CreateAnnotationInput, UpsertAIProviderInput } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let database: ReadingPartnerDatabase

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

  ipcMain.handle('aiProviders:list', () => database.listAIProviders())

  ipcMain.handle('aiProviders:upsert', (_event, input: UpsertAIProviderInput) =>
    database.upsertAIProvider(input)
  )
}

app.whenReady().then(() => {
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
