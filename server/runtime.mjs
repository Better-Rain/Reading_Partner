import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
export const handlers = new Map()
export const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
export const app = { getPath: () => process.env.RP_DATA }
export class BrowserWindow {}
export const dialog = {}
const key = () => readFileSync(join(process.env.RP_DATA, 'provider.key'))
export const safeStorage = {
  isEncryptionAvailable: () => key().length === 32,
  encryptString(value) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key(), iv)
    const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), bytes])
  },
  decryptString(buffer) {
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      buffer.subarray(0, 12),
    )
    cipher.setAuthTag(buffer.subarray(12, 28))
    return Buffer.concat([
      cipher.update(buffer.subarray(28)),
      cipher.final(),
    ]).toString('utf8')
  },
}
