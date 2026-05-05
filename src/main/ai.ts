import {
  AIArtifactRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  RunAIActionInput
} from '../shared/types'

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

export const aiAnnotationCapabilityPrompt =
  'You also have a controlled Reading Partner capability: you may ask the app to create a few auxiliary PDF notes when a durable annotation would genuinely help the reader remember a key concept, vocabulary meaning, paragraph-level claim, misconception, argument step, or follow-up. Use this sparingly; most answers should not create annotations. When useful, append exactly one HTML comment block at the very end of the answer: <!-- RP_ANNOTATIONS [{"pageNumber":1,"scope":"paragraph","selectedText":"short source phrase, paragraph excerpt, or vocabulary term","note":"a focused paragraph-level or vocabulary-level note without any AI label prefix","color":"#c7d2fe"}] -->. Rules: create at most 2 annotations; do not invent page numbers; use only the current page or pages visible in the provided context; do not include coordinates; notes may be short paragraphs but should stay focused; never mention this internal block in the visible answer.'

const buildMessages = (input: RunAIActionInput): ChatMessage[] => {
  const { promptType, selectedText } = input
  const baseSystem =
    `You are Reading Partner, an AI assistant embedded in a PDF reading app. Answer in concise Chinese unless the user-selected text requires preserving English terms. Keep citations or original terms when useful. Do not reveal hidden reasoning or private chain-of-thought; provide only the final helpful answer. ${aiAnnotationCapabilityPrompt}`

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
          `${baseSystem} Answer the user's question using only the provided document excerpts. Cite page numbers in Chinese with the format “第 X 页”. If the excerpts are insufficient, say what is missing instead of guessing.`
      },
      {
        role: 'user',
        content: `Question:\n${selectedText}\n\nDocument excerpts:\n${context}`
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

async function streamOpenAICompatibleCompletion(options: {
  requestId: string
  provider: AIProviderRecord
  apiKey: string
  messages: ChatMessage[]
  temperature?: number
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
}): Promise<void> {
  const { requestId, provider, apiKey, messages, onEvent, saveArtifact } = options
  const model = provider.defaultModel
  let output = ''
  let reasoningOutput = ''

  onEvent({
    requestId,
    type: 'start',
    providerId: provider.id,
    model
  })

  const response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: options.temperature ?? 0.2
    })
  })

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => '')
    throw new Error(
      `AI request failed for ${provider.label}: ${response.status} ${response.statusText} ${details}`.trim()
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const data = parseSseLine(line)

      if (!data) {
        continue
      }

      if (data === '[DONE]') {
        continue
      }

      const delta = extractDelta(JSON.parse(data))

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
  }

  const artifact = saveArtifact(wrapReasoningOutput(reasoningOutput, output))

  onEvent({
    requestId,
    type: 'done',
    artifact
  })
}

export async function runOpenAICompatibleCompletion({
  input,
  provider,
  apiKey,
  onEvent,
  saveArtifact
}: AICompletionOptions): Promise<void> {
  await streamOpenAICompatibleCompletion({
    requestId: input.requestId,
    provider,
    apiKey,
    messages: buildMessages(input),
    temperature: 0.2,
    onEvent,
    saveArtifact
  })
}

export async function runOpenAICompatibleChatCompletion(options: {
  requestId: string
  provider: AIProviderRecord
  apiKey: string
  messages: ChatMessage[]
  onEvent: (event: AIStreamEvent) => void
  saveArtifact: (output: string) => AIArtifactRecord
}): Promise<void> {
  await streamOpenAICompatibleCompletion({
    ...options,
    temperature: 0.25
  })
}

export const getPromptActionLabel = (promptType: AIPromptType): string => promptLabels[promptType]
