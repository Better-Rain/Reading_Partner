export const getStoredReaderName = (): string => {
  const value = window.localStorage.getItem('reading-partner.reader-name')?.trim()
  return value || '本机读者'
}

export const toPdfBlobUrl = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const stableCopy = bytes.slice()
  return URL.createObjectURL(new Blob([stableCopy], { type: 'application/pdf' }))
}
