import type { Dispatch, SetStateAction } from 'react'
import type {
  AnnotationRecord,
  DictionaryEntryRecord,
  DocumentRecord,
  VocabularyRecord
} from '../../../shared/types'
import type { AnnotationRect } from '../annotationGeometry'
import { makeDefinitionFromDictionary } from '../vocabularyUtils'

type UseVocabularyActionsParams = {
  activeDocument: DocumentRecord | null
  pageNumber: number
  readerName: string
  selectedAnnotationColor: string
  selectionRects: AnnotationRect[]
  selectionText: string | null
  vocabulary: VocabularyRecord[]
  refreshDictionarySources: () => Promise<void>
  setAnnotations: Dispatch<SetStateAction<AnnotationRecord[]>>
  setSelection: (selection: null) => void
  setStatus: Dispatch<SetStateAction<string>>
  setVocabulary: Dispatch<SetStateAction<VocabularyRecord[]>>
}

export const useVocabularyActions = ({
  activeDocument,
  pageNumber,
  readerName,
  selectedAnnotationColor,
  selectionRects,
  selectionText,
  vocabulary,
  refreshDictionarySources,
  setAnnotations,
  setSelection,
  setStatus,
  setVocabulary
}: UseVocabularyActionsParams): {
  createVocabularyFromSelection: () => Promise<void>
  addDictionaryEntryToVocabulary: (entry: DictionaryEntryRecord) => Promise<void>
  importDictionary: () => Promise<void>
  deleteVocabulary: (id: string) => Promise<void>
} => {
  const createVocabularyFromSelection = async (): Promise<void> => {
    if (!activeDocument || !selectionText) {
      return
    }

    try {
      const word = selectionText.replace(/\s+/g, ' ').trim()
      const lookup = await window.readingPartner.lookupDictionary(word)
      const definition = lookup.entry ? makeDefinitionFromDictionary(lookup.entry) : '待补充释义'
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word,
        definition,
        sourceSentence: selectionText,
        pageNumber
      })

      try {
        const annotation = await window.readingPartner.createAnnotation({
          documentId: activeDocument.id,
          type: 'note',
          pageNumber,
          selectedText: selectionText,
          color: selectedAnnotationColor,
          note: `生词：${word}\n\n释义：${definition}`,
          rectsJson: selectionRects.length ? JSON.stringify(selectionRects) : null,
          vocabularyId: created.id,
          authorName: readerName.trim() || 'Reader'
        })
        const linked = await window.readingPartner.linkVocabularyAnnotation(created.id, annotation.id)

        setVocabulary((items) => [linked, ...items])
        setAnnotations((items) => [...items, annotation])
      } catch (error) {
        console.error('Failed to create vocabulary annotation', error)
        setVocabulary((items) => [created, ...items])
        setSelection(null)
        setStatus(
          `已加入词汇本，但创建生词批注失败：${error instanceof Error ? error.message : String(error)}`
        )
        return
      }

      setSelection(null)
      setStatus(
        lookup.entry
          ? '已用本地词典释义加入词汇本，并创建生词批注'
          : '已加入词汇本并创建生词批注，未命中本地词典'
      )
    } catch (error) {
      setStatus(`加入词汇本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const addDictionaryEntryToVocabulary = async (entry: DictionaryEntryRecord): Promise<void> => {
    if (!activeDocument) {
      return
    }

    const exists = vocabulary.some(
      (item) => item.word.trim().toLocaleLowerCase() === entry.word.trim().toLocaleLowerCase()
    )

    if (exists) {
      setStatus(`“${entry.word}” 已在当前 PDF 生词本中`)
      return
    }

    try {
      const created = await window.readingPartner.createVocabulary({
        documentId: activeDocument.id,
        word: entry.word,
        definition: makeDefinitionFromDictionary(entry),
        pageNumber: null
      })

      setVocabulary((items) => [created, ...items])
      setStatus(`已将“${entry.word}”加入当前 PDF 生词本`)
    } catch (error) {
      setStatus(`加入生词本失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const importDictionary = async (): Promise<void> => {
    try {
      const result = await window.readingPartner.importDictionaryCsvDialog()

      if (!result) {
        return
      }

      setStatus(`词典导入完成：${result.imported} 条，跳过 ${result.skipped} 条`)
      await refreshDictionarySources()
    } catch (error) {
      setStatus(`词典导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const deleteVocabulary = async (id: string): Promise<void> => {
    const deleted = vocabulary.find((item) => item.id === id)

    try {
      await window.readingPartner.deleteVocabulary(id)
      setVocabulary((items) => items.filter((item) => item.id !== id))
      setAnnotations((items) =>
        items.filter(
          (item) => item.vocabularyId !== id && (!deleted?.annotationId || item.id !== deleted.annotationId)
        )
      )
      setStatus('已删除词汇')
    } catch (error) {
      setStatus(`删除词汇失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    createVocabularyFromSelection,
    addDictionaryEntryToVocabulary,
    importDictionary,
    deleteVocabulary
  }
}
