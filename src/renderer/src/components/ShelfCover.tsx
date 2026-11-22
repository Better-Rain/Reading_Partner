import { useEffect, useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type { DocumentRecord } from '../../../shared/types'

const thumbs = new Map<string, string>()
let work = Promise.resolve()

export function ShelfCover({ book }: { book: DocumentRecord }): JSX.Element {
  const host = useRef<HTMLSpanElement>(null)
  const cloud = location.protocol === 'https:'
  const [src, setSrc] = useState(cloud ? `/cover/${encodeURIComponent(book.id)}` : thumbs.get(book.id))
  useEffect(() => {
    if (cloud || thumbs.has(book.id) || !host.current) return
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      work = work.then(async () => {
        if (!active) return
        const buffer = await window.readingPartner.readPdf(book.id)
        if (!active) return
        const task = pdfjs.getDocument({ data: buffer })
        try {
          const pdf = await task.promise
          const page = await pdf.getPage(1)
          const viewport = page.getViewport({ scale: 280 / page.getViewport({ scale: 1 }).width })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ viewport, canvasContext: canvas.getContext('2d')! }).promise
          const image = canvas.toDataURL('image/jpeg', 0.8)
          if (thumbs.size >= 100) thumbs.delete(thumbs.keys().next().value!)
          thumbs.set(book.id, image)
          if (active) setSrc(image)
        } finally { await task.destroy() }
      }).catch(() => {})
    })
    observer.observe(host.current)
    return () => { active = false; observer.disconnect() }
  }, [book.id, cloud])
  return <span className="shelf-cover" ref={host}>{src
    ? <img loading="lazy" src={src} alt="" onError={() => setSrc(undefined)} />
    : <span>{book.title.replace(/\.pdf$/i, '')}</span>}</span>
}
