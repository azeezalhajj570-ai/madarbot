import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { agentsApi } from '@miniapp/shared'
import type { Agent } from '@miniapp/shared'

const TEXTAREA_STYLE: React.CSSProperties = {
  flex: 1,
  boxSizing: 'border-box',
  background: 'var(--miniapp-surface)',
  border: '1px solid var(--miniapp-border-soft)',
  borderRadius: 'var(--miniapp-radius-sm)',
  padding: '10px 12px',
  fontFamily: 'var(--miniapp-sans)',
  fontSize: 13,
  color: 'var(--miniapp-text-primary)',
  resize: 'vertical',
  lineHeight: '18px',
  minHeight: 72,
}

/**
 * Message + media composer used by the send-messages flow. Owns the add/remove
 * message rows and the per-row media upload state, so the parent only sees
 * `messages` and `mediaUrls`.
 */
export function MessageComposer({
  account,
  messages,
  mediaUrls,
  onChange,
  onError,
}: {
  account: Agent
  messages: string[]
  mediaUrls: (string | null)[]
  onChange: (messages: string[], mediaUrls: (string | null)[]) => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  function updateMessages(next: string[]) {
    onChange(next, mediaUrls)
  }

  function updateMediaUrls(next: (string | null)[]) {
    onChange(messages, next)
  }

  async function handleUpload(index: number, file: File) {
    const MAX_SIZE = 20 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      onError(t('campaigns.fileTooLarge'))
      return
    }
    setUploadingIdx(index)
    try {
      const data = await agentsApi.uploadAgentMedia(account.id, file)
      const next = [...mediaUrls]
      next[index] = data.url
      updateMediaUrls(next)
    } catch (err) {
      onError(err instanceof Error ? err.message : t('campaigns.uploadFailed'))
    } finally {
      setUploadingIdx(null)
    }
  }

  return (
    <div className="mb-composer">
      {messages.map((msg, i) => (
        <div key={i} className="mb-composer-row">
          <div className="mb-composer-text">
            <textarea
              value={msg}
              onChange={(e) => {
                const next = [...messages]
                next[i] = e.target.value
                updateMessages(next)
              }}
              rows={3}
              placeholder={t('campaigns.messagePlaceholder')}
              style={TEXTAREA_STYLE}
            />
            {messages.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  updateMessages(messages.filter((_, j) => j !== i))
                  updateMediaUrls(mediaUrls.filter((_, j) => j !== i))
                }}
                aria-label={t('campaigns.removeMessage')}
                style={{
                  flexShrink: 0,
                  background: 'var(--miniapp-bg)',
                  color: 'var(--miniapp-coral)',
                  border: '1px solid var(--miniapp-border-soft)',
                  borderRadius: 'var(--miniapp-radius-sm)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <div className="mb-composer-media">
            <label className="mb-attach">
              <span>
                {uploadingIdx === i
                  ? '⏳ ' + t('campaigns.uploading')
                  : mediaUrls[i]
                    ? '📎 ' + decodeURIComponent(mediaUrls[i]!.split('/').pop() || 'file')
                    : '+ ' + t('campaigns.attachMedia')}
              </span>
              <input
                type="file"
                accept="image/*,video/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleUpload(i, file)
                }}
              />
            </label>
            {mediaUrls[i] ? (
              <button
                type="button"
                onClick={() => {
                  const next = [...mediaUrls]
                  next[i] = null
                  updateMediaUrls(next)
                }}
                aria-label={t('campaigns.removeMedia')}
                style={{
                  flexShrink: 0,
                  background: 'none',
                  color: 'var(--miniapp-coral)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: '4px',
                }}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          updateMessages([...messages, ''])
          updateMediaUrls([...mediaUrls, null])
        }}
        style={{
          background: 'var(--miniapp-bg)',
          color: 'var(--miniapp-text-primary)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 'var(--miniapp-radius-sm)',
          padding: '8px 12px',
          cursor: 'pointer',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: 'fit-content',
        }}
      >
        + {t('campaigns.addMessage')}
      </button>
    </div>
  )
}
