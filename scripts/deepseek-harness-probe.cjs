const { app, safeStorage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const outputPath = path.join(os.tmpdir(), 'reading-partner-deepseek-probe-output.txt')
const log = (message) => {
  fs.appendFileSync(outputPath, `${message}\n`)
  console.log(message)
}
fs.writeFileSync(outputPath, `started ${new Date().toISOString()}\n`)

const userDataPath = process.env.RP_PROBE_USER_DATA || path.join(app.getPath('appData'), 'reading-partner')
app.setPath('userData', userDataPath)

const readDeepSeekKey = () => {
  const secrets = JSON.parse(fs.readFileSync(`${userDataPath}\\secrets.json`, 'utf8'))
  const encrypted = secrets['provider:deepseek']
  if (!encrypted || !safeStorage.isEncryptionAvailable()) {
    throw new Error('DeepSeek key is not available in the Reading Partner key store.')
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

const readSse = async (response) => {
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let output = ''
  let reasoning = ''
  const toolCalls = new Map()

  const processLine = (line) => {
    if (!line.trim().startsWith('data:')) return
    const data = line.trim().slice(5).trim()
    if (!data || data === '[DONE]') return
    const payload = JSON.parse(data)
    const delta = payload.choices?.[0]?.delta
    output += delta?.content ?? ''
    reasoning += delta?.reasoning_content ?? delta?.reasoning ?? ''
    for (const item of delta?.tool_calls ?? []) {
      const index = item.index ?? 0
      const call = toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
      call.id = item.id ?? call.id
      call.name = item.function?.name ?? call.name
      call.arguments += item.function?.arguments ?? ''
      toolCalls.set(index, call)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) processLine(line)
  }
  if (buffer.trim()) processLine(buffer)
  return { output, reasoning, toolCalls: [...toolCalls.values()] }
}

const request = async (baseUrl, apiKey, payload) => {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'text/event-stream, application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  })
  if (!response.ok || !response.body) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 240)
    throw new Error(`HTTP ${response.status}: ${detail}`)
  }
  return response.headers.get('content-type')?.includes('application/json')
    ? (() => {
        const body = response.json()
        return body.then((payload) => ({
          output: payload.choices?.[0]?.message?.content ?? '',
          reasoning: payload.choices?.[0]?.message?.reasoning_content ?? payload.choices?.[0]?.message?.reasoning ?? '',
          toolCalls: payload.choices?.[0]?.message?.tool_calls ?? []
        }))
      })()
    : readSse(response)
}

const responseText = (result) => `${result.output ?? ''}${result.reasoning ?? ''}`.replace(/\s+/g, ' ').trim()

const requireResponse = (label, result) => {
  const text = responseText(result)
  if (!text) throw new Error(`${label} returned an empty response.`)
  return text
}

const main = async () => {
  const apiKey = readDeepSeekKey()
  const baseUrl = 'https://api.deepseek.com'
  const modelsResponse = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000)
  })
  const modelsBody = await modelsResponse.json()
  const modelIds = Array.isArray(modelsBody.data) ? modelsBody.data.map((item) => item.id) : []
  log(`MODELS_HTTP ${modelsResponse.status}`)
  log(`MODELS ${modelIds.join(',')}`)

  if (process.argv.includes('--list-models')) return
  const model = process.env.READING_PARTNER_AI_MODEL || modelIds.find((id) => id.includes('flash'))
  if (!model) throw new Error('DeepSeek returned no models.')

  const normal = await request(baseUrl, apiKey, {
    model,
    messages: [
      { role: 'system', content: '你是 Reading Partner，只用一句简洁中文回答。' },
      { role: 'user', content: '请解释什么是叙事视角。' }
    ],
    stream: true,
    max_tokens: 128,
    temperature: 0.1
  })
  log(`NORMAL ${requireResponse('Normal completion', normal)}`)

  const annotationTool = {
    type: 'function',
    function: {
      name: 'create_annotations',
      description: 'Create one candidate PDF note.',
      parameters: {
        type: 'object',
        properties: {
          annotations: {
            type: 'array',
            maxItems: 5,
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
  const annotation = await request(baseUrl, apiKey, {
    model,
    messages: [
      {
        role: 'system',
        content: '用户明确要求你先调用 create_annotations，为第 12 页创建一条简洁批注。不要输出工具协议。'
      },
      { role: 'user', content: '请为这段关于制度变迁的论述做一条批注。' }
    ],
    tools: [annotationTool],
    tool_choice: 'auto',
    stream: true,
    max_tokens: 1024,
    temperature: 0.1
  })
  log(`ANNOTATION_TOOLS ${JSON.stringify(annotation.toolCalls)}`)

  if (annotation.toolCalls.length === 0) {
    throw new Error('DeepSeek did not produce the required create_annotations tool call.')
  }

  if (annotation.toolCalls.length > 0) {
    const call = annotation.toolCalls[0]
    let toolResult
    try {
      const args = JSON.parse(call.arguments)
      const count = Array.isArray(args.annotations) ? args.annotations.length : 0
      toolResult = JSON.stringify({ ok: true, created: count, annotationIds: ['deepseek-probe'] })
    } catch (error) {
      toolResult = JSON.stringify({ ok: false, error: `invalid tool arguments: ${error.message}` })
    }

    const toolLoop = await request(baseUrl, apiKey, {
      model,
      messages: [
        {
          role: 'system',
          content: '你是 Reading Partner。工具调用已经完成，请读取工具结果后用一句简洁中文确认。不要再次调用工具。'
        },
        { role: 'user', content: '请为这段关于制度变迁的论述做一条批注。' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments }
            }
          ]
        },
        { role: 'tool', tool_call_id: call.id, name: call.name, content: toolResult }
      ],
      stream: true,
      max_tokens: 256,
      temperature: 0.1
    })
    log(`TOOL_LOOP_RESULT ${requireResponse('Tool-loop completion', toolLoop)}`)
  }

  const followup = await request(baseUrl, apiKey, {
    model,
    messages: [
      {
        role: 'system',
        content: '你是 Reading Partner，只用一句简洁中文回答，不要输出工具协议。'
      },
      { role: 'user', content: '刚才的批注已经保留。请问下一步阅读时应关注什么？' }
    ],
    stream: true,
    max_tokens: 128,
    temperature: 0.1
  })
  log(`FOLLOWUP ${requireResponse('Follow-up completion', followup)}`)
}

app.whenReady().then(() => main().catch((error) => {
  log(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}).finally(() => app.quit()))
