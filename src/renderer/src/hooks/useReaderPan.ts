import { Dispatch, MutableRefObject, SetStateAction, useEffect } from 'react'

export type PanState = {
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}

export const useReaderPan = (
  panStateRef: MutableRefObject<PanState | null>,
  readerSurfaceRef: MutableRefObject<HTMLDivElement | null>,
  suppressSelectionRef: MutableRefObject<boolean>,
  setIsPanning: Dispatch<SetStateAction<boolean>>
): void => {
  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent): void => {
      const panState = panStateRef.current
      const surface = readerSurfaceRef.current

      if (!panState || !surface) {
        return
      }

      event.preventDefault()
      const deltaX = event.clientX - panState.startX
      const deltaY = event.clientY - panState.startY

      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        suppressSelectionRef.current = true
      }

      surface.scrollLeft = panState.scrollLeft - deltaX
      surface.scrollTop = panState.scrollTop - deltaY
    }

    const handleWindowMouseUp = (event: MouseEvent): void => {
      if (!panStateRef.current) {
        return
      }

      event.preventDefault()
      panStateRef.current = null
      setIsPanning(false)

      window.setTimeout(() => {
        suppressSelectionRef.current = false
      }, 0)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [panStateRef, readerSurfaceRef, setIsPanning, suppressSelectionRef])
}
