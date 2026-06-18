import { useEffect, useMemo, useState } from 'react'

import { Button, Card, Field, FieldRow, InlineMessage, Input, Select, ToggleRow } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { fetchGroupSettings, fetchSettingsSchema, updateGroupSettings, testAIPilot } from '../lib/api'
import { useDashboardGroups } from '../lib/use-dashboard-groups'
import { useI18n } from '../lib/i18n'
import type { SettingSchemaEntry, SettingsSchemaCatalog } from '../lib/types'

type ModerationToggleKey = 'anti_spam' | 'anti_ads' | 'anti_spam_mute' | 'anti_ads_mute'
type ModerationLimitKey = 'anti_spam_mute_limit' | 'anti_ads_mute_limit' | 'warn_remove_limit'

const TOGGLE_DEFINITIONS: Array<{
  key: ModerationToggleKey
  title: string
  description: string
  defaultValue: boolean
}> = [
  {
    key: 'anti_spam',
    title: 'Spam detection',
    description: 'Deletes spammy messages using the existing moderation classifier and warning flow.',
    defaultValue: true,
  },
  {
    key: 'anti_ads',
    title: 'Ads detection',
    description: 'Removes advertising messages so the group can enforce anti-promo policy from the dashboard.',
    defaultValue: true,
  },
  {
    key: 'anti_spam_mute',
    title: 'Mute spam senders',
    description: 'Restricts members automatically after they cross the spam threshold.',
    defaultValue: false,
  },
  {
    key: 'anti_ads_mute',
    title: 'Mute ad senders',
    description: 'Restricts members who keep posting ads after the configured threshold.',
    defaultValue: false,
  },
]

const LIMIT_DEFINITIONS: Array<{
  key: ModerationLimitKey
  label: string
  hint: string
  defaultValue: number
}> = [
  {
    key: 'anti_spam_mute_limit',
    label: 'Spam mute limit',
    hint: 'How many spam violations trigger a mute.',
    defaultValue: 1,
  },
  {
    key: 'anti_ads_mute_limit',
    label: 'Ads mute limit',
    hint: 'How many ad removals trigger a mute.',
    defaultValue: 1,
  },
  {
    key: 'warn_remove_limit',
    label: 'Warn remove limit',
    hint: 'How many warnings are allowed before auto-removal.',
    defaultValue: 5,
  },
]

export default function RulesPage() {
  const { t } = useI18n()
  const { groups, currentGroup, currentGroupId, setCurrentGroupId, loading: groupsLoading, error: groupsError } = useDashboardGroups()
  const [settings, setSettings] = useState<Record<string, boolean | number | string>>({})
  const [limitDrafts, setLimitDrafts] = useState<Record<ModerationLimitKey, string>>({
    anti_spam_mute_limit: '1',
    anti_ads_mute_limit: '1',
    warn_remove_limit: '5',
  })
  const [loading, setLoading] = useState(true)
  const [savingToggle, setSavingToggle] = useState<ModerationToggleKey | null>(null)
  const [savingLimits, setSavingLimits] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const [schemaCatalog, setSchemaCatalog] = useState<SettingsSchemaCatalog>({})
  const [pluginSaving, setPluginSaving] = useState<string | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const catalog = await fetchSettingsSchema()
        if (!cancelled) setSchemaCatalog(catalog)
      } catch { /* schema unavailable — plugin section hidden */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (currentGroupId == null) {
      setSettings({})
      setLoading(groupsLoading)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      setFeedback('')
      try {
        const response = await fetchGroupSettings(currentGroupId)
        if (cancelled) return
        setSettings(response.settings)
      } catch {
        if (!cancelled) setError('Unable to load moderation settings for this group.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [currentGroupId, groupsLoading])

  useEffect(() => {
    setLimitDrafts({
      anti_spam_mute_limit: String(readLimit(settings, 'anti_spam_mute_limit', 1)),
      anti_ads_mute_limit: String(readLimit(settings, 'anti_ads_mute_limit', 1)),
      warn_remove_limit: String(readLimit(settings, 'warn_remove_limit', 5)),
    })
  }, [settings])

  const toggleCards = useMemo(
    () => TOGGLE_DEFINITIONS.map((toggle) => ({
      ...toggle,
      checked: readBoolean(settings, toggle.key, toggle.defaultValue),
    })),
    [settings],
  )

  async function handleToggleChange(key: ModerationToggleKey, nextValue: boolean) {
    if (currentGroupId == null) return
    setSavingToggle(key)
    setError('')
    setFeedback('')
    try {
      await updateGroupSettings(currentGroupId, { [key]: nextValue })
      setSettings((current) => ({ ...current, [key]: nextValue }))
      setFeedback('Moderation rules updated.')
    } catch {
      setError('Unable to save moderation changes right now.')
    } finally {
      setSavingToggle(null)
    }
  }

  async function handleSaveLimits() {
    if (currentGroupId == null) return

    const payload = {} as Record<ModerationLimitKey, number>
    for (const item of LIMIT_DEFINITIONS) {
      const parsed = Number(limitDrafts[item.key])
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError(`${item.label} must be a whole number greater than 0.`)
        setFeedback('')
        return
      }
      payload[item.key] = parsed
    }

    setSavingLimits(true)
    setError('')
    setFeedback('')
    try {
      await updateGroupSettings(currentGroupId, payload)
      setSettings((current) => ({ ...current, ...payload }))
      setFeedback('Moderation thresholds saved.')
    } catch {
      setError('Unable to save moderation thresholds right now.')
    } finally {
      setSavingLimits(false)
    }
  }

  async function handlePluginSettingChange(key: string, value: boolean | number | string) {
    if (currentGroupId == null) return
    setPluginSaving(key)
    setError('')
    setFeedback('')
    try {
      await updateGroupSettings(currentGroupId, { [key]: value })
      setSettings((current) => ({ ...current, [key]: value }))
      setFeedback(`Setting "${key}" saved.`)
    } catch {
      setError('Unable to save setting.')
    } finally {
      setPluginSaving(null)
    }
  }

  async function handleTestAI() {
    setTestLoading(true)
    setTestResult(null)
    setError('')
    try {
      const model = String(settings['ai_pilot_model'] || '').trim()
      const providerUrl = String(settings['ai_pilot_provider_url'] || '').trim()
      const apiKey = String(settings['ai_pilot_api_key'] || '').trim()
      const result = await testAIPilot({
        model: model || undefined,
        provider_url: providerUrl || undefined,
        api_key: apiKey || undefined,
      })
      if (result.status === 'ok') {
        setTestResult({ ok: true, text: result.reply || 'No reply' })
      } else {
        setTestResult({ ok: false, text: result.error || result.detail || 'Unknown error' })
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Test request failed'
      setTestResult({ ok: false, text: detail })
    } finally {
      setTestLoading(false)
    }
  }

  const pluginCategories = useMemo(() => {
    const categories = new Map<string, SettingSchemaEntry[]>()
    for (const [, entries] of Object.entries(schemaCatalog)) {
      for (const entry of entries) {
        const cat = entry.category || 'general'
        if (cat !== 'ai_provider') continue
        if (!categories.has(cat)) categories.set(cat, [])
        categories.get(cat)!.push(entry)
      }
    }
    return Array.from(categories.entries()).filter(([, entries]) => entries.length > 0)
  }, [schemaCatalog])

  return (
    <PageShell
      eyebrow="AI Pilot"
      titleKey="page.rules"
      descriptionKey="page.rules.desc"
      loading={loading}
      actions={(
        <div style={{ minWidth: 240 }}>
          <Select value={currentGroupId ?? ''} onChange={(event) => setCurrentGroupId(Number(event.target.value) || null)} disabled={groupsLoading || groups.length === 0}>
            {groups.length === 0 ? <option value="">No managed groups</option> : null}
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.title}</option>
            ))}
          </Select>
        </div>
      )}
    >
      {groupsError ? <InlineMessage tone="danger">{groupsError}</InlineMessage> : null}
      {!groupsLoading && groups.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>&#9888;&#65039;</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>No groups found</div>
            <div style={{ color: 'var(--color-muted)', maxWidth: 480, margin: '0 auto' }}>
              Add the bot as an administrator in a Telegram group, then select it here.
              For browser users, make sure your user ID is included in <code>DASHBOARD_BROWSER_USERS</code>.
            </div>
          </div>
        </Card>
      ) : null}
      {!currentGroup && groups.length > 0 ? (
        <InlineMessage tone="neutral">Select a group from the dropdown above to manage AI Pilot settings.</InlineMessage>
      ) : null}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {feedback ? <InlineMessage tone="success">{feedback}</InlineMessage> : null}

      {pluginCategories.length > 0 && pluginCategories.map(([category, entries]) => (
        <Card key={category}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12, textTransform: 'capitalize' }}>{category.replace(/_/g, ' ')}</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {entries.map((entry) => {
              const value = settings[entry.key] ?? entry.default ?? (entry.type === 'toggle' ? false : '')
              const isSaving = pluginSaving === entry.key
              if (entry.type === 'toggle') {
                return (
                  <ToggleRow
                    key={entry.key}
                    title={entry.label_key || entry.key}
                    subtitle={entry.key}
                    checked={Boolean(value)}
                    disabled={isSaving || currentGroupId == null}
                    onCheckedChange={(checked) => void handlePluginSettingChange(entry.key, checked)}
                    action={isSaving ? <span style={{ fontSize: 12 }}>Saving…</span> : null}
                  />
                )
              }
              if (entry.type === 'number') {
                return (
                  <Field key={entry.key} label={entry.label_key || entry.key} hint={entry.key}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {entry.min != null && entry.max != null ? (
                        <input type="range" min={entry.min} max={entry.max} value={Number(value)} onChange={(e) => void handlePluginSettingChange(entry.key, Number(e.target.value))} disabled={isSaving || currentGroupId == null} style={{ flex: 1 }} />
                      ) : null}
                      <Input
                        type="number"
                        min={entry.min ?? undefined}
                        max={entry.max ?? undefined}
                        value={value === '' ? '' : Number(value)}
                        onChange={(e) => void handlePluginSettingChange(entry.key, Number(e.target.value))}
                        disabled={isSaving || currentGroupId == null}
                        style={{ width: 80 }}
                      />
                      {isSaving ? <span style={{ fontSize: 12 }}>Saving…</span> : null}
                    </div>
                  </Field>
                )
              }
              return (
                <Field key={entry.key} label={entry.label_key || entry.key} hint={entry.key}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      type="text"
                      value={String(value)}
                      onChange={(e) => void handlePluginSettingChange(entry.key, e.target.value)}
                      disabled={isSaving || currentGroupId == null}
                      style={{ flex: 1 }}
                    />
                    {isSaving ? <span style={{ fontSize: 12 }}>Saving…</span> : null}
                  </div>
                </Field>
              )
            })}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button onClick={() => void handleTestAI()} disabled={testLoading || currentGroupId == null}>
              {testLoading ? 'Testing…' : 'Test Connection'}
            </Button>
            {testResult ? (
              <InlineMessage tone={testResult.ok ? 'success' : 'danger'}>
                {testResult.ok ? `\u2705 ${testResult.text}` : `\u274C ${testResult.text}`}
              </InlineMessage>
            ) : null}
          </div>
        </Card>
      ))}
    </PageShell>
  )
}

function readBoolean(
  settings: Record<string, boolean | number | string>,
  key: ModerationToggleKey,
  fallback: boolean,
) {
  const value = settings[key]
  return typeof value === 'boolean' ? value : fallback
}

function readLimit(
  settings: Record<string, boolean | number | string>,
  key: ModerationLimitKey,
  fallback: number,
) {
  const value = settings[key]
  return typeof value === 'number' ? value : fallback
}
