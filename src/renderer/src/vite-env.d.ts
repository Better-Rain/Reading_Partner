/// <reference types="vite/client" />

import type { ReadingPartnerApi } from '../../shared/types'

declare global {
  interface Window {
    readingPartner: ReadingPartnerApi
  }
}

