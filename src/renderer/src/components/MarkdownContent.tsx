import { memo, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { extractAIReasoning, stripAIAssistedAnnotationBlock } from '../aiText'

const tableCellSeparatorPlaceholder = '\u0000PIPE\u0000'

const renderInlineMarkdown = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${match.index}-${token}`

    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

const isMarkdownTableRow = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4
}

const isMarkdownTableDivider = (line: string): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim())

const splitMarkdownTableRow = (line: string): string[] => {
  const protectedLine = line.replace(/\\\|/g, tableCellSeparatorPlaceholder)
  const trimmed = protectedLine.trim().replace(/^\|/, '').replace(/\|$/, '')

  return trimmed
    .split('|')
    .map((cell) => cell.replaceAll(tableCellSeparatorPlaceholder, '|').trim())
}

const isMarkdownTableStart = (lines: string[], index: number): boolean =>
  isMarkdownTableRow(lines[index] ?? '') && isMarkdownTableDivider(lines[index + 1] ?? '')

const normalizeMarkdownTableCells = (cells: string[], width: number): string[] => {
  if (cells.length >= width) {
    return cells.slice(0, width)
  }

  return [...cells, ...Array.from({ length: width - cells.length }, () => '')]
}

function ReasoningDisclosure({ text }: { text: string }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <section className={isOpen ? 'ai-reasoning-block is-open' : 'ai-reasoning-block'}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
      >
        <ChevronDown size={14} />
        思考过程
      </button>
      {isOpen && <p>{text}</p>}
    </section>
  )
}

function MarkdownContentComponent({ text }: { text: string }): JSX.Element {
  const { reasoning, content } = extractAIReasoning(stripAIAssistedAnnotationBlock(text))
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const nextBlocks: ReactNode[] = []
    let index = 0

    while (index < lines.length) {
      const line = lines[index]
      const trimmed = line.trim()

      if (!trimmed) {
        index += 1
        continue
      }

      if (trimmed.startsWith('### ')) {
        nextBlocks.push(<h3 key={index}>{renderInlineMarkdown(trimmed.slice(4))}</h3>)
        index += 1
        continue
      }

      if (trimmed.startsWith('## ')) {
        nextBlocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(3))}</h2>)
        index += 1
        continue
      }

      if (trimmed.startsWith('# ')) {
        nextBlocks.push(<h2 key={index}>{renderInlineMarkdown(trimmed.slice(2))}</h2>)
        index += 1
        continue
      }

      if (isMarkdownTableStart(lines, index)) {
        const blockIndex = index
        const header = splitMarkdownTableRow(lines[index])
        const columnCount = Math.max(header.length, 1)
        const rows: string[][] = []
        index += 2

        while (index < lines.length && isMarkdownTableRow(lines[index])) {
          rows.push(normalizeMarkdownTableCells(splitMarkdownTableRow(lines[index]), columnCount))
          index += 1
        }

        nextBlocks.push(
          <div className="markdown-table-scroll" key={blockIndex}>
            <table>
              <thead>
                <tr>
                  {normalizeMarkdownTableCells(header, columnCount).map((cell, cellIndex) => (
                    <th key={`${blockIndex}-h-${cellIndex}`}>{renderInlineMarkdown(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${blockIndex}-r-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${blockIndex}-r-${rowIndex}-${cellIndex}`}>
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        continue
      }

      if (trimmed.startsWith('> ')) {
        const items: string[] = []
        const blockIndex = index

        while (index < lines.length && lines[index].trim().startsWith('> ')) {
          items.push(lines[index].trim().slice(2))
          index += 1
        }

        nextBlocks.push(
          <blockquote key={blockIndex}>
            {items.map((item, itemIndex) => (
              <p key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</p>
            ))}
          </blockquote>
        )
        continue
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items: string[] = []
        const blockIndex = index

        while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
          items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
          index += 1
        }

        nextBlocks.push(
          <ul key={blockIndex}>
            {items.map((item, itemIndex) => (
              <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>
        )
        continue
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = []
        const blockIndex = index

        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
          index += 1
        }

        nextBlocks.push(
          <ol key={blockIndex}>
            {items.map((item, itemIndex) => (
              <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>
        )
        continue
      }

      const paragraph: string[] = [trimmed]
      const blockIndex = index
      index += 1

      while (index < lines.length) {
        const next = lines[index].trim()

        if (
          !next ||
          next.startsWith('#') ||
          next.startsWith('> ') ||
          isMarkdownTableStart(lines, index) ||
          /^[-*]\s+/.test(next) ||
          /^\d+\.\s+/.test(next)
        ) {
          break
        }

        paragraph.push(next)
        index += 1
      }

      nextBlocks.push(<p key={blockIndex}>{renderInlineMarkdown(paragraph.join(' '))}</p>)
    }

    return nextBlocks
  }, [content])

  return (
    <div className="markdown-content">
      {reasoning && <ReasoningDisclosure text={reasoning} />}
      {blocks}
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentComponent)
