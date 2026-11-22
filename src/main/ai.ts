import {
  AIArtifactRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  RunAIActionInput
} from '../shared/types'

export type ChatToolCall = {
  id: string
  name: string
  arguments: string
}

type ChatToolCallWire = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  reasoning_content?: string
  tool_calls?: ChatToolCallWire[]
  tool_call_id?: string
  name?: string
}

export type AIAnnotationToolHandler = (call: ChatToolCall) => Promise<string> | string

type AICompletionOptions = {
  input: RunAIActionInput
  provider: AIProviderRecord
  apiKey: string
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
  tools?: AIChatToolDefinition[]
  finishAfterAnnotations?: boolean
  onToolCall?: AIAnnotationToolHandler
}

export type AIChatToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const promptLabels: Record<AIPromptType, string> = {
  translate_selection: 'translate',
  explain_selection: 'explain',
  summarize_selection: 'summarize',
  define_vocabulary: 'define vocabulary',
  ask_document: 'ask document',
  chat_document: 'chat document'
}

const aiRequestTimeoutMs = 300_000
const aiReadIdleTimeoutMs = 120_000
const aiRequestCancelledMessage = 'AI request cancelled.'
const maxAIErrorDetailLength = 500
const maxToolRounds = 3

export const aiAnnotationCapabilityPrompt =
  'You are allowed to use the Reading Partner function create_annotations for durable PDF notes. Use it only when a note would genuinely help the reader revisit a concept, claim, term, question, or summary. Never put tool protocol in the visible answer. Keep notes concise, use only pages present in the supplied context, and create at most five annotations. If the function is unavailable, you may use one compact legacy block: <!-- RP_ANNOTATIONS [{"pageNumber":1,"scope":"note","selectedText":null,"note":"...","color":"#c7d2fe"}] -->.'

const buildMessages = (input: RunAIActionInput): ChatMessage[] => {
  const { promptType, selectedText } = input
  const baseSystem =
    `You are Reading Partner, an AI assistant embedded in a PDF reading app. Answer in concise Chinese unless preserving English terms is useful. Do not reveal hidden reasoning or private chain-of-thought; provide only a helpful final answer. ${aiAnnotationCapabilityPrompt}`

  if (promptType === 'ask_document') {
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
          `${baseSystem} The reader is currently on page ${input.pageNumber}. Treat vague references such as "this page" or "this passage" as page ${input.pageNumber}. Use only the supplied excerpts, prefer current-page excerpts, cite page numbers as “第 X 页”, and say what is missing instead of guessing.`
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
        content: `${baseSystem} Translate the selected passage into natural Chinese. For difficult words, include brief term notes.`
      },
      { role: 'user', content: `Translate this selected text:\n\n${selectedText}` }
    ]
  }

  if (promptType === 'summarize_selection') {
    return [
      {
        role: 'system',
        content: `${baseSystem} Summarize the selected passage for a serious reader. Preserve key claims, concepts, and logical structure.`
      },
      { role: 'user', content: `Summarize this selected text:\n\n${selectedText}` }
    ]
  }

  if (promptType === 'define_vocabulary') {
    return [
      {
        role: 'system',
        content: `${baseSystem} Create a compact Chinese vocabulary note with meaning, usage, part of speech when clear, and a short source-sentence note.`
      },
      { role: 'user', content: `Create a vocabulary definition for this term and context:\n\n${selectedText}` }
    ]
  }

  return [
    {
      role: 'system',
      content: `${baseSystem} Explain the selected passage. Clarify concepts, implicit context, and sentence structure when the passage is English.`
    },
    { role: 'user', content: `Explain this selected text:\n\n${selectedText}` }
  ]
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const isLocalHub = (baseUrl: string): boolean =>
  /(?:localhost|127\.0\.0\.1):18080(?:\/|$)/i.test(baseUrl)

const getExtraBody = (provider: AIProviderRecord): Record<string, unknown> => {
  if (!isLocalHub(provider.baseUrl)) {
    return {}
  }

  return {
    llm_hub_mode: provider.defaultModel === 'qwen-reason' ? 'thinking' : 'direct'
  }
}

const extractDelta = (payload: unknown): {
  content: string
  reasoning: string
  toolCalls: Array<{ index: number; id?: string; name?: string; arguments?: string }>
} => {
  if (!payload || typeof payload !== 'object') {
    return { content: '', reasoning: '', toolCalls: [] }
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0]) {
    return { content: '', reasoning: '', toolCalls: [] }
  }

  const first = choices[0] as {
    delta?: {
      content?: unknown
      reasoning?: unknown
      reasoning_content?: unknown
      tool_calls?: unknown
    }
    message?: {
      content?: unknown
      reasoning?: unknown
      reasoning_content?: unknown
      tool_calls?: unknown
    }
  }
  const source = first.delta ?? first.message ?? {}
  const content = source.content
  const reasoning = source.reasoning_content ?? source.reasoning
  const rawToolCalls = source.tool_calls
  const toolCalls: Array<{ index: number; id?: string; name?: string; arguments?: string }> = []

  if (Array.isArray(rawToolCalls)) {
    rawToolCalls.forEach((rawCall, fallbackIndex) => {
      if (!rawCall || typeof rawCall !== 'object') {
        return
      }

      const call = rawCall as {
        index?: unknown
        id?: unknown
        function?: { name?: unknown; arguments?: unknown }
      }
      const fn = call.function
      toolCalls.push({
        index: Number.isFinite(Number(call.index)) ? Number(call.index) : fallbackIndex,
        id: typeof call.id === 'string' ? call.id : undefined,
        name: fn && typeof fn.name === 'string' ? fn.name : undefined,
        arguments: fn && typeof fn.arguments === 'string' ? fn.arguments : undefined
      })
    })
  }

  return {
    content: typeof content === 'string' ? content : '',
    reasoning: typeof reasoning === 'string' ? reasoning : '',
    toolCalls
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
  return trimmed.startsWith('data:') ? trimmed.slice(5).trim() : null
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
  return normalized.length > maxAIErrorDetailLength
    ? `${normalized.slice(0, maxAIErrorDetailLength)}...`
    : normalized
}

const makeAIHttpError = (provider: AIProviderRecord, response: Response, details: string): Error => {
  const detailText = compactAIErrorDetails(details)
  const suffix = detailText ? ` Details: ${detailText}` : ''

  if (response.status === 401 || response.status === 403) {
    return new Error(`AI provider authentication failed for ${provider.label}. Check the API key. (${response.status} ${response.statusText})${suffix}`)
  }
  if (response.status === 429) {
    return new Error(`AI provider rate limit or quota was reached for ${provider.label}. Try again later or use another provider. (${response.status} ${response.statusText})${suffix}`)
  }
  if (response.status === 400 || response.status === 404) {
    return new Error(`AI provider rejected the request for ${provider.label}. Check the base URL, model name, and request format. (${response.status} ${response.statusText})${suffix}`)
  }
  if (response.status >= 500) {
    return new Error(`AI provider server error for ${provider.label}. Try again later. (${response.status} ${response.statusText})${suffix}`)
  }
  return new Error(`AI request failed for ${provider.label}: ${response.status} ${response.statusText}${suffix}`)
}

export const isToolUnsupportedError = (error: unknown): boolean =>
  error instanceof Error && /(?:tools?|function.calling).{0,50}(?:not supported|unsupported|not available)|(?:unsupported|does not support).{0,40}(?:tools?|function.calling)/i.test(error.message)

type StreamRoundResult = {
  output: string
  reasoning: string
  toolCalls: ChatToolCall[]
}

type AIStreamError = Error & {
  partialOutput?: string
  partialReasoning?: string
}

const withPartialStreamOutput = (
  error: unknown,
  output: string,
  reasoning: string
): AIStreamError => {
  const normalized = error instanceof Error ? error : new Error(String(error))
  const enriched = new Error(normalized.message) as AIStreamError
  enriched.name = normalized.name
  if (normalized.stack) {
    enriched.stack = normalized.stack
  }

  if (output) enriched.partialOutput = output
  if (reasoning) enriched.partialReasoning = reasoning

  return enriched
}

const readWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      onTimeout?.()
      reject(new Error('AI stream idle timeout.'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

export async function streamOneRound(options: {
  requestId: string
  provider: AIProviderRecord
  apiKey: string
  messages: ChatMessage[]
  temperature: number
  signal?: AbortSignal
  onEvent: (event: AIStreamEvent) => void
  tools?: AIChatToolDefinition[]
}): Promise<StreamRoundResult> {
  const { requestId, provider, apiKey, messages, onEvent, signal } = options
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

  if (signal?.aborted) handleExternalAbort()
  else signal?.addEventListener('abort', handleExternalAbort, { once: true })

  let output = ''
  let reasoning = ''
  const toolCallBuffers = new Map<number, ChatToolCall>()
  let emittedThinking = false

  const processPayload = (payload: unknown): void => {
    const delta = extractDelta(payload)
    if (delta.reasoning) {
      reasoning += delta.reasoning
      onEvent({ requestId, type: 'delta', text: delta.reasoning, channel: 'reasoning' })
    }
    if (delta.content) {
      output += delta.content
      onEvent({ requestId, type: 'delta', text: delta.content, channel: 'content' })
    }
    for (const call of delta.toolCalls) {
      const existing = toolCallBuffers.get(call.index) ?? {
        id: call.id || `tool-${requestId}-${call.index}`,
        name: call.name || '',
        arguments: ''
      }
      if (call.id) existing.id = call.id
      if (call.name) existing.name = call.name
      if (call.arguments) existing.arguments += call.arguments
      toolCallBuffers.set(call.index, existing)
    }
  }

  onEvent({ requestId, type: 'status', phase: 'connecting', message: '正在连接 AI 服务' })

  try {
    const body: Record<string, unknown> = {
      model: provider.defaultModel,
      messages,
      stream: true,
      max_tokens: 4096,
      temperature: options.temperature,
      ...getExtraBody(provider)
    }
    if (options.tools?.length) {
      body.tools = options.tools
      body.tool_choice = 'auto'
    }

    const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'text/event-stream, application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => '')
      throw makeAIHttpError(provider, response, details)
    }

    onEvent({ requestId, type: 'status', phase: 'waiting', message: '已连接，等待模型首个响应' })
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const text = await response.text()
      const payload = parseSseJsonPayload(text)
      if (payload) {
        emittedThinking = true
        onEvent({ requestId, type: 'status', phase: 'thinking', message: '模型正在生成' })
        processPayload(payload)
      }
    } else {
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let sawPayload = false
      const processLine = (line: string): void => {
        const data = parseSseLine(line)
        if (!data || data === '[DONE]') return
        const payload = parseSseJsonPayload(data)
        if (!payload) return
        sawPayload = true
        if (!emittedThinking) {
          emittedThinking = true
          onEvent({ requestId, type: 'status', phase: 'thinking', message: '模型正在生成' })
        }
        processPayload(payload)
      }

      while (true) {
        const { done, value } = await readWithTimeout(reader.read(), aiReadIdleTimeoutMs, () => {
          abortReason = 'timeout'
          controller.abort()
          void reader.cancel().catch(() => undefined)
        })
        if (done) {
          const tail = `${buffer}${decoder.decode()}`
          if (tail.trim()) processLine(tail)
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
      }
      if (!sawPayload && buffer.trim()) {
        const fallbackPayload = parseSseJsonPayload(buffer.trim())
        if (fallbackPayload) processPayload(fallbackPayload)
      }
    }

    return {
      output,
      reasoning,
      toolCalls: Array.from(toolCallBuffers.values()).filter((call) => call.name)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (abortReason === 'cancelled') {
        throw Object.assign(withPartialStreamOutput(error, output, reasoning), {
          message: aiRequestCancelledMessage,
          code: 'AI_CANCELLED'
        })
      }
      throw withPartialStreamOutput(
        new Error(`AI request timed out after ${aiRequestTimeoutMs / 1000} seconds.`),
        output,
        reasoning
      )
    }
    if (error instanceof Error && error.message === 'AI stream idle timeout.') {
      throw withPartialStreamOutput(
        new Error(`AI stream stopped responding for ${aiReadIdleTimeoutMs / 1000} seconds.`),
        output,
        reasoning
      )
    }
    if (error instanceof TypeError) {
      throw withPartialStreamOutput(
        new Error(`AI network error for ${provider.label}. Check the base URL and network connection. ${error.message}`.trim()),
        output,
        reasoning
      )
    }
    throw withPartialStreamOutput(error, output, reasoning)
  } finally {
    signal?.removeEventListener('abort', handleExternalAbort)
    clearTimeout(timeout)
  }
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
  tools?: AIChatToolDefinition[]
  finishAfterAnnotations?: boolean
  onToolCall?: AIAnnotationToolHandler
}): Promise<void> {
  const { requestId, provider, apiKey, onEvent, saveArtifact, signal } = options
  let messages = [...options.messages]
  let toolDefinitions = options.tools

  const roundLimit = options.tools?.some(tool => tool.function.name === 'search_book') ? 7 : maxToolRounds
  for (let round = 0; round < roundLimit; round += 1) {
    if (round === roundLimit - 1 && roundLimit > maxToolRounds) toolDefinitions = undefined
    let result: StreamRoundResult
    const bufferedDeltas: AIStreamEvent[] = []
    const handleRoundEvent = (event: AIStreamEvent): void => {
      if (toolDefinitions?.length && event.type === 'delta') {
        bufferedDeltas.push(event)
        return
      }

      onEvent(event)
    }

    try {
      result = await streamOneRound({
        requestId,
        provider,
        apiKey,
        messages,
        temperature: options.temperature ?? 0.2,
        signal,
        onEvent: handleRoundEvent,
        tools: toolDefinitions
      })
    } catch (error) {
      if (toolDefinitions?.length && isToolUnsupportedError(error)) {
        toolDefinitions = undefined
        onEvent({ requestId, type: 'status', phase: 'thinking', message: '当前服务不支持工具协议，切换兼容模式' })
        continue
      }
      if (error instanceof Error && (error as Error & { code?: string }).code === 'AI_CANCELLED') {
        onEvent({ requestId, type: 'cancelled', message: aiRequestCancelledMessage })
        return
      }
      throw error
    }

    if (!result.toolCalls.length || !options.onToolCall || !toolDefinitions?.length) {
      for (const event of bufferedDeltas) {
        onEvent(event)
      }
      onEvent({ requestId, type: 'status', phase: 'finalizing', message: '正在保存 AI 结果' })
      let artifact: AIArtifactRecord
      try {
        artifact = saveArtifact(wrapReasoningOutput(result.reasoning, result.output))
      } catch (error) {
        throw withPartialStreamOutput(error, result.output, result.reasoning)
      }
      onEvent({ requestId, type: 'done', artifact })
      return
    }

    const toolResults: Array<{ call: ChatToolCall; result: string }> = []
    for (const call of result.toolCalls) {
      onEvent({ requestId, type: 'status', phase: 'tool', message: call.name === 'search_book' ? '正在查找书中关联段落' : call.name === 'search_references' ? '正在检索外部文献' : '正在写入 AI 批注' })
      let toolResult = ''
      try {
        toolResult = await options.onToolCall(call)
      } catch (error) {
        toolResult = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      toolResults.push({ call, result: toolResult })
    }

    if (options.finishAfterAnnotations) {
      const created = toolResults.reduce((sum, { result }) => sum + (Number(JSON.parse(result).created) || 0), 0)
      if (created > 0 || round === maxToolRounds - 1) {
        const summary = created ? `本页已写入 ${created} 条 AI 批注` : '本页没有生成通过原文校验的批注'
        onEvent({ requestId, type: 'done', artifact: saveArtifact(summary) })
        return
      }
    }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content: result.output,
        ...(result.reasoning && new URL(provider.baseUrl).hostname === 'api.deepseek.com'
          ? { reasoning_content: result.reasoning } : {}),
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments }
        }))
      },
      ...toolResults.map(({ call, result: toolResult }) => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        name: call.name,
        content: toolResult
      }))
    ]
  }

  throw new Error('AI tool loop exceeded the maximum number of rounds.')
}

export async function runOpenAICompatibleCompletion(
  options: AICompletionOptions & { signal?: AbortSignal }
): Promise<void> {
  await streamOpenAICompatibleCompletion({
    requestId: options.input.requestId,
    provider: options.provider,
    apiKey: options.apiKey,
    messages: buildMessages(options.input),
    temperature: 0.2,
    signal: options.signal,
    onEvent: options.onEvent,
    saveArtifact: options.saveArtifact,
    tools: options.tools,
    finishAfterAnnotations: options.finishAfterAnnotations,
    onToolCall: options.onToolCall
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
  tools?: AIChatToolDefinition[]
  finishAfterAnnotations?: boolean
  onToolCall?: AIAnnotationToolHandler
}): Promise<void> {
  await streamOpenAICompatibleCompletion({ ...options, temperature: 0.25 })
}

export const getPromptActionLabel = (promptType: AIPromptType): string => promptLabels[promptType]
