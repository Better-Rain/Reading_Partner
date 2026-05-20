import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Search, Sparkles, Trash2, Upload } from 'lucide-react'
import type {
  DictionaryEntryRecord,
  DictionarySourceRecord,
  VocabularyRecord
} from '../../../shared/types'
import { makeDefinitionFromDictionary } from '../vocabularyUtils'

type VocabularyPanelProps = {
  dictionarySources: DictionarySourceRecord[]
  hasDocument: boolean
  vocabulary: VocabularyRecord[]
  onAddDictionaryEntry: (entry: DictionaryEntryRecord) => void
  onDefine: (item: VocabularyRecord) => void
  onDelete: (id: string) => void
  onImportDictionary: () => void
}

type VocabularyDefinitionPart = {
  label: string
  text: string
}

type VocabularyDefinitionView = {
  label: string
  phonetic: string | null
  parts: VocabularyDefinitionPart[]
  tags: string[]
}

const partOfSpeechPattern =
  /(?:^|\s)(a\.|adj\.|n\.|v\.|vt\.|vi\.|adv\.|ad\.|prep\.|conj\.|pron\.|num\.|int\.)\s+/gi

const parseVocabularyDefinition = (definition: string): VocabularyDefinitionView => {
  const normalized = definition.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
  const labelMatch = normalized.match(/^([^：:]{1,12})[：:]\s*/)
  const label = labelMatch?.[1] ?? '释义'
  let content = labelMatch ? normalized.slice(labelMatch[0].length).trim() : normalized
  const phoneticMatch = content.match(/^\*?\s*(\[[^\]]+\])/)
  const phonetic = phoneticMatch?.[1] ?? null

  if (phoneticMatch) {
    content = content.slice(phoneticMatch[0].length).trim()
  }

  content = content.replace(/^-?\d+\s*/, '').trim()
  const tags = Array.from(content.matchAll(/\[[^\]]+\]|\([^)]*\)$/g)).map((item) => item[0])
  const withoutTags = content.replace(/\[[^\]]+\]|\([^)]*\)$/g, ' ').replace(/\s+/g, ' ').trim()
  const matches = Array.from(withoutTags.matchAll(partOfSpeechPattern))
  const parts: VocabularyDefinitionPart[] = []

  if (matches.length > 0) {
    matches.forEach((match, index) => {
      const next = matches[index + 1]
      const start = (match.index ?? 0) + match[0].length
      const end = next?.index ?? withoutTags.length
      const text = withoutTags.slice(start, end).trim()

      if (text) {
        parts.push({ label: match[1], text })
      }
    })
  }

  if (parts.length === 0 && withoutTags) {
    parts.push({ label, text: withoutTags })
  }

  return { label, phonetic, parts, tags }
}

const VocabularyDefinition = memo(function VocabularyDefinition({
  definition
}: {
  definition: string
}): JSX.Element {
  const parsed = useMemo(() => parseVocabularyDefinition(definition), [definition])

  return (
    <div className="vocabulary-definition">
      <div className="vocabulary-definition-meta">
        <span>{parsed.label}</span>
        {parsed.phonetic && <code>{parsed.phonetic}</code>}
      </div>
      <div className="vocabulary-definition-parts">
        {parsed.parts.map((part, index) => (
          <div className="vocabulary-definition-part" key={`${part.label}-${index}`}>
            <strong>{part.label}</strong>
            <span>{part.text}</span>
          </div>
        ))}
      </div>
      {parsed.tags.length > 0 && (
        <div className="vocabulary-definition-tags">
          {parsed.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
})

function formatDictionarySource(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) {
    return '本地词典'
  }

  const normalized = trimmed.replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).pop() ?? trimmed
  const label = fileName.replace(/\.(ifo|csv|db|sqlite)$/i, '')

  return label || '本地词典'
}

function DictionaryEntryCard({
  entry,
  hasDocument,
  isSaved,
  onAdd
}: {
  entry: DictionaryEntryRecord
  hasDocument: boolean
  isSaved: boolean
  onAdd: (entry: DictionaryEntryRecord) => void
}): JSX.Element {
  const definition = useMemo(() => makeDefinitionFromDictionary(entry), [entry])
  const sourceLabel = useMemo(() => formatDictionarySource(entry.source), [entry.source])

  return (
    <article className="dictionary-entry-card">
      <div className="dictionary-entry-heading">
        <strong>{entry.word}</strong>
        <span title={entry.source}>{sourceLabel}</span>
      </div>
      <VocabularyDefinition definition={definition} />
      {entry.exchange && (
        <div className="dictionary-exchange">
          <strong>词形</strong>
          <span>{entry.exchange}</span>
        </div>
      )}
      <button disabled={!hasDocument || isSaved} onClick={() => onAdd(entry)}>
        <BookMarked size={15} />
        {!hasDocument ? '先打开 PDF' : isSaved ? '已在生词本' : '加入本 PDF 生词'}
      </button>
    </article>
  )
}

export function VocabularyPanel({
  dictionarySources,
  hasDocument,
  vocabulary,
  onAddDictionaryEntry,
  onDefine,
  onDelete,
  onImportDictionary
}: VocabularyPanelProps): JSX.Element {
  const queryRef = useRef('')
  const dictionaryQueryRef = useRef('')
  const queryTimerRef = useRef<number | null>(null)
  const dictionaryQueryTimerRef = useRef<number | null>(null)
  const [appliedQuery, setAppliedQuery] = useState('')
  const [appliedDictionaryQuery, setAppliedDictionaryQuery] = useState('')
  const [dictionarySuggestions, setDictionarySuggestions] = useState<DictionaryEntryRecord[]>([])
  const [hasDictionarySearched, setHasDictionarySearched] = useState(false)
  const [isDictionarySearching, setIsDictionarySearching] = useState(false)
  const [dictionaryError, setDictionaryError] = useState<string | null>(null)
  const filteredVocabulary = useMemo(() => {
    const normalizedQuery = appliedQuery.trim().toLocaleLowerCase()

    return normalizedQuery
      ? vocabulary.filter((item) =>
          [item.word, item.definition, item.sourceSentence ?? '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
      : vocabulary
  }, [appliedQuery, vocabulary])
  const savedWords = useMemo(
    () => new Set(vocabulary.map((item) => item.word.trim().toLocaleLowerCase())),
    [vocabulary]
  )

  useEffect(() => {
    const trimmed = appliedDictionaryQuery.trim()

    if (!trimmed) {
      setDictionarySuggestions([])
      setDictionaryError(null)
      setHasDictionarySearched(false)
      setIsDictionarySearching(false)
      return
    }

    setIsDictionarySearching(true)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.readingPartner
        .suggestDictionary(trimmed, 8)
        .then((result) => {
          if (cancelled) {
            return
          }

          setDictionarySuggestions(result.entries)
          setHasDictionarySearched(true)
          setDictionaryError(null)
        })
        .catch((error) => {
          if (cancelled) {
            return
          }

          setDictionarySuggestions([])
          setHasDictionarySearched(true)
          setDictionaryError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (cancelled) {
            return
          }

          setIsDictionarySearching(false)
        })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [appliedDictionaryQuery])

  useEffect(() => {
    return () => {
      if (queryTimerRef.current) {
        window.clearTimeout(queryTimerRef.current)
      }
      if (dictionaryQueryTimerRef.current) {
        window.clearTimeout(dictionaryQueryTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="inspector-content vocabulary-panel">
      <div className="vocab-tools">
        <section className="dictionary-lookup-panel">
          <div className="vocab-tool-heading">
            <strong>本地词典</strong>
            <button className="secondary-action" onClick={onImportDictionary}>
              <Upload size={16} />
              导入词典
            </button>
          </div>
          <p className="dictionary-status">
            {dictionarySources.length > 0
              ? `已加载 ${dictionarySources.length} 个本地词典`
              : '尚未加载本地词典'}
          </p>
          <form
            className="dictionary-search-form"
            onSubmit={(event) => {
              event.preventDefault()
            }}
          >
            <input
              placeholder="查询任意单词或短语"
              defaultValue=""
              onChange={(event) => {
                dictionaryQueryRef.current = event.target.value
                if (dictionaryQueryTimerRef.current) {
                  window.clearTimeout(dictionaryQueryTimerRef.current)
                }
                dictionaryQueryTimerRef.current = window.setTimeout(() => {
                  setAppliedDictionaryQuery(dictionaryQueryRef.current)
                }, 180)
              }}
              onBlur={() => {
                if (dictionaryQueryTimerRef.current) {
                  window.clearTimeout(dictionaryQueryTimerRef.current)
                  dictionaryQueryTimerRef.current = null
                }
                setAppliedDictionaryQuery(dictionaryQueryRef.current)
              }}
            />
            <button disabled type="submit">
              <Search size={15} />
              {isDictionarySearching ? '联想中' : '自动联想'}
            </button>
          </form>
          {dictionaryError ? (
            <p className="error-text">{dictionaryError}</p>
          ) : dictionarySuggestions.length > 0 ? (
            <div className="dictionary-suggestion-list">
              {dictionarySuggestions.map((entry) => (
                <DictionaryEntryCard
                  entry={entry}
                  hasDocument={hasDocument}
                  isSaved={savedWords.has(entry.word.trim().toLocaleLowerCase())}
                  key={entry.id}
                  onAdd={onAddDictionaryEntry}
                />
              ))}
            </div>
          ) : hasDictionarySearched ? (
            <p className="muted">本地词典中没有找到“{appliedDictionaryQuery.trim()}”。</p>
          ) : (
            <p className="muted">输入时会自动联想本地词典候选，再按需加入当前 PDF 生词本。</p>
          )}
        </section>

        <section className="vocabulary-search-panel">
          <div className="vocab-tool-heading">
            <strong>本 PDF 生词</strong>
            <span>{vocabulary.length} 条</span>
          </div>
          <input
            placeholder="搜索已加入的生词、释义或原句"
            defaultValue=""
            onChange={(event) => {
              queryRef.current = event.target.value
              if (queryTimerRef.current) {
                window.clearTimeout(queryTimerRef.current)
              }
              queryTimerRef.current = window.setTimeout(() => {
                setAppliedQuery(queryRef.current)
              }, 120)
            }}
            onBlur={() => {
              if (queryTimerRef.current) {
                window.clearTimeout(queryTimerRef.current)
                queryTimerRef.current = null
              }
              setAppliedQuery(queryRef.current)
            }}
          />
        </section>
      </div>

      <div className="vocabulary-list">
        {vocabulary.length === 0 ? (
          <p className="muted">选中 PDF 里的单词或短语后点击“生词”，词条会出现在这里。</p>
        ) : filteredVocabulary.length === 0 ? (
          <p className="muted">没有匹配的词汇。</p>
        ) : (
          filteredVocabulary.map((item) => (
            <article className="vocabulary-item" key={item.id}>
              <div className="vocabulary-heading">
                <strong>{item.word}</strong>
                {item.pageNumber && <span>第 {item.pageNumber} 页</span>}
              </div>
              <VocabularyDefinition definition={item.definition} />
              {item.sourceSentence && <blockquote>{item.sourceSentence}</blockquote>}
              <button className="text-button" disabled={!hasDocument} onClick={() => onDefine(item)}>
                <Sparkles size={14} />
                AI 释义
              </button>
              <button className="text-button" onClick={() => onDelete(item.id)}>
                <Trash2 size={14} />
                删除
              </button>
            </article>
          ))
        )}
      </div>
    </div>
  )
}
