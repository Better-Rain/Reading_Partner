import { contextBridge, ipcRenderer } from 'electron'
import {
  AIStreamEvent,
  AnnotationRecord,
  AskDocumentQuestionInput,
  CreateAnnotationInput,
  CreateVocabularyInput,
  DocumentTextIndexEvent,
  OcrPageTextInput,
  ReadingPartnerApi,
  RunAIChatInput,
  RunAIActionInput,
  UpdateAnnotationInput,
  UpdateAIConversationTitleInput,
  UpdateVocabularyDefinitionInput,
  UpsertAIProviderInput
} from '../shared/types'

const api: ReadingPartnerApi = {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  openPdfDialog: () => ipcRenderer.invoke('documents:openPdfDialog'),
  readPdf: (documentId: string) => ipcRenderer.invoke('documents:readPdf', documentId),
  listDocuments: () => ipcRenderer.invoke('documents:list'),
  saveDocumentProgress: (documentId: string, pageNumber: number) =>
    ipcRenderer.invoke('documents:saveProgress', documentId, pageNumber),
  getDocumentTextIndexStatus: (documentId: string) =>
    ipcRenderer.invoke('documents:textIndexStatus', documentId),
  indexDocumentText: (documentId: string) => ipcRenderer.invoke('documents:indexText', documentId),
  ocrPageText: (input: OcrPageTextInput) =>
    ipcRenderer.invoke('documents:ocrPageText', input),
  getDocumentPageOcrLayout: (documentId: string, pageNumber: number) =>
    ipcRenderer.invoke('documents:pageOcrLayout', documentId, pageNumber),
  cancelDocumentTextIndex: (documentId: string) =>
    ipcRenderer.invoke('documents:cancelTextIndex', documentId),
  onDocumentTextIndexEvent: (callback: (event: DocumentTextIndexEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DocumentTextIndexEvent): void => {
      callback(payload)
    }

    ipcRenderer.on('documents:textIndexEvent', listener)
    return () => {
      ipcRenderer.removeListener('documents:textIndexEvent', listener)
    }
  },
  searchDocumentText: (documentId: string, query: string) =>
    ipcRenderer.invoke('documents:searchText', documentId, query),
  listAnnotations: (documentId: string) => ipcRenderer.invoke('annotations:list', documentId),
  createAnnotation: (input: CreateAnnotationInput) =>
    ipcRenderer.invoke('annotations:create', input),
  updateAnnotation: (input: UpdateAnnotationInput) =>
    ipcRenderer.invoke('annotations:update', input),
  deleteAnnotation: (id: string) => ipcRenderer.invoke('annotations:delete', id),
  restoreAnnotation: (annotation: AnnotationRecord) =>
    ipcRenderer.invoke('annotations:restore', annotation),
  exportReadingMarksDialog: (documentId: string) =>
    ipcRenderer.invoke('readingMarks:exportDialog', documentId),
  importReadingMarksDialog: (documentId: string) =>
    ipcRenderer.invoke('readingMarks:importDialog', documentId),
  listVocabulary: (documentId?: string | null) => ipcRenderer.invoke('vocabulary:list', documentId),
  createVocabulary: (input: CreateVocabularyInput) =>
    ipcRenderer.invoke('vocabulary:create', input),
  linkVocabularyAnnotation: (vocabularyId: string, annotationId: string) =>
    ipcRenderer.invoke('vocabulary:linkAnnotation', vocabularyId, annotationId),
  updateVocabularyDefinition: (input: UpdateVocabularyDefinitionInput) =>
    ipcRenderer.invoke('vocabulary:updateDefinition', input),
  deleteVocabulary: (id: string) => ipcRenderer.invoke('vocabulary:delete', id),
  lookupDictionary: (query: string) => ipcRenderer.invoke('dictionary:lookup', query),
  suggestDictionary: (query: string, limit?: number) =>
    ipcRenderer.invoke('dictionary:suggest', query, limit),
  listDictionarySources: () => ipcRenderer.invoke('dictionary:sources'),
  importDictionaryCsvDialog: () => ipcRenderer.invoke('dictionary:importCsvDialog'),
  listAIProviders: () => ipcRenderer.invoke('aiProviders:list'),
  upsertAIProvider: (input: UpsertAIProviderInput) =>
    ipcRenderer.invoke('aiProviders:upsert', input),
  setAIProviderApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke('aiProviders:setApiKey', providerId, apiKey),
  clearAIProviderApiKey: (providerId: string) =>
    ipcRenderer.invoke('aiProviders:clearApiKey', providerId),
  listAIProviderKeyStatus: () => ipcRenderer.invoke('aiProviders:keyStatus'),
  runAIAction: (input: RunAIActionInput) => ipcRenderer.invoke('ai:runAction', input),
  askDocumentQuestion: (input: AskDocumentQuestionInput) =>
    ipcRenderer.invoke('ai:askDocument', input),
  cancelAIRequest: (requestId: string) => ipcRenderer.invoke('ai:cancelRequest', requestId),
  listAIConversations: (documentId: string) => ipcRenderer.invoke('ai:conversations', documentId),
  createAIConversation: (documentId: string, title?: string | null) =>
    ipcRenderer.invoke('ai:createConversation', documentId, title),
  updateAIConversationTitle: (input: UpdateAIConversationTitleInput) =>
    ipcRenderer.invoke('ai:updateConversationTitle', input),
  listAIChatMessages: (conversationId: string) =>
    ipcRenderer.invoke('ai:chatMessages', conversationId),
  runAIChat: (input: RunAIChatInput) => ipcRenderer.invoke('ai:runChat', input),
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
