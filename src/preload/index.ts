import { contextBridge, ipcRenderer } from 'electron'
import {
  CreateAnnotationInput,
  ReadingPartnerApi,
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
  listAIProviders: () => ipcRenderer.invoke('aiProviders:list'),
  upsertAIProvider: (input: UpsertAIProviderInput) =>
    ipcRenderer.invoke('aiProviders:upsert', input)
}

contextBridge.exposeInMainWorld('readingPartner', api)

