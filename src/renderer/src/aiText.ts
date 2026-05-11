export const aiAnnotationBlockPattern = /<!--\s*RP_ANNOTATIONS\s*([\s\S]*?)\s*-->/gi
const incompleteAIAnnotationBlockPattern = /<!--\s*RP_ANNOTATIONS[\s\S]*$/i
const aiReasoningBlockPattern = /<!--\s*RP_REASONING\s*([\s\S]*?)\s*-->/gi

export const stripAIAssistedAnnotationBlock = (text: string): string =>
  text.replace(aiAnnotationBlockPattern, '').replace(incompleteAIAnnotationBlockPattern, '').trim()

export const stripAIReasoningBlock = (text: string): string =>
  text.replace(aiReasoningBlockPattern, '').trim()

export const extractAIReasoning = (text: string): { reasoning: string; content: string } => {
  const reasoning = Array.from(text.matchAll(aiReasoningBlockPattern))
    .map((match) => match[1]?.trim())
    .filter(Boolean)
    .join('\n\n')

  return {
    reasoning,
    content: stripAIReasoningBlock(text)
  }
}

export const composeAIOutputWithReasoning = (output: string, reasoning: string): string => {
  const trimmedReasoning = reasoning.trim().replace(/-->/g, '-- >')
  const trimmedOutput = output.trim()

  if (!trimmedReasoning) {
    return trimmedOutput
  }

  return `<!-- RP_REASONING\n${trimmedReasoning}\n-->\n\n${trimmedOutput}`.trim()
}

export const makeConversationTitle = (message: string): string => {
  const normalized = message
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return '共读对话'
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized
}
