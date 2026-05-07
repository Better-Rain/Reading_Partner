import type { DictionaryEntryRecord } from '../../shared/types'

export const makeDefinitionFromDictionary = (entry: DictionaryEntryRecord): string => {
  const lines = [
    entry.translation ? `释义：${entry.translation}` : null,
    entry.definition ? `英文释义：${entry.definition}` : null,
    entry.phonetic ? `音标：${entry.phonetic}` : null,
    entry.pos ? `词性：${entry.pos}` : null,
    entry.exchange ? `词形：${entry.exchange}` : null
  ].filter(Boolean)

  return lines.join('\n') || '待补充释义'
}
