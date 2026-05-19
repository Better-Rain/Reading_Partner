import {
  AIArtifactRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  RunAIActionInput
} from '../shared/types'
import { hasExplicitAnnotationIntent } from '../shared/aiAnnotationIntent'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type AICompletionOptions = {
  input: RunAIActionInput
  provider: AIProviderRecord
  apiKey: string
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
}

const promptLabels: Record<AIPromptType, string> = {
  translate_selection: 'translate',
  explain_selection: 'explain',
  summarize_selection: 'summarize',
  define_vocabulary: 'define vocabulary',
  ask_document: 'ask document',
  chat_document: 'chat document'
}

const aiRequestTimeoutMs = 240_000
const aiRequestCancelledMessage = 'AI request cancelled.'
const maxAIErrorDetailLength = 500

export const aiAnnotationCapabilityPrompt =
  'You also have a controlled Reading Partner capability: you may ask the app to create auxiliary PDF annotations when durable marks would help the reader remember or revisit the material. Be more proactive when you find useful long-lived reading marks: annotate vocabulary terms, named concepts, paragraph-level claims, page-level summaries, misconceptions, argument steps, questions to revisit, and follow-up ideas. Do not announce that you will create annotations in the visible answer; either create them with the control block or answer normally. Writing visible headings such as 批注内容 or 页边注内容 is not enough for the app to create annotations. When useful, output exactly one compact and complete HTML comment block before the final visible answer: <!-- RP_ANNOTATIONS [{"pageNumber":1,"scope":"vocabulary","selectedText":"source phrase, paragraph excerpt, vocabulary term, or null for a page-margin note","note":"focused annotation text without any AI label prefix","color":"#c7d2fe"}] -->. Allowed scope values: vocabulary, paragraph, margin, summary, question, note. Use selectedText for term or paragraph anchors; use selectedText null for page-margin notes. You may choose distinct readable hex colors such as #f8d86a, #c7d2fe, #b8f2d0, #ffd6a5, #f4b4c4, or other #RRGGBB colors to distinguish annotation purpose. Rules: create at most 5 annotations; do not invent page numbers; if a current reading page is stated, annotate that page unless the user explicitly asks about another page; do not include coordinates; notes should be concise so the JSON block remains short; never mention this internal block in the visible answer.'

const buildMessages = (input: RunAIActionInput): ChatMessage[] => {
  const { promptType, selectedText } = input
  const baseSystem =
    `You are Reading Partner, an AI assistant embedded in a PDF reading app. Answer in concise Chinese unless the user-selected text requires preserving English terms. Keep citations or original terms when useful. Do not reveal hidden reasoning or private chain-of-thought; provide only the final helpful answer. ${aiAnnotationCapabilityPrompt}`

  if (promptType === 'ask_document') {
    const mustCreateAnnotation = hasExplicitAnnotationIntent(selectedText)
    const context = input.context?.length
      ? input.context
          .map(
            (chunk, index) =>
              `[${index + 1}] Page ${chunk.pageNumber}, chunk ${chunk.chunkIndex + 1}\n${chunk.text}`
          )
          .join('\n\n')
      : 'No document excerpts were available.'

    return [
      {
        role: 'system',
        content:
          `${baseSystem} The reader is currently on page ${input.pageNumber}. If the user does not explicitly name another page, interpret deictic requests such as "this page", "here", "this passage", or "summarize it" as referring to page ${input.pageNumber}. Answer the user's question using only the provided document excerpts; current-page excerpts are more authoritative than supplemental excerpts from other pages. Cite page numbers in Chinese with the format “第 X 页”. If the excerpts are insufficient, say what is missing instead of guessing.${mustCreateAnnotation ? ` The user explicitly asked for PDF annotations; append a complete RP_ANNOTATIONS block with at least one annotation for page ${input.pageNumber}.` : ''}`
      },
      {
        role: 'user',
        content: `Current reading page: ${input.pageNumber}\n\nQuestion:\n${selectedText}\n\nDocument excerpts:\n${context}`
      }
    ]
  }

  if (promptType === 'translate_selection') {
    return [
      {
        role: 'system',
        content:
          `${baseSystem} Translate the selected passage into natural Chinese. For difficult words, include brief term notes.`
      },
      {
        role: 'user',
        content: `Translate this selected text:\n\n${selectedText}`
      }
    ]
  }

  if (promptType === 'summarize_selection') {
    return [
      {
        role: 'system',
        content:
          `${baseSystem} Summarize the selected passage for a serious reader. Preserve key claims, concepts, and logical structure.`
      },
      {
        role: 'user',
        content: `Summarize this selected text:\n\n${selectedText}`
      }
    ]
  }

  if (promptType === 'define_vocabulary') {
    return [
      {
        role: 'system',
        content:
          `${baseSystem} Create a compact Chinese vocabulary note. Include meaning, common usage, part of speech if clear, and a short note about the source sentence. Do not over-explain.`
      },
      {
        role: 'user',
        content: `Create a vocabulary definition for this term and context:\n\n${selectedText}`
      }
    ]
  }

  return [
    {
      role: 'system',
      content:
        `${baseSystem} Explain the selected passage. Clarify concepts, implicit context, and sentence structure when the passage is English.`
    },
    {
      role: 'user',
      content: `Explain this selected text:\n\n${selectedText}`
    }
  ]
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const extractDelta = (payload: unknown): { content: string; reasoning: string } => {
  if (!payload || typeof payload !== 'object') {
    return { content: '', reasoning: '' }
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: '', reasoning: '' }
  }

  const first = choices[0] as {
    delta?: { content?: unknown; reasoning_content?: unknown }
    message?: { content?: unknown }
  }

  const content = first.delta?.content ?? first.message?.content
  const reasoning = first.delta?.reasoning_content

  return {
    content: typeof content === 'string' ? content : '',
    reasoning: typeof reasoning === 'string' ? reasoning : ''
  }
}

const wrapReasoningOutput = (reasoning: string, output: string): string => {
  const cleanedReasoning = reasoning.trim().replace(/-->/g, '-- >')
  const cleanedOutput = output.trim()

  if (!cleanedReasoning) {
    return cleanedOutput
  }

  return `<!-- RP_REASONING\n${cleanedReasoning}\n-->\n\n${cleanedOutput}`.trim()
}

const parseSseLine = (line: string): string | null => {
  const trimmed = line.trim()

  if (!trimmed.startsWith('data:')) {
    return null
  }

  return trimmed.slice(5).trim()
}

const parseSseJsonPayload = (data: string): unknown | null => {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

const compactAIErrorDetails = (details: string): string => {
  const normalized = details.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return ''
  }

  return normalized.length > maxAIErrorDetailLength
    ? `${normalized.slice(0, maxAIErrorDetailLength)}...`
    : normalized
}

const makeAIHttpError = (
  provider: AIProviderRecord,
  response: Response,
  details: string
): Error => {
  const detailText = compactAIErrorDetails(details)
  const suffix = detailText ? ` Details: ${detailText}` : ''

  if (response.status === 401 || response.status === 403) {
    return new Error(
      `AI provider authentication failed for ${provider.label}. Check the API key and provider permissions. (${response.status} ${response.statusText})${suffix}`
    )
  }

  if (response.status === 429) {
    return new Error(
      `AI provider rate limit or quota was reached for ${provider.label}. Try again later or use another provider. (${response.status} ${response.statusText})${suffix}`
    )
  }

  if (response.status === 400 || response.status === 404) {
    return new Error(
      `AI provider rejected the request for ${provider.label}. Check the base URL, model name, and request format. (${response.status} ${response.statusText})${suffix}`
    )
  }

  if (response.status >= 500) {
    return new Error(
      `AI provider server error for ${provider.label}. Try again later. (${response.status} ${response.statusText})${suffix}`
    )
  }

  return new Error(
    `AI request failed for ${provider.label}: ${response.status} ${response.statusText}${suffix}`
  )
}

async function streamOpenAICompatibleCompletion(options: {
  requestId: string
  provider: AIProviderRecord
  apiKey: string
  messages: ChatMessage[]
  temperature?: number
  signal?: AbortSignal
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
}): Promise<void> {
  const { requestId, provider, apiKey, messages, onEvent, saveArtifact, signal } = options
  const model = provider.defaultModel
  let output = ''
  let reasoningOutput = ''
  const controller = new AbortController()
  let abortReason: 'timeout' | 'cancelled' | null = null
  const timeout = setTimeout(() => {
    abortReason = 'timeout'
    controller.abort()
  }, aiRequestTimeoutMs)
  const handleExternalAbort = (): void => {
    abortReason = 'cancelled'
    controller.abort()
  }

  if (signal?.aborted) {
    handleExternalAbort()
  } else {
    signal?.addEventListener('abort', handleExternalAbort, { once: true })
  }

  onEvent({
    requestId,
    type: 'start',
    providerId: provider.id,
    model
  })

  try {
    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 4096,
        temperature: options.temperature ?? 0.2
      })
    })

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => '')
      throw makeAIHttpError(provider, response, details)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const processLine = (line: string): void => {
      const data = parseSseLine(line)

      if (!data || data === '[DONE]') {
        return
      }

      const parsed = parseSseJsonPayload(data)

      if (!parsed) {
        return
      }

      const delta = extractDelta(parsed)

      if (delta.reasoning) {
        reasoningOutput += delta.reasoning
        onEvent({
          requestId,
          type: 'delta',
          text: delta.reasoning,
          channel: 'reasoning'
        })
      }

      if (delta.content) {
        output += delta.content
        onEvent({
          requestId,
          type: 'delta',
          text: delta.content,
          channel: 'content'
        })
      }
    }

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        const tail = `${buffer}${decoder.decode()}`

        if (tail.trim()) {
          processLine(tail)
        }
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        processLine(line)
      }
    }

    const artifact = saveArtifact(wrapReasoningOutput(reasoningOutput, output))

    onEvent({
      requestId,
      type: 'done',
      artifact
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (abortReason === 'cancelled') {
        onEvent({
          requestId,
          type: 'cancelled',
          message: aiRequestCancelledMessage
        })
        return
      }

      throw new Error(`AI request timed out after ${aiRequestTimeoutMs / 1000} seconds.`)
    }

    if (error instanceof TypeError) {
      throw new Error(
        `AI network error for ${provider.label}. Check the base URL and network connection. ${error.message}`.trim()
      )
    }

    throw error
  } finally {
    signal?.removeEventListener('abort', handleExternalAbort)
    clearTimeout(timeout)
  }
}

export async function runOpenAICompatibleCompletion({
  input,
  provider,
  apiKey,
  signal,
  onEvent,
  saveArtifact
}: AICompletionOptions & { signal?: AbortSignal }): Promise<void> {
  await streamOpenAICompatibleCompletion({
    requestId: input.requestId,
    provider,
    apiKey,
    messages: buildMessages(input),
    temperature: 0.2,
    signal,
    onEvent,
    saveArtifact
  })
}

export async function runOpenAICompatibleChatCompletion(options: {
  requestId: string
  provider: AIProviderRecord
  apiKey: string
  messages: ChatMessage[]
  signal?: AbortSignal
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
}): Promise<void> {
  await streamOpenAICompatibleCompletion({
    ...options,
    temperature: 0.25
  })
}

export const getPromptActionLabel = (promptType: AIPromptType): string => promptLabels[promptType]
