const listeners = new Map()
export const contextBridge = {
  exposeInMainWorld: (key, value) => {
    window[key] = value
  },
}
async function checked(url, options) {
  const r = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      'X-RP-Session': document.querySelector('meta[name="rp-session"]').content,
    },
  })
  if (r.status === 403 || r.status === 409) location.replace('/account')
  if (!r.ok) throw Error((await r.json()).error || `HTTP ${r.status}`)
  return r
}
function choose(accept) {
  return new Promise((resolve) => {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = accept
    el.onchange = () => resolve(el.files[0])
    el.oncancel = () => resolve(null)
    el.click()
  })
}
async function rpc(channel, args) {
  const r = await checked('/rpc/' + channel, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.headers.get('content-type').includes('ndjson')) return r.json()
  const reader = r.body.getReader(),
    decoder = new TextDecoder()
  let pending = '',
    value,
    done = false
  for (;;) {
    const result = await reader.read()
    pending += decoder.decode(result.value, { stream: !result.done })
    const frames = pending.split('\n')
    pending = frames.pop()
    for (const line of frames) {
      const f = JSON.parse(line)
      if (f.error) throw Error(f.error)
      if (f.name)
        for (const fn of listeners.get(f.name) || []) fn(null, f.event)
      if (f.done) {
        done = true
        value = f.value
      }
    }
    if (result.done) break
  }
  if (!done) throw Error('服务器连接中断，请重新打开文档确认保存状态')
  return value
}
export const ipcRenderer = {
  on(ch, fn) {
    if (!listeners.has(ch)) listeners.set(ch, new Set())
    listeners.get(ch).add(fn)
  },
  removeListener(ch, fn) {
    listeners.get(ch)?.delete(fn)
  },
  async invoke(ch, ...args) {
    if (ch.startsWith('window:')) return false
    if (ch === 'documents:readPdf')
      return (
        await checked('/pdf/' + encodeURIComponent(args[0]))
      ).arrayBuffer()
    if (ch === 'documents:openPdfDialog') {
      const f = await choose('.pdf,application/pdf')
      if (!f) return null
      const document = await (
        await checked('/books?name=' + encodeURIComponent(f.name), {
          method: 'POST',
          body: f,
        })
      ).json()
      return { document, data: await f.arrayBuffer() }
    }
    if (
      ch === 'readingMarks:importDialog' ||
      ch === 'dictionary:importCsvDialog'
    ) {
      const marks = ch.startsWith('readingMarks')
      const f = await choose(marks ? '.json' : '.csv')
      if (!f) return null
      const text = await f.text()
      return marks
        ? {
            filePath: f.name,
            annotationCount: await rpc('marks:import', [
              args[0],
              JSON.parse(text),
            ]),
          }
        : {
            ...(await rpc('dictionary:csv', [text, f.name])),
            sourcePath: f.name,
            sourceType: 'csv',
          }
    }
    if (ch === 'readingMarks:exportDialog') {
      const b = await rpc('marks:export', args)
      if (window.ReadingExports) {
        window.ReadingExports.saveMarks(JSON.stringify(b))
        return {
          filePath: 'reading-marks.json',
          annotationCount: b.annotations.length,
        }
      }
      const a = document.createElement('a')
      a.download = 'reading-marks.json'
      a.href = URL.createObjectURL(
        new Blob([JSON.stringify(b)], { type: 'application/json' }),
      )
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
      return { filePath: a.download, annotationCount: b.annotations.length }
    }
    return rpc(ch, args)
  },
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload()
})
