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

const verticalOverlapRatio = (first: AnnotationRect, second: AnnotationRect): number => {
  const top = Math.max(first.top, second.top)
  const bottom = Math.min(first.top + first.height, second.top + second.height)
  const overlap = Math.max(0, bottom - top)
  const shorterHeight = Math.min(first.height, second.height)

  return shorterHeight > 0 ? overlap / shorterHeight : 0
}

const mergeLineRects = (rects: AnnotationRect[]): AnnotationRect[] => {
  const merged: AnnotationRect[] = []

  for (const rect of rects) {
    const previous = merged.at(-1)

    if (!previous) {
      merged.push(rect)
      continue
    }

    const averageHeight = (previous.height + rect.height) / 2
    const gap = rect.left - (previous.left + previous.width)
    const sameLine = verticalOverlapRatio(previous, rect) >= 0.62
    const closeEnough = gap <= Math.max(4, Math.min(18, averageHeight * 0.8))

    if (sameLine && closeEnough) {
      const left = Math.min(previous.left, rect.left)
      const top = Math.min(previous.top, rect.top)
      const right = Math.max(previous.left + previous.width, rect.left + rect.width)
      const bottom = Math.max(previous.top + previous.height, rect.top + rect.height)

      merged[merged.length - 1] = {
        left,
        top,
        width: right - left,
        height: bottom - top
      }
      continue
    }

    merged.push(rect)
  }

  return merged
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

  const visibleRects = sorted.filter((rect, index) => {
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

  return mergeLineRects(
    visibleRects.sort((first, second) => {
      const topDelta = first.top - second.top

      if (Math.abs(topDelta) > 1) {
        return topDelta
      }

      return first.left - second.left
    })
  )
}
