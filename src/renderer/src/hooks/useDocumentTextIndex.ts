import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  DocumentRecord,
  DocumentTextIndexEvent,
  DocumentTextIndexResult
} from '../../../shared/types'

export type TextIndexRunState = {
  documentId: string
  pageCount: number
  pagesIndexed: number
  chunksIndexed: number
  status: 'running' | 'cancelling'
}

type UseDocumentTextIndexParams = {
  refreshLibrary: () => Promise<void>
  setActiveDocument: Dispatch<SetStateAction<DocumentRecord | null>>
  setStatus: Dispatch<SetStateAction<string>>
}

const getTextIndexReadyStatus = (
  result: Pick<DocumentTextIndexResult, 'pageCount' | 'pagesIndexed' | 'chunksIndexed' | 'skipped'>,
  fallbackPageCount?: number
): string => {
  const pageCount = result.pageCount ?? fallbackPageCount ?? result.pagesIndexed

  if (result.pagesIndexed > 0 && result.chunksIndexed === 0) {
    return `共 ${pageCount} 页，未检测到可抽取文字；这可能是扫描图片版 PDF，需要 OCR 后才能选择、搜索正文。`
  }

  return result.skipped
    ? `共 ${pageCount} 页，文本索引已就绪`
    : `文本索引完成：${result.pagesIndexed} 页 / ${result.chunksIndexed} 个片段`
}

export const useDocumentTextIndex = ({
  refreshLibrary,
  setActiveDocument,
  setStatus
}: UseDocumentTextIndexParams): {
  textIndexRun: TextIndexRunState | null
  ensureDocumentTextIndex: (document: DocumentRecord, expectedPageCount: number) => Promise<void>
  cancelCurrentDocumentTextIndex: () => Promise<void>
} => {
  const [textIndexRun, setTextIndexRun] = useState<TextIndexRunState | null>(null)
  const refreshLibraryRef = useRef(refreshLibrary)

  useEffect(() => {
    refreshLibraryRef.current = refreshLibrary
  }, [refreshLibrary])

  const handleDocumentTextIndexEvent = async (event: DocumentTextIndexEvent): Promise<void> => {
    if (event.type === 'start') {
      setTextIndexRun({
        documentId: event.documentId,
        pageCount: event.pageCount,
        pagesIndexed: 0,
        chunksIndexed: 0,
        status: 'running'
      })
      setStatus(`文本索引开始：0 / ${event.pageCount} 页`)
      return
    }

    if (event.type === 'progress') {
      setTextIndexRun({
        documentId: event.documentId,
        pageCount: event.pageCount,
        pagesIndexed: event.pagesIndexed,
        chunksIndexed: event.chunksIndexed,
        status: 'running'
      })
      setStatus(`文本索引中：${event.pagesIndexed} / ${event.pageCount} 页，${event.chunksIndexed} 个片段`)
      return
    }

    if (event.type === 'cancelled') {
      setTextIndexRun((current) =>
        current?.documentId === event.documentId ? null : current
      )
      setStatus('已取消文本索引')
      return
    }

    if (event.type === 'error') {
      setTextIndexRun((current) =>
        current?.documentId === event.documentId ? null : current
      )
      setStatus(`文本索引失败：${event.message}`)
      return
    }

    setTextIndexRun((current) =>
      current?.documentId === event.documentId ? null : current
    )
    setActiveDocument((active) =>
      active?.id === event.documentId ? { ...active, pageCount: event.result.pageCount } : active
    )
    await refreshLibraryRef.current()
    setStatus(getTextIndexReadyStatus(event.result))
  }

  useEffect(() => {
    return window.readingPartner.onDocumentTextIndexEvent((event) => {
      void handleDocumentTextIndexEvent(event)
    })
  }, [])

  const ensureDocumentTextIndex = async (
    document: DocumentRecord,
    expectedPageCount: number
  ): Promise<void> => {
    try {
      const current = await window.readingPartner.getDocumentTextIndexStatus(document.id)

      if (
        current.pageCount === expectedPageCount &&
        current.pagesIndexed >= expectedPageCount
      ) {
        setStatus(
          getTextIndexReadyStatus({
            ...current,
            skipped: true
          })
        )
        return
      }

      setStatus(`共 ${expectedPageCount} 页，正在抽取文本索引...`)
      const result = await window.readingPartner.indexDocumentText(document.id)

      if (result.cancelled) {
        setTextIndexRun(null)
        setStatus('已取消文本索引')
        return
      }
      setActiveDocument((active) =>
        active?.id === result.documentId ? { ...active, pageCount: result.pageCount } : active
      )
      await refreshLibraryRef.current()
      setStatus(getTextIndexReadyStatus(result, expectedPageCount))
    } catch (error) {
      setStatus(`文本索引失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const cancelCurrentDocumentTextIndex = async (): Promise<void> => {
    const currentRun = textIndexRun

    if (!currentRun || currentRun.status === 'cancelling') {
      return
    }

    setTextIndexRun({ ...currentRun, status: 'cancelling' })
    setStatus('正在取消文本索引...')
    const cancelled = await window.readingPartner.cancelDocumentTextIndex(currentRun.documentId)

    if (!cancelled) {
      setTextIndexRun(null)
      setStatus('当前没有正在运行的文本索引任务')
    }
  }

  return {
    textIndexRun,
    ensureDocumentTextIndex,
    cancelCurrentDocumentTextIndex
  }
}
