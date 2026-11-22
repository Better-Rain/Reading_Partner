import type { AIChatToolDefinition } from './ai'

export const searchBookTool: AIChatToolDefinition = {
  type: 'function', function: { name: 'search_book', description: 'Look up a short keyword in the original language anywhere in this book, including pages outside the initial excerpts.', parameters: {
    type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'], additionalProperties: false
  } }
}
export const searchReferencesTool: AIChatToolDefinition = {
  type: 'function', function: { name: 'search_references', description: 'Find external bibliography from Crossref using only public topic keywords. Use when the reader wants external material. Results are metadata, sometimes with an abstract excerpt.', parameters: {
    type: 'object', properties: { keywords: { type: 'string' } }, required: ['keywords'], additionalProperties: false
  } }
}
export type Reference = { doi: string; title: string; author: string; year: number | null; excerpt: string }
export async function searchReferences(keywords: string, signal?: AbortSignal): Promise<Reference[]> {
  const url = new URL('https://api.crossref.org/works')
  url.search = new URLSearchParams({ 'query.bibliographic': keywords.slice(0, 120), rows: '3', select: 'DOI,title,author,published,abstract' }).toString()
  const timer = AbortSignal.timeout(12000)
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timer]) : timer })
  if (!response.ok) throw Error(`Crossref HTTP ${response.status}`)
  const data = await response.json() as { message: { items: { DOI: string; title?: string[]; author?: { family?: string }[]; published?: { 'date-parts'?: number[][] }; abstract?: string }[] } }
  return data.message.items.filter(item => item.title?.[0] && /^10\.\d+\//.test(item.DOI)).map(item => ({
    doi: item.DOI.toLowerCase(), title: item.title![0].slice(0, 250), author: item.author?.[0]?.family ?? '',
    year: item.published?.['date-parts']?.[0]?.[0] ?? null,
    excerpt: (item.abstract ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  }))
}
