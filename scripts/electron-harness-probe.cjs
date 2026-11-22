const port = Number(process.env.READING_PARTNER_ELECTRON_CDP_PORT ?? 9223)

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const connect = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find((item) => item.type === 'page')

  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`No Electron page found on CDP port ${port}.`)
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  const runtimeErrors = []

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails
      runtimeErrors.push(details?.exception?.description || details?.text || 'Renderer exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      runtimeErrors.push(
        (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ')
      )
    }
    const resolve = pending.get(message.id)

    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }

  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000).unref()
    })

  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || 'Electron evaluation failed.')
    }

    return response.result?.result?.value
  }

  await call('Runtime.enable')
  return { socket, evaluate, runtimeErrors }
}

const main = async () => {
  const { socket, evaluate, runtimeErrors } = await connect()
  const snapshot = await evaluate(
    `JSON.stringify({title: document.title, api: typeof window.readingPartner, text: document.body.innerText})`
  )
  const surface = JSON.parse(snapshot)

  if (surface.api !== 'object') {
    throw new Error('Electron preload API is not available.')
  }

  const documents = await evaluate('window.readingPartner.listDocuments()')
  const providers = await evaluate('window.readingPartner.listAIProviders()')
  console.log(`WINDOW ${surface.title} API ${surface.api}`)
  console.log(`DOCUMENTS ${documents.length}`)
  console.log(`PROVIDERS ${providers.map((provider) => provider.id).join(',')}`)

  if (documents.length === 0) {
    console.log('SKIP_CHAT no document is available in the selected Electron profile')
    socket.close()
    return
  }

  const document = documents[0]
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes(${JSON.stringify(document.title)}))
    if (!button) return false
    button.click()
    return true
  })()`)

  if (!clicked) {
    throw new Error('Document library button was not found.')
  }

  await sleep(1200)
  const afterOpen = await evaluate('document.body.innerText')
  console.log(`OPENED ${afterOpen.includes(document.title) ? 'yes' : 'no'}`)

  const localProvider = providers.find(
    (provider) => provider.baseUrl.includes('127.0.0.1:18080') || provider.baseUrl.includes('localhost:18080')
  )

  if (!localProvider) {
    console.log('SKIP_CHAT local provider is not configured')
    socket.close()
    return
  }

  const conversation = await evaluate(
    `window.readingPartner.createAIConversation(${JSON.stringify(document.id)}, 'Electron harness probe')`
  )
  const requestId = `electron-probe-${Date.now()}`
  await evaluate(`(() => {
    window.__readingPartnerProbeEvents = []
    window.__readingPartnerProbeUnsubscribe = window.readingPartner.onAIStreamEvent((event) => window.__readingPartnerProbeEvents.push(event))
    return true
  })()`)

  await evaluate(`window.readingPartner.runAIChat(${JSON.stringify({
    requestId,
    providerId: localProvider.id,
    conversationId: conversation.id,
    documentId: document.id,
    pageNumber: 1,
    message: '请先调用 create_annotations，为第 1 页创建一条关于制度变迁的简洁批注，然后用一句中文确认。',
    selectedText: '制度变迁',
    selectionRects: [],
    selectionColor: '#f8d86a'
  })})`)

  await sleep(500)
  const result = await evaluate(`(async () => {
    const messages = await window.readingPartner.listAIChatMessages(${JSON.stringify(conversation.id)})
    const annotations = await window.readingPartner.listAnnotations(${JSON.stringify(document.id)})
    return {messages, annotations}
  })()`)
  console.log(`CHAT_MESSAGES ${result.messages.length}`)
  console.log(`ANNOTATIONS ${result.annotations.length}`)
  const events = await evaluate('window.__readingPartnerProbeEvents')
  console.log(`EVENTS ${events.map((event) => event.type).join('>')}`)
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'AI')
    tab?.click()
    return Boolean(tab)
  })()`)
  await sleep(200)
  const operationAction = process.env.READING_PARTNER_PROBE_ACTION === 'keep' ? '保留' : '撤销'
  const actionResult = await evaluate(`(async () => {
    const action = [...document.querySelectorAll('button')].find((item) => item.textContent.includes(${JSON.stringify(operationAction)}))
    if (!action) return false
    action.click()
    await new Promise((resolve) => setTimeout(resolve, 250))
    return true
  })()`)
  if (actionResult && operationAction === '撤销') {
    const afterRevert = await evaluate(
      `window.readingPartner.listAnnotations(${JSON.stringify(document.id)})`
    )
    console.log(`REVERTED ${afterRevert.length < result.annotations.length ? 'yes' : 'no'}`)
  } else if (actionResult && operationAction === '保留') {
    console.log('KEPT yes')
  } else {
    console.log(`${operationAction === '保留' ? 'KEPT' : 'REVERTED'} skipped`)
  }
  await evaluate('window.__readingPartnerProbeUnsubscribe?.()')
  if (runtimeErrors.length) {
    console.log(`RENDERER_ERRORS ${runtimeErrors.join(' | ')}`)
  }
  console.log('CHAT_DONE yes')
  socket.close()
}

main().catch((error) => {
  console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
