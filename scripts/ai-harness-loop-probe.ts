import {
  runOpenAICompatibleChatCompletion,
  type AIChatToolDefinition
} from '../src/main/ai'
import type { AIArtifactRecord, AIProviderRecord, AIStreamEvent } from '../src/shared/types'

const requestId = `probe-${Date.now()}`
const provider: AIProviderRecord = {
  id: 'local-hub',
  label: '本地 LLM Hub',
  baseUrl: process.env.READING_PARTNER_AI_BASE_URL ?? 'http://127.0.0.1:18080/v1',
  defaultModel: process.env.READING_PARTNER_AI_MODEL ?? 'qwen-local',
  apiKeyRef: null,
  supportsThinking: false,
  supportsLongContext: true,
  enabled: true,
  updatedAt: new Date().toISOString()
}

const tool: AIChatToolDefinition = {
  type: 'function',
  function: {
    name: 'create_annotations',
    description: 'Create a candidate PDF note, then wait for the tool result before answering.',
    parameters: {
      type: 'object',
      properties: {
        annotations: {
          type: 'array',
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              pageNumber: { type: 'integer', minimum: 1 },
              scope: { type: 'string' },
              selectedText: { type: ['string', 'null'] },
              note: { type: 'string', minLength: 1 }
            },
            required: ['pageNumber', 'scope', 'selectedText', 'note'],
            additionalProperties: false
          }
        }
      },
      required: ['annotations'],
      additionalProperties: false
    }
  }
}

const messages = [
  {
    role: 'system' as const,
    content:
      '你是 Reading Partner。用户明确要求你先调用 create_annotations，为第 12 页创建一条简洁批注。调用完成后，必须读取工具结果，再用一句中文确认批注已提交。不要输出工具协议。'
  },
  { role: 'user' as const, content: '请为这段关于制度变迁的论述做一条批注。' }
]

const main = async (): Promise<void> => {
  const events: AIStreamEvent[] = []
  let toolCallCount = 0
  let toolResultCount = 0
  let savedArtifact: AIArtifactRecord | null = null

  await runOpenAICompatibleChatCompletion({
    requestId,
    provider,
    apiKey: process.env.READING_PARTNER_AI_KEY ?? 'local-only',
    messages,
    tools: [tool],
    onEvent: (event) => events.push(event),
    onToolCall: async (call) => {
      toolCallCount += 1
      const args = JSON.parse(call.arguments) as { annotations?: unknown[] }
      toolResultCount += 1
      return JSON.stringify({
        ok: true,
        created: Array.isArray(args.annotations) ? args.annotations.length : 0,
        annotationIds: ['probe-annotation']
      })
    },
    saveArtifact: (output) => {
      savedArtifact = {
        id: 'probe-artifact',
        documentId: 'probe-document',
        annotationId: null,
        providerId: provider.id,
        model: provider.defaultModel,
        promptType: 'chat_document',
        inputText: messages[1].content,
        outputMarkdown: output,
        pageNumber: 12,
        createdAt: new Date().toISOString()
      }
      return savedArtifact
    }
  })

  const done = events.find((event): event is Extract<AIStreamEvent, { type: 'done' }> => event.type === 'done')
  const statusPhases = events
    .filter((event): event is Extract<AIStreamEvent, { type: 'status' }> => event.type === 'status')
    .map((event) => event.phase)

  if (toolCallCount < 1 || toolResultCount < 1) {
    throw new Error(`Expected a tool call and tool result, got ${toolCallCount}/${toolResultCount}.`)
  }
  if (!done || !savedArtifact?.outputMarkdown.trim()) {
    throw new Error('Expected a final artifact after the tool result.')
  }

  console.log(`MODEL ${provider.defaultModel}`)
  console.log(`TOOL_CALLS ${toolCallCount}`)
  console.log(`TOOL_RESULTS ${toolResultCount}`)
  console.log(`STATUS_PHASES ${statusPhases.join('>')}`)
  console.log(`FINAL ${savedArtifact.outputMarkdown.replace(/\s+/g, ' ').trim()}`)
}

void main()
