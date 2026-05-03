export type AnnotationType = 'highlight' | 'note' | 'bookmark'
export type AIPromptType = 'translate_selection' | 'explain_selection' | 'summarize_selection'

export type DocumentRecord = {
  id: string
  title: string
  filePath: string
  fileSize: number
  pageCount: number | null
  createdAt: string
  lastOpenedAt: string
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
  openPdfDialog: () => Promise<OpenPdfResult | null>
  readPdf: (documentId: string) => Promise<ArrayBuffer>
  listDocuments: () => Promise<DocumentRecord[]>
  listAnnotations: (documentId: string) => Promise<AnnotationRecord[]>
  createAnnotation: (input: CreateAnnotationInput) => Promise<AnnotationRecord>
  deleteAnnotation: (id: string) => Promise<void>
  listVocabulary: (documentId?: string | null) => Promise<VocabularyRecord[]>
  createVocabulary: (input: CreateVocabularyInput) => Promise<VocabularyRecord>
  deleteVocabulary: (id: string) => Promise<void>
  listAIProviders: () => Promise<AIProviderRecord[]>
  upsertAIProvider: (input: UpsertAIProviderInput) => Promise<AIProviderRecord>
  setAIProviderApiKey: (providerId: string, apiKey: string) => Promise<AIProviderRecord>
  clearAIProviderApiKey: (providerId: string) => Promise<AIProviderRecord>
  listAIProviderKeyStatus: () => Promise<ProviderKeyStatus[]>
  runAIAction: (input: RunAIActionInput) => Promise<void>
  onAIStreamEvent: (callback: (event: AIStreamEvent) => void) => () => void
}
