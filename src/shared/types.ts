export type AnnotationType = 'highlight' | 'note' | 'bookmark'

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

export type ReadingPartnerApi = {
  openPdfDialog: () => Promise<OpenPdfResult | null>
  readPdf: (documentId: string) => Promise<ArrayBuffer>
  listDocuments: () => Promise<DocumentRecord[]>
  listAnnotations: (documentId: string) => Promise<AnnotationRecord[]>
  createAnnotation: (input: CreateAnnotationInput) => Promise<AnnotationRecord>
  deleteAnnotation: (id: string) => Promise<void>
  listAIProviders: () => Promise<AIProviderRecord[]>
  upsertAIProvider: (input: UpsertAIProviderInput) => Promise<AIProviderRecord>
}

