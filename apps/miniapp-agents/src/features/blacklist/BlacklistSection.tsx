import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
} from '@miniapp/shared'
import type { Agent, AgentBlacklistEntry } from '@miniapp/shared'

interface Props {
  account: Agent
}

export function BlacklistSection({ account }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<AgentBlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState<AgentBlacklistEntry | null>(null)
  const [userId, setUserId] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function loadEntries() {
    setLoading(true)
    try {
      const data = await agentsApi.fetchBlacklist(account.id)
      setEntries(data.entries)
    } catch (err: any) {
      setError(err.message || t('blacklist.loadError'))
    }
    setLoading(false)
  }

  useEffect(() => { void loadEntries() }, [account.id])

  async function handleDelete(entryId: number) {
    try {
      await agentsApi.deleteBlacklistEntry(account.id, entryId)
      setEntries(prev => prev.filter(e => e.id !== entryId))
    } catch (err: any) {
      setError(err.message || t('blacklist.deleteError'))
    }
  }

  function resetForm() {
    setUserId('')
    setUsername('')
    setPhone('')
    setReason('')
    setEditingEntry(null)
  }

  function startEdit(entry: AgentBlacklistEntry) {
    setEditingEntry(entry)
    setUserId(entry.tg_user_id ? String(entry.tg_user_id) : '')
    setUsername(entry.username || '')
    setPhone(entry.phone || '')
    setReason(entry.reason || '')
    setShowForm(true)
    setError(null)
  }

  async function handleSave() {
    const hasUserId = userId.trim() && /^\d+$/.test(userId.trim())
    const hasUsername = username.trim().length > 0
    const hasPhone = phone.trim().length > 0
    if (!hasUserId && !hasUsername && !hasPhone) return

    setSaving(true)
    try {
      if (editingEntry) {
        await agentsApi.deleteBlacklistEntry(account.id, editingEntry.id)
        setEntries(prev => prev.filter(e => e.id !== editingEntry.id))
      }

      const entry: Record<string, unknown> = { reason: reason.trim() || undefined }
      if (hasUserId) entry.tg_user_id = Number(userId.trim())
      if (hasUsername) entry.username = username.trim().replace(/^@/, '')
      if (hasPhone) entry.phone = phone.trim()

      const result = await agentsApi.addBlacklistEntries(account.id, [entry as any])
      setEntries(prev => [...result.entries, ...prev])
      resetForm()
      setShowForm(false)
    } catch (err: any) {
      setError(err.message || t(editingEntry ? 'blacklist.updateError' : 'blacklist.addError'))
    }
    setSaving(false)
  }

  return (
    <Card title={t('blacklist.title')} subtitle={t('blacklist.subtitle')}>
      <div style={{ display: 'grid', gap: 12 }}>
        {error && <Note tone="warning">{error}</Note>}

        {loading ? (
          <Note>{t('blacklist.loading')}</Note>
        ) : entries.length === 0 ? (
          <Note>{t('blacklist.empty')}</Note>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {entries.map(entry => (
              <div
                key={entry.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', border: '1px solid var(--miniapp-border-soft)',
                  borderRadius: 12, background: 'var(--miniapp-surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {entry.tg_user_id ? `#${entry.tg_user_id}` : entry.username ? `@${entry.username}` : entry.phone || '—'}
                  </div>
                  <div style={{ color: 'var(--miniapp-text-muted)', fontSize: 11, marginTop: 2 }}>
                    {entry.reason ? <span>{t('blacklist.reason')}: {entry.reason} · </span> : null}
                    {entry.created_at || ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--miniapp-text-muted)', fontSize: 12, fontWeight: 600,
                    padding: '4px 8px', borderRadius: 6, fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  {t('blacklist.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(entry.id)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--miniapp-clay)', fontSize: 12, fontWeight: 600,
                    padding: '4px 8px', borderRadius: 6, fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  {t('blacklist.remove')}
                </button>
              </div>
            ))}
          </div>
        )}

        {!showForm ? (
          <Button onClick={() => { setShowForm(true); setError(null) }}>
            {t('blacklist.addEntry')}
          </Button>
        ) : (
          <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12 }}>
            {editingEntry ? (
              <Note tone="neutral">{t('blacklist.editing', { id: editingEntry.tg_user_id ? `#${editingEntry.tg_user_id}` : editingEntry.username ? `@${editingEntry.username}` : editingEntry.phone || '' })}</Note>
            ) : null}
            <InputField label={t('blacklist.userId')} value={userId} onChange={setUserId} placeholder={t('blacklist.userIdPlaceholder')} />
            <InputField label={t('blacklist.username')} value={username} onChange={setUsername} placeholder={t('blacklist.usernamePlaceholder')} />
            <InputField label={t('blacklist.phone')} value={phone} onChange={setPhone} placeholder={t('blacklist.phonePlaceholder')} />
            <InputField label={t('blacklist.reason')} value={reason} onChange={setReason} placeholder={t('blacklist.reasonPlaceholder')} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void handleSave()} disabled={saving || (!userId.trim() && !username.trim() && !phone.trim())}>
                {saving ? t('blacklist.saving') : editingEntry ? t('blacklist.saveEdit') : t('blacklist.add')}
              </Button>
              <Button tone="secondary" onClick={() => { setShowForm(false); resetForm() }}>
                {t('blacklist.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
