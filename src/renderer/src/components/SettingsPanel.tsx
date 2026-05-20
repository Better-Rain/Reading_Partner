import { useEffect, useState } from 'react'
import { Check, KeyRound, Pencil, X } from 'lucide-react'
import type { AIProviderRecord } from '../../../shared/types'

type SettingsPanelProps = {
  configuredProviderIds: Set<string>
  providers: AIProviderRecord[]
  readerName: string
  onClearKey: (providerId: string) => void
  onReaderNameChange: (value: string) => void
  onSaveKey: (providerId: string, apiKey: string) => void
  onToggle: (provider: AIProviderRecord, enabled: boolean) => void
  onUpdateModel: (provider: AIProviderRecord, defaultModel: string) => void
}

export function SettingsPanel({
  configuredProviderIds,
  providers,
  readerName,
  onClearKey,
  onReaderNameChange,
  onSaveKey,
  onToggle,
  onUpdateModel
}: SettingsPanelProps): JSX.Element {
  const [readerNameDraft, setReaderNameDraft] = useState(readerName)
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({})
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setReaderNameDraft(readerName)
  }, [readerName])

  return (
    <div className="inspector-content">
      <div className="settings-intro">
        <h2>AI Provider</h2>
        <p>API Key 会在主进程通过 Electron safeStorage 加密保存，页面只显示是否已配置。</p>
      </div>

      <section className="identity-card">
        <div>
          <strong>阅读身份</strong>
          <span>新建批注、高亮和书签会带上这个名字。</span>
        </div>
        <input
          placeholder="例如：Rain"
          value={readerNameDraft}
          onChange={(event) => setReaderNameDraft(event.target.value)}
          onBlur={() => onReaderNameChange(readerNameDraft)}
        />
      </section>

      <div className="provider-list">
        {providers.map((provider) => {
          const configured = configuredProviderIds.has(provider.id)

          return (
            <article className="provider-item" key={provider.id}>
              <div className="provider-heading">
                <div>
                  <strong>{provider.label}</strong>
                  {editingModelId === provider.id ? (
                    <div className="provider-model-editor">
                      <input
                        autoFocus
                        value={modelDrafts[provider.id] ?? provider.defaultModel}
                        onChange={(event) =>
                          setModelDrafts((items) => ({
                            ...items,
                            [provider.id]: event.target.value
                          }))
                        }
                      />
                      <button
                        className="text-button neutral"
                        disabled={!(modelDrafts[provider.id] ?? provider.defaultModel).trim()}
                        onClick={() => {
                          onUpdateModel(provider, modelDrafts[provider.id] ?? provider.defaultModel)
                          setEditingModelId(null)
                        }}
                      >
                        <Check size={13} />
                        保存
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setModelDrafts((items) => ({
                            ...items,
                            [provider.id]: provider.defaultModel
                          }))
                          setEditingModelId(null)
                        }}
                      >
                        <X size={13} />
                        取消
                      </button>
                    </div>
                  ) : (
                    <span className="provider-model-row">
                      {provider.defaultModel}
                      <button
                        className="text-button neutral"
                        onClick={() => {
                          setModelDrafts((items) => ({
                            ...items,
                            [provider.id]: provider.defaultModel
                          }))
                          setEditingModelId(provider.id)
                        }}
                      >
                        <Pencil size={13} />
                        修改模型
                      </button>
                    </span>
                  )}
                </div>
                <label className="switch">
                  <input
                    checked={provider.enabled}
                    type="checkbox"
                    onChange={(event) => onToggle(provider, event.target.checked)}
                  />
                  <span />
                </label>
              </div>
              <code>{provider.baseUrl}</code>
              <div className="provider-tags">
                {provider.supportsThinking && <span>thinking</span>}
                {provider.supportsLongContext && <span>long context</span>}
                <span className={configured ? 'tag-ok' : 'tag-warn'}>
                  <KeyRound size={12} />
                  {configured ? 'key saved' : 'no key'}
                </span>
              </div>
              <div className="key-row">
                <input
                  placeholder={configured ? '输入新 Key 可覆盖当前保存值' : '粘贴 API Key'}
                  type="password"
                  value={draftKeys[provider.id] ?? ''}
                  onChange={(event) =>
                    setDraftKeys((items) => ({ ...items, [provider.id]: event.target.value }))
                  }
                />
                <button
                  disabled={!draftKeys[provider.id]?.trim()}
                  onClick={() => {
                    onSaveKey(provider.id, draftKeys[provider.id] ?? '')
                    setDraftKeys((items) => ({ ...items, [provider.id]: '' }))
                  }}
                >
                  保存
                </button>
                <button disabled={!configured} onClick={() => onClearKey(provider.id)}>
                  清除
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
