import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

type StoredSecrets = Record<string, string>

export class KeyStore {
  constructor(private readonly secretsPath: string) {
    mkdirSync(dirname(secretsPath), { recursive: true })
  }

  has(ref: string | null): boolean {
    if (!ref) {
      return false
    }

    return Boolean(this.readAll()[ref])
  }

  listConfigured(refs: Array<{ providerId: string; apiKeyRef: string | null }>): Array<{
    providerId: string
    configured: boolean
  }> {
    const secrets = this.readAll()

    return refs.map((item) => ({
      providerId: item.providerId,
      configured: Boolean(item.apiKeyRef && secrets[item.apiKeyRef])
    }))
  }

  set(ref: string, value: string): void {
    const trimmed = value.trim()

    if (!trimmed) {
      throw new Error('API Key cannot be empty.')
    }

    const secrets = this.readAll()
    secrets[ref] = this.encrypt(trimmed)
    this.writeAll(secrets)
  }

  get(ref: string | null): string {
    if (!ref) {
      throw new Error('API Key is not configured for this provider.')
    }

    const encrypted = this.readAll()[ref]

    if (!encrypted) {
      throw new Error('API Key is not configured for this provider.')
    }

    return this.decrypt(encrypted)
  }

  delete(ref: string | null): void {
    if (!ref) {
      return
    }

    const secrets = this.readAll()
    delete secrets[ref]
    this.writeAll(secrets)
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron safeStorage encryption is not available on this system.')
    }

    return safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron safeStorage encryption is not available on this system.')
    }

    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  }

  private readAll(): StoredSecrets {
    if (!existsSync(this.secretsPath)) {
      return {}
    }

    return JSON.parse(readFileSync(this.secretsPath, 'utf8')) as StoredSecrets
  }

  private writeAll(secrets: StoredSecrets): void {
    writeFileSync(this.secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8')
  }
}

