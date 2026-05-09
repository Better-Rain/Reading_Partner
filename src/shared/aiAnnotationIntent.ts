const annotationIntentPattern =
  /(批注|注释|标注|旁注|做笔记|写笔记|生成笔记|创建笔记|添加笔记|annotation|annotate|make\s+(a\s+)?note|create\s+(an?\s+)?note)/i

const negativeAnnotationIntentPattern =
  /(不要|不用|别|无需|不需要|禁止|do\s+not|don't|no)\s*.{0,8}(批注|注释|标注|笔记|annotation|annotate|note)/i

export const hasExplicitAnnotationIntent = (message: string): boolean => {
  const normalized = message.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return false
  }

  return annotationIntentPattern.test(normalized) && !negativeAnnotationIntentPattern.test(normalized)
}
