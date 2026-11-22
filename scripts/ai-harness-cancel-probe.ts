import { createServer } from 'node:http'
import {
  runOpenAICompatibleCompletion,
  type ChatMessage
} from '../src/main/ai'
import type { AIArtifactRecord, AIProviderRecord, AIStreamEvent } from '../src/shared/types'

const provider: AIProviderRecord = {
  id: 'cancel-probe',
  label: 'cancel probe',
  baseUrl: '',
  defaultModel: 'probe-model',
  apiKeyRef: null,
  supportsThinking: false,
  supportsLongContext: false,
  enabled: true,
  updatedAt: new Date().toISOString()
}

const input = {
  requestId: `cancel-probe-${Date.now()}`,
  providerId: provider.id,
  documentId: 'probe-document',
  pageNumber: 1,
  promptType: 'ask_document' as const,
  selectedText: 'probe'
}

const saveArtifact = (outputMarkdown: string): AIArtifactRecord => ({
  id: 'probe-artifact',
  documentId: input.documentId,
  annotationId: null,
  providerId: provider.id,
  model: provider.defaultModel,
  promptType: input.promptType,
  inputText: input.selectedText,
  outputMarkdown,
  pageNumber: input.pageNumber,
  createdAt: new Date().toISOString()
})

const messages: ChatMessage[] = [
  { role: 'system', content: '只输出简短回答。' },
  { role: 'user', content: 'probe' }
]

const main = async (): Promise<void> => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache'
    })
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '部分输出' } }] })}\n\n`)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Probe server did not expose a TCP port.')
  }

  provider.baseUrl = `http://127.0.0.1:${address.port}`
  const controller = new AbortController()
  const events: AIStreamEvent[] = []
  const completion = runOpenAICompatibleCompletion({
    input,
    provider,
    apiKey: 'probe-key',
    messages,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
    saveArtifact
  })

  setTimeout(() => controller.abort(), 120).unref()
  await completion
  await new Promise<void>((resolve) => server.close(() => resolve()))

  const delta = events.find(
    (event): event is Extract<AIStreamEvent, { type: 'delta' }> => event.type === 'delta'
  )
  const cancelled = events.find((event) => event.type === 'cancelled')

  if (!delta?.text.includes('部分输出') || !cancelled) {
    throw new Error(`Expected partial output and cancellation, got ${events.map((event) => event.type).join('>')}.`)
  }

  console.log(`EVENTS ${events.map((event) => event.type).join('>')}`)
  console.log(`PARTIAL ${delta.text}`)
  console.log('CANCELLED yes')
}

void main().catch((error) => {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
