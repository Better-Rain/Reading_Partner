const baseUrl = process.env.READING_PARTNER_AI_BASE_URL ?? 'http://127.0.0.1:18080/v1'
const apiKey = process.env.READING_PARTNER_AI_KEY ?? 'local-only'
const model = process.env.READING_PARTNER_AI_MODEL ?? 'qwen-local'
const tools = [
  {
    type: 'function',
    function: {
      name: 'create_annotations',
      description: 'Create a candidate PDF note for the reader.',
      parameters: {
        type: 'object',
        properties: {
          annotations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pageNumber: { type: 'integer' },
                scope: { type: 'string' },
                selectedText: { type: ['string', 'null'] },
                note: { type: 'string' }
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
]

const payload = {
  model,
  messages: [
    {
      role: 'system',
      content: '你是阅读助手。用户明确要求在第 12 页为“这段关于制度变迁的论述”创建一条简洁批注。必须先调用 create_annotations，再用一句中文确认。不要输出工具协议。'
    },
    { role: 'user', content: '请为这段关于制度变迁的论述做一条批注。' }
  ],
  tools,
  tool_choice: 'auto',
  max_tokens: 256,
  temperature: 0.1,
  stream: true,
  llm_hub_mode: 'direct'
}

const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'text/event-stream, application/json'
  },
  body: JSON.stringify(payload)
})

console.log(`HTTP ${response.status} ${response.headers.get('content-type') ?? ''}`)
if (!response.ok || !response.body) {
  console.log(await response.text())
  process.exit(1)
}

const reader = response.body.getReader()
const decoder = new TextDecoder('utf-8')
let buffer = ''
const calls = new Map()
let output = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const delta = JSON.parse(data).choices?.[0]?.delta
      output += delta?.content ?? ''
      for (const item of delta?.tool_calls ?? []) {
        const index = item.index ?? 0
        const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
        call.id = item.id ?? call.id
        call.name = item.function?.name ?? call.name
        call.arguments += item.function?.arguments ?? ''
        calls.set(index, call)
      }
    } catch {
      // Ignore keepalive or malformed probe lines.
    }
  }
}
console.log(`TOOLS ${JSON.stringify([...calls.values()])}`)
console.log(`CONTENT ${output}`)
