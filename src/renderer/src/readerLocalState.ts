export const readerNameKey = (): string => {
  const user = document.querySelector<HTMLMetaElement>('meta[name="rp-user"]')?.content
  return user ? `reading-partner.reader-name.${user}` : 'reading-partner.reader-name'
}

export const getStoredReaderName = (): string => {
  const value = window.localStorage.getItem(readerNameKey())?.trim()
  return value || document.querySelector<HTMLMetaElement>('meta[name="rp-user"]')?.content || '本机读者'
}

export const toPdfBlobUrl = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const stableCopy = bytes.slice()
  return URL.createObjectURL(new Blob([stableCopy], { type: 'application/pdf' }))
}
