import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
  TextAreaField,
} from '@miniapp/shared'
import type { Agent, AgentBlacklistEntry, BlacklistAddEntry } from '@miniapp/shared'

interface Props {
  account: Agent
}

export function BlacklistSection({ account }: Props) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<AgentBlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [userId, setUserId] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [bulkPhones, setBulkPhones] = useState('')
  const [adding, setAdding] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolvedEntries, setResolvedEntries] = useState<BlacklistAddEntry[]>([])

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

  function resetAddForm() {
    setUserId('')
    setUsername('')
    setPhone('')
    setReason('')
    setBulkPhones('')
    setResolvedEntries([])
  }

  async function handleResolve() {
    const phones = bulkPhones.split('\n').map(p => p.trim()).filter(Boolean)
    if (!phones.length) return
    setResolving(true)
    try {
      const result = await agentsApi.resolveBlacklistPhones(account.id, phones)
      setResolvedEntries(result.resolved.map(r => ({
        tg_user_id: r.tg_user_id ?? undefined,
        username: r.username ?? undefined,
        phone: r.phone ?? undefined,
        reason: undefined,
      })))
    } catch (err: any) {
      setError(err.message || t('blacklist.resolveError'))
    }
    setResolving(false)
  }

  async function handleAdd() {
    const singleEntry: BlacklistAddEntry[] = []
    if (userId) singleEntry.push({ tg_user_id: Number(userId), reason: reason.trim() || undefined })
    else if (username) singleEntry.push({ username: username.trim().replace(/^@/, ''), reason: reason.trim() || undefined })
    else if (phone) singleEntry.push({ phone: phone.trim(), reason: reason.trim() || undefined })

    const allEntries = [...singleEntry, ...resolvedEntries]
    if (!allEntries.length) return

    setAdding(true)
    try {
      const result = await agentsApi.addBlacklistEntries(account.id, allEntries)
      setEntries(prev => [...result.entries, ...prev])
      resetAddForm()
      setShowAddForm(false)
    } catch (err: any) {
      setError(err.message || t('blacklist.addError'))
    }
    setAdding(false)
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

        {!showAddForm ? (
          <Button onClick={() => { setShowAddForm(true); setError(null) }}>
            {t('blacklist.addEntry')}
          </Button>
        ) : (
          <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12 }}>
            <InputField label={t('blacklist.userId')} value={userId} onChange={setUserId} placeholder="123456789" />
            <InputField label={t('blacklist.username')} value={username} onChange={setUsername} placeholder="@username" />
            <InputField label={t('blacklist.phone')} value={phone} onChange={setPhone} placeholder="+966501234567" />
            <InputField label={t('blacklist.reason')} value={reason} onChange={setReason} placeholder={t('blacklist.reasonPlaceholder')} />
            <div style={{ borderTop: '1px solid var(--miniapp-border-soft)', margin: '4px 0' }} />
            <Note tone="neutral">{t('blacklist.bulkPhonesHint')}</Note>
            <TextAreaField label={t('blacklist.bulkPhones')} value={bulkPhones} onChange={setBulkPhones} placeholder="+966501234567&#10;+966507654321" />
            {bulkPhones.trim() ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button onClick={() => void handleResolve()} disabled={resolving} tone="secondary">
                  {resolving ? t('blacklist.resolving') : t('blacklist.resolve')}
                </Button>
              </div>
            ) : null}
            {resolvedEntries.length > 0 && (
              <Note>{t('blacklist.resolvedCount', { count: resolvedEntries.length })}</Note>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void handleAdd()} disabled={adding || (!userId && !username && !phone && !resolvedEntries.length)}>
                {adding ? t('blacklist.adding') : t('blacklist.add')}
              </Button>
              <Button tone="secondary" onClick={() => { setShowAddForm(false); resetAddForm() }}>
                {t('blacklist.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
