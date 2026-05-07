export type AnnotationRect = {
  left: number
  top: number
  width: number
  height: number
}

const rectArea = (rect: AnnotationRect): number => rect.width * rect.height

const rectOverlapArea = (first: AnnotationRect, second: AnnotationRect): number => {
  const left = Math.max(first.left, second.left)
  const top = Math.max(first.top, second.top)
  const right = Math.min(first.left + first.width, second.left + second.width)
  const bottom = Math.min(first.top + first.height, second.top + second.height)

  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

export const normalizeAnnotationRects = (rects: AnnotationRect[]): AnnotationRect[] => {
  const sorted = [...rects].sort((first, second) => {
    const topDelta = first.top - second.top

    if (Math.abs(topDelta) > 1) {
      return topDelta
    }

    const areaDelta = rectArea(second) - rectArea(first)

    if (Math.abs(areaDelta) > 1) {
      return areaDelta
    }

    return first.left - second.left
  })

  return sorted.filter((rect, index) => {
    const area = rectArea(rect)

    if (area <= 0) {
      return false
    }

    return !sorted.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false
      }

      const candidateArea = rectArea(candidate)

      if (candidateArea < area) {
        return false
      }

      if (Math.abs(candidateArea - area) <= 0.5 && candidateIndex > index) {
        return false
      }

      const overlap = rectOverlapArea(rect, candidate)

      return overlap / area >= 0.82
    })
  })
}
