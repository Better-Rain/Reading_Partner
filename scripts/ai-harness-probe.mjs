const baseUrl = process.env.READING_PARTNER_AI_BASE_URL ?? 'http://127.0.0.1:18080/v1'
const apiKey = process.env.READING_PARTNER_AI_KEY ?? 'local-only'
const model = process.env.READING_PARTNER_AI_MODEL ?? 'qwen-local'

const payload = {
  model,
  messages: [
    { role: 'system', content: '你是阅读助手，只输出一句简短中文回答。' },
    { role: 'user', content: '请解释什么是叙事视角。' }
  ],
  max_tokens: 128,
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
      const parsed = JSON.parse(data)
      const delta = parsed.choices?.[0]?.delta
      output += delta?.content ?? ''
    } catch {
      // Ignore keepalive or malformed probe lines.
    }
  }
}
console.log(`CONTENT ${output}`)
