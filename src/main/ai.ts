import {
  AIArtifactRecord,
  AIProviderRecord,
  AIPromptType,
  AIStreamEvent,
  RunAIActionInput
} from '../shared/types'

type ChatMessage = {
  role: 'system' | 'user'
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
  ask_document: 'ask document'
}

const buildMessages = (input: RunAIActionInput): ChatMessage[] => {
  const { promptType, selectedText } = input
  const baseSystem =
    'You are Reading Partner, an AI assistant embedded in a PDF reading app. Answer in concise Chinese unless the user-selected text requires preserving English terms. Keep citations or original terms when useful.'

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

const extractDelta = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const first = choices[0] as {
    delta?: { content?: unknown; reasoning_content?: unknown }
    message?: { content?: unknown }
  }

  const content = first.delta?.content ?? first.delta?.reasoning_content ?? first.message?.content
  return typeof content === 'string' ? content : ''
}

const parseSseLine = (line: string): string | null => {
  const trimmed = line.trim()

  if (!trimmed.startsWith('data:')) {
    return null
  }

  return trimmed.slice(5).trim()
}

export async function runOpenAICompatibleCompletion({
  input,
  provider,
  apiKey,
  onEvent,
  saveArtifact
}: AICompletionOptions): Promise<void> {
  const model = provider.defaultModel
  let output = ''

  onEvent({
    requestId: input.requestId,
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
      messages: buildMessages(input),
      stream: true,
      temperature: 0.2
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

      if (delta) {
        output += delta
        onEvent({
          requestId: input.requestId,
          type: 'delta',
          text: delta
        })
      }
    }
  }

  const artifact = saveArtifact(output.trim())

  onEvent({
    requestId: input.requestId,
    type: 'done',
    artifact
  })
}

export const getPromptActionLabel = (promptType: AIPromptType): string => promptLabels[promptType]
