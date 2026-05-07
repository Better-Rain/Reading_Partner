import { Search, X } from 'lucide-react'
import type { DocumentSearchResult } from '../../../shared/types'

type SearchPanelProps = {
  hasDocument: boolean
  isSearching: boolean
  query: string
  results: DocumentSearchResult[]
  onJump: (result: DocumentSearchResult) => void
  onClear: () => void
  onQueryChange: (value: string) => void
  onSearch: () => void
}

export function SearchPanel({
  hasDocument,
  isSearching,
  query,
  results,
  onJump,
  onClear,
  onQueryChange,
  onSearch
}: SearchPanelProps): JSX.Element {
  const canSearch = hasDocument && query.trim().length > 0 && !isSearching
  const canClear = query.trim().length > 0 || results.length > 0

  return (
    <div className="inspector-content search-panel">
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <input
          disabled={!hasDocument}
          placeholder="搜索当前文档"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button disabled={!canSearch} type="submit">
          <Search size={16} />
          {isSearching ? '搜索中' : '搜索'}
        </button>
        <button disabled={!canClear} type="button" onClick={onClear}>
          <X size={16} />
          结束
        </button>
      </form>

      <div className="search-result-list">
        {!hasDocument ? (
          <p className="muted">打开 PDF 后可以搜索当前文档。</p>
        ) : results.length === 0 ? (
          <p className="muted">输入关键词后会显示匹配页码和文本片段。</p>
        ) : (
          results.map((result) => (
            <button className="search-result" key={result.id} onClick={() => onJump(result)}>
              <span className="search-result-heading">
                <strong>第 {result.pageNumber} 页</strong>
                <small>匹配度 {result.score}</small>
              </span>
              <span className="search-snippet">{result.snippet}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
