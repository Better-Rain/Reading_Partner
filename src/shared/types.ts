export type AnnotationType = 'highlight' | 'note' | 'bookmark'
export type AIPromptType =
  | 'translate_selection'
  | 'explain_selection'
  | 'summarize_selection'
  | 'define_vocabulary'
  | 'ask_document'
  | 'chat_document'

export type DocumentRecord = {
  id: string
  title: string
  filePath: string
  fileSize: number
  pageCount: number | null
  createdAt: string
  lastOpenedAt: string
}

export type DocumentTextIndexStatus = {
  documentId: string
  pageCount: number | null
  pagesIndexed: number
  chunksIndexed: number
  indexedAt: string | null
}

export type DocumentTextIndexResult = DocumentTextIndexStatus & {
  skipped: boolean
}

export type DocumentSearchResult = {
  id: string
  documentId: string
  pageNumber: number
  chunkIndex: number
  text: string
  snippet: string
  score: number
}

export type DocumentQuestionContext = {
  id: string
  documentId: string
  pageNumber: number
  chunkIndex: number
  text: string
  score: number
}

export type AnnotationRecord = {
  id: string
  documentId: string
  type: AnnotationType
  pageNumber: number
  selectedText: string | null
  color: string | null
  note: string | null
  rectsJson: string | null
  authorName: string
  createdAt: string
  updatedAt: string
}

export type CreateAnnotationInput = {
  documentId: string
  type: AnnotationType
  pageNumber: number
  selectedText?: string | null
  color?: string | null
  note?: string | null
  rectsJson?: string | null
  authorName?: string | null
}

export type UpdateAnnotationInput = {
  id: string
  note?: string | null
  color?: string | null
}

export type AIProviderRecord = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  apiKeyRef: string | null
  supportsThinking: boolean
  supportsLongContext: boolean
  enabled: boolean
  updatedAt: string
}

export type AIArtifactRecord = {
  id: string
  documentId: string
  annotationId: string | null
  providerId: string
  model: string
  promptType: AIPromptType
  inputText: string
  outputMarkdown: string
  pageNumber: number | null
  createdAt: string
}

export type AIConversationRecord = {
  id: string
  documentId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type UpdateAIConversationTitleInput = {
  id: string
  title: string
}

export type AIChatMessageRole = 'user' | 'assistant'

export type AIChatMessageRecord = {
  id: string
  conversationId: string
  role: AIChatMessageRole
  content: string
  selectedText: string | null
  pageNumber: number | null
  providerId: string | null
  model: string | null
  artifactId: string | null
  createdAt: string
}

export type VocabularyRecord = {
  id: string
  documentId: string | null
  word: string
  definition: string
  sourceSentence: string | null
  pageNumber: number | null
  createdAt: string
}

export type CreateVocabularyInput = {
  documentId?: string | null
  word: string
  definition: string
  sourceSentence?: string | null
  pageNumber?: number | null
}

export type UpdateVocabularyDefinitionInput = {
  id: string
  definition: string
}

export type DictionaryEntryRecord = {
  id: string
  word: string
  phonetic: string | null
  definition: string | null
  translation: string | null
  pos: string | null
  exchange: string | null
  source: string
  updatedAt: string
}

export type DictionaryLookupResult = {
  query: string
  entry: DictionaryEntryRecord | null
}

export type DictionarySuggestionResult = {
  query: string
  entries: DictionaryEntryRecord[]
}

export type DictionarySourceRecord = {
  id: string
  type: 'csv' | 'stardict'
  label: string
  path: string
  entryCount: number | null
  createdAt: string
}

export type ImportDictionaryResult = {
  imported: number
  skipped: number
  sourcePath: string
  sourceType: 'csv' | 'stardict'
}

export type ReadingMarkBundleAnnotation = {
  id: string
  type: AnnotationType
  pageNumber: number
  selectedText: string | null
  color: string | null
  note: string | null
  rectsJson: string | null
  authorName: string
  createdAt: string
  updatedAt: string
}

export type ReadingMarkBundle = {
  version: 1
  exportedAt: string
  sourceDocument: {
    title: string
    pageCount: number | null
  }
  annotations: ReadingMarkBundleAnnotation[]
}

export type ReadingMarkTransferResult = {
  filePath: string
  annotationCount: number
}

export type UpsertAIProviderInput = {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
  apiKeyRef?: string | null
  supportsThinking?: boolean
  supportsLongContext?: boolean
  enabled?: boolean
}

export type OpenPdfResult = {
  document: DocumentRecord
  data: ArrayBuffer
}

export type ProviderKeyStatus = {
  providerId: string
  configured: boolean
}

export type RunAIActionInput = {
  requestId: string
  providerId: string
  documentId: string
  pageNumber: number
  promptType: AIPromptType
  selectedText: string
  context?: DocumentQuestionContext[]
}

export type AskDocumentQuestionInput = {
  requestId: string
  providerId: string
  documentId: string
  pageNumber: number
  question: string
}

export type RunAIChatInput = {
  requestId: string
  providerId: string
  conversationId: string
  documentId: string
  pageNumber: number
  message: string
  selectedText?: string | null
}

export type AIStreamEvent =
  | {
      requestId: string
      type: 'start'
      providerId: string
      model: string
    }
  | {
      requestId: string
      type: 'delta'
      text: string
    }
  | {
      requestId: string
      type: 'done'
      artifact: AIArtifactRecord
    }
  | {
      requestId: string
      type: 'error'
      message: string
    }

export type ReadingPartnerApi = {
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<void>
  openPdfDialog: () => Promise<OpenPdfResult | null>
  readPdf: (documentId: string) => Promise<ArrayBuffer>
  listDocuments: () => Promise<DocumentRecord[]>
  getDocumentTextIndexStatus: (documentId: string) => Promise<DocumentTextIndexStatus>
  indexDocumentText: (documentId: string) => Promise<DocumentTextIndexResult>
  searchDocumentText: (documentId: string, query: string) => Promise<DocumentSearchResult[]>
  listAnnotations: (documentId: string) => Promise<AnnotationRecord[]>
  createAnnotation: (input: CreateAnnotationInput) => Promise<AnnotationRecord>
  updateAnnotation: (input: UpdateAnnotationInput) => Promise<AnnotationRecord>
  deleteAnnotation: (id: string) => Promise<void>
  restoreAnnotation: (annotation: AnnotationRecord) => Promise<AnnotationRecord>
  exportReadingMarksDialog: (documentId: string) => Promise<ReadingMarkTransferResult | null>
  importReadingMarksDialog: (documentId: string) => Promise<ReadingMarkTransferResult | null>
  listVocabulary: (documentId?: string | null) => Promise<VocabularyRecord[]>
  createVocabulary: (input: CreateVocabularyInput) => Promise<VocabularyRecord>
  updateVocabularyDefinition: (
    input: UpdateVocabularyDefinitionInput
  ) => Promise<VocabularyRecord>
  deleteVocabulary: (id: string) => Promise<void>
  lookupDictionary: (query: string) => Promise<DictionaryLookupResult>
  suggestDictionary: (query: string, limit?: number) => Promise<DictionarySuggestionResult>
  listDictionarySources: () => Promise<DictionarySourceRecord[]>
  importDictionaryCsvDialog: () => Promise<ImportDictionaryResult | null>
  listAIProviders: () => Promise<AIProviderRecord[]>
  upsertAIProvider: (input: UpsertAIProviderInput) => Promise<AIProviderRecord>
  setAIProviderApiKey: (providerId: string, apiKey: string) => Promise<AIProviderRecord>
  clearAIProviderApiKey: (providerId: string) => Promise<AIProviderRecord>
  listAIProviderKeyStatus: () => Promise<ProviderKeyStatus[]>
  runAIAction: (input: RunAIActionInput) => Promise<void>
  askDocumentQuestion: (input: AskDocumentQuestionInput) => Promise<void>
  listAIConversations: (documentId: string) => Promise<AIConversationRecord[]>
  createAIConversation: (
    documentId: string,
    title?: string | null
  ) => Promise<AIConversationRecord>
  updateAIConversationTitle: (
    input: UpdateAIConversationTitleInput
  ) => Promise<AIConversationRecord>
  listAIChatMessages: (conversationId: string) => Promise<AIChatMessageRecord[]>
  runAIChat: (input: RunAIChatInput) => Promise<void>
  onAIStreamEvent: (callback: (event: AIStreamEvent) => void) => () => void
}
