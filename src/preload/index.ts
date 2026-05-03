import { contextBridge, ipcRenderer } from 'electron'
import {
  AIStreamEvent,
  CreateAnnotationInput,
  CreateVocabularyInput,
  ReadingPartnerApi,
  RunAIActionInput,
  UpsertAIProviderInput
} from '../shared/types'

const api: ReadingPartnerApi = {
  openPdfDialog: () => ipcRenderer.invoke('documents:openPdfDialog'),
  readPdf: (documentId: string) => ipcRenderer.invoke('documents:readPdf', documentId),
  listDocuments: () => ipcRenderer.invoke('documents:list'),
  listAnnotations: (documentId: string) => ipcRenderer.invoke('annotations:list', documentId),
  createAnnotation: (input: CreateAnnotationInput) =>
    ipcRenderer.invoke('annotations:create', input),
  deleteAnnotation: (id: string) => ipcRenderer.invoke('annotations:delete', id),
  listVocabulary: (documentId?: string | null) => ipcRenderer.invoke('vocabulary:list', documentId),
  createVocabulary: (input: CreateVocabularyInput) =>
    ipcRenderer.invoke('vocabulary:create', input),
  deleteVocabulary: (id: string) => ipcRenderer.invoke('vocabulary:delete', id),
  listAIProviders: () => ipcRenderer.invoke('aiProviders:list'),
  upsertAIProvider: (input: UpsertAIProviderInput) =>
    ipcRenderer.invoke('aiProviders:upsert', input),
  setAIProviderApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke('aiProviders:setApiKey', providerId, apiKey),
  clearAIProviderApiKey: (providerId: string) =>
    ipcRenderer.invoke('aiProviders:clearApiKey', providerId),
  listAIProviderKeyStatus: () => ipcRenderer.invoke('aiProviders:keyStatus'),
  runAIAction: (input: RunAIActionInput) => ipcRenderer.invoke('ai:runAction', input),
  onAIStreamEvent: (callback: (event: AIStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AIStreamEvent): void => {
      callback(payload)
    }

    ipcRenderer.on('ai:streamEvent', listener)
    return () => {
      ipcRenderer.removeListener('ai:streamEvent', listener)
    }
  }
}

contextBridge.exposeInMainWorld('readingPartner', api)
