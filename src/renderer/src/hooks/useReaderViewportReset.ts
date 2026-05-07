import { RefObject, useRef } from 'react'

export const useReaderViewportReset = (
  readerSurfaceRef: RefObject<HTMLDivElement | null>
): {
  requestReaderViewportReset: () => void
  resetReaderViewportAfterRender: () => void
} => {
  const pendingReaderViewportResetRef = useRef(false)

  const resetReaderViewport = (): void => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const surface = readerSurfaceRef.current

        if (!surface) {
          return
        }

        surface.scrollTop = 0
        surface.scrollLeft = Math.max(0, (surface.scrollWidth - surface.clientWidth) / 2)
      })
    })
  }

  const requestReaderViewportReset = (): void => {
    pendingReaderViewportResetRef.current = true
  }

  const resetReaderViewportAfterRender = (): void => {
    if (!pendingReaderViewportResetRef.current) {
      return
    }

    pendingReaderViewportResetRef.current = false
    resetReaderViewport()
  }

  return {
    requestReaderViewportReset,
    resetReaderViewportAfterRender
  }
}
