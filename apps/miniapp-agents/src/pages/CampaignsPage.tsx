import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime, formatTime } from '../i18n/format'

import { MultiGroupSelect } from '../components/MultiGroupSelect'
import { FormActions } from '../components/FormActions'
import { GroupDestinationField } from '../components/GroupDestinationField'
import { BlacklistSection } from '../features/blacklist/BlacklistSection'
import { SchedulePicker, DEFAULT_SCHEDULE } from '../components/SchedulePicker'
import type { ScheduleConfig } from '../components/SchedulePicker'

import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
} from '@miniapp/shared'
import type {
  Agent,
  AgentGroupMember,
  AgentManagedGroup,
  BulkPreflightResult,
  Campaign,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'

export function CampaignsPage({ account, onSaved }: { account: Agent; onSaved: (message: string, kind?: 'error' | 'success' | 'info') => void }) {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showSendForm, setShowSendForm] = useState(false)

  // Send form
  const [qsSelectedCampaignId, setQsSelectedCampaignId] = useState<number | ''>('')
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickMessage, setQuickMessage] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [bulkTargetType, setBulkTargetType] = useState<'members' | 'groups'>('members')
  const [bulkMessages, setBulkMessages] = useState<string[]>([''])
  const [bulkMediaUrls, setBulkMediaUrls] = useState<(string | null)[]>([null])
  const [bulkThreshold, setBulkThreshold] = useState('25')
  const [bulkIntervalSeconds, setBulkIntervalSeconds] = useState('5')
  const [bulkIntervalContacts, setBulkIntervalContacts] = useState('5')
  const [messagesPerDay, setMessagesPerDay] = useState(String(account.max_messages_per_day ?? 30))
  const [bulkSourceGroupQuery, setBulkSourceGroupQuery] = useState('')
  const [bulkSourceGroup, setBulkSourceGroup] = useState<SelectedGroupChip | null>(null)
  const [bulkTargetGroupQuery, setBulkTargetGroupQuery] = useState('')
  const [bulkSelectedTargetGroups, setBulkSelectedTargetGroups] = useState<SelectedGroupChip[]>([])
  const [bulkMemberQuery, setBulkMemberQuery] = useState('')
  const [bulkMemberResults, setBulkMemberResults] = useState<AgentGroupMember[]>([])
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<AgentGroupMember[]>([])
  const [bulkMemberStatus, setBulkMemberStatus] = useState<string | null>(null)
  const [loadingBulkMembers, setLoadingBulkMembers] = useState(false)
  const [bulkScheduleMode, setBulkScheduleMode] = useState<'now' | 'schedule'>('now')
  const [bulkScheduledAt, setBulkScheduledAt] = useState('')
  const [bulkSendMode, setBulkSendMode] = useState<'standard' | 'recurring'>('standard')
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>(DEFAULT_SCHEDULE)
  const [excludeAdmins, setExcludeAdmins] = useState(true)
  const [excludeBots, setExcludeBots] = useState(true)
  const [orderByMsgCount, setOrderByMsgCount] = useState<'desc' | 'asc'>('desc')
  const [bulkMemberPage, setBulkMemberPage] = useState(1)
  const [bulkMemberTotal, setBulkMemberTotal] = useState(0)
  const [syncingAdminsBots, setSyncingAdminsBots] = useState(false)
  const [scrapingGroup, setScrapingGroup] = useState(false)
  const [syncAdminsBotsStatus, setSyncAdminsBotsStatus] = useState<string | null>(null)
  const [bulkSummary, setBulkSummary] = useState<BulkPreflightResult | null>(null)
  const [loadingBulkSummary, setLoadingBulkSummary] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)
  const [editingCampaignId, setEditingCampaignId] = useState<number | null>(null)
  const [groupNameMap, setGroupNameMap] = useState<Record<number, string>>({})

  function notify(msg: string, kind: 'error' | 'success' | 'info' = 'error') {
    setStatus(msg)
    onSaved(msg, kind)
  }

  const isFormValid = useMemo(() => {
    const filledMessages = bulkMessages.filter((m) => m.trim())
    if (!filledMessages.length) return false
    if (bulkTargetType === 'members' && !bulkSourceGroup?.tg_group_id) return false
    if (bulkTargetType === 'groups' && !bulkSelectedTargetGroups.length) return false
    if (bulkSendMode === 'standard') {
      const threshold = Number.parseInt(bulkThreshold, 10)
      if (!Number.isFinite(threshold) || threshold <= 0) return false
      const intervalSeconds = Number.parseFloat(bulkIntervalSeconds)
      if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) return false
      const intervalContacts = Number.parseFloat(bulkIntervalContacts)
      if (!Number.isFinite(intervalContacts) || intervalContacts < 0) return false
    }
    return true
  }, [bulkMessages, bulkTargetType, bulkSourceGroup, bulkSelectedTargetGroups, bulkThreshold, bulkIntervalSeconds, bulkIntervalContacts, bulkSendMode])

  // Effects
  useEffect(() => {
    void agentsApi.listCampaigns(account.id).then((r) => setCampaigns(r.items ?? [])).catch(() => {})
  }, [account.id])

  useEffect(() => {
    const groupIds = new Set<number>()
    for (const c of campaigns) {
      const ids = (c.target_filters?.group_ids as number[] | undefined) ?? []
      for (const id of ids) groupIds.add(id)
    }
    const missing = [...groupIds].filter((id) => !(id in groupNameMap))
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(missing.map((id) =>
      agentsApi.fetchAgentGroups(account.id, String(id)).then((r) => {
        if (cancelled) return null
        const g = Array.isArray(r) ? r.find((g) => g.tg_group_id === id || g.id === id) : null
        return g ? { id, title: g.title || '' } : null
      }).catch(() => null)
    )).then((results) => {
      if (cancelled) return
      const map: Record<number, string> = {}
      for (const r of results) {
        if (r) map[r.id] = r.title
      }
      setGroupNameMap((prev) => ({ ...prev, ...map }))
    })
    return () => { cancelled = true }
  }, [campaigns, account.id])

  useEffect(() => {
    const gq = bulkSourceGroupQuery || bulkTargetGroupQuery
    if (!gq.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, gq).then((r) => {
        const raw = Array.isArray(r) ? r : []
        const seen = new Set<number>()
        setGroups(raw.filter((g) => {
          const id = Number(g.tg_group_id || 0)
          if (!id || seen.has(id)) return false
          seen.add(id)
          return true
        }))
      }).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, bulkSourceGroupQuery, bulkTargetGroupQuery])

  useEffect(() => {
    if (!bulkSourceGroup?.tg_group_id) { setBulkMemberResults([]); setBulkMemberTotal(0); setBulkMemberStatus(null); setLoadingBulkMembers(false); return }
    const query = bulkMemberQuery.trim(); let cancelled = false
    setLoadingBulkMembers(true); setBulkMemberStatus(null)
    void agentsApi.searchAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id, query || undefined, 20, excludeBots, bulkMemberPage, orderByMsgCount === 'asc' ? 'message_count_asc' : 'message_count', excludeAdmins, false)
      .then((page) => {
        if (cancelled) return
        const members = Array.isArray(page?.members) ? page.members : []
        const selectedIds = new Set(bulkSelectedMembers.map((m) => m.user_id))
        setBulkMemberResults(members.filter((m) => !selectedIds.has(m.user_id)))
        setBulkMemberTotal(page.total)
        setBulkMemberStatus(members.filter((m) => !selectedIds.has(m.user_id)).length ? null : t('campaigns.noMatchingMembers'))
      }).catch((error) => {
        if (cancelled) return; setBulkMemberResults([]); setBulkMemberTotal(0)
        setBulkMemberStatus(error instanceof Error ? error.message : t('campaigns.failedSearchMembers'))
      }).finally(() => { if (!cancelled) setLoadingBulkMembers(false) })
    return () => { cancelled = true }
  }, [account.id, bulkMemberQuery, bulkSelectedMembers, bulkSourceGroup, bulkMemberPage, orderByMsgCount])

  useEffect(() => {
    if (qsSelectedCampaignId === '') return
    const campaign = campaigns.find((c) => c.id === qsSelectedCampaignId)
    if (campaign?.message_template) setBulkMessages([campaign.message_template])
  }, [qsSelectedCampaignId])

  function resetForm() {
    setBulkTargetType('members'); setBulkSourceGroupQuery(''); setBulkSourceGroup(null); setBulkMessages(['']); setBulkMediaUrls([null])
    setBulkThreshold('25'); setBulkIntervalSeconds('5'); setBulkIntervalContacts('5'); setMessagesPerDay(String(account.max_messages_per_day ?? 30))
    setBulkTargetGroupQuery(''); setBulkSelectedTargetGroups([])
    setBulkMemberQuery(''); setBulkMemberResults([]); setBulkSelectedMembers([]); setBulkMemberStatus(null)
    setBulkScheduleMode('now'); setBulkScheduledAt('')
    setBulkSendMode('standard'); setScheduleConfig(DEFAULT_SCHEDULE)
    setExcludeAdmins(false); setExcludeBots(true); setBulkSummary(null); setEditingCampaignId(null)
    setQsSelectedCampaignId(''); setStatus(null)
  }

  async function handleSend() {
    const filledMessages = bulkMessages.filter((m) => m.trim())
    const validationErrors: string[] = []
    if (!filledMessages.length) validationErrors.push(t('campaigns.msgRequired'))
    if (bulkTargetType === 'members' && !bulkSourceGroup?.tg_group_id) validationErrors.push(t('campaigns.sourceRequired'))
    if (bulkTargetType === 'groups' && !bulkSelectedTargetGroups.length) validationErrors.push(t('campaigns.targetRequired'))
    const threshold = Number.parseInt(bulkThreshold, 10)
    if (!Number.isFinite(threshold) || threshold <= 0) validationErrors.push(t('campaigns.thresholdInvalid'))
    const intervalSeconds = Number.parseFloat(bulkIntervalSeconds)
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) validationErrors.push(t('campaigns.intervalInvalid'))
    const intervalContacts = Number.parseFloat(bulkIntervalContacts)
    if (!Number.isFinite(intervalContacts) || intervalContacts < 0) validationErrors.push(t('campaigns.intervalInvalid'))
    if (validationErrors.length) { notify(validationErrors.join(' · ')); return }

    if (bulkSendMode === 'recurring') {
      setBulkSaving(true)
      try {
        const targetGroupIds = bulkSelectedTargetGroups.map((g) => g.tg_group_id)
        const payload = {
          name: `Recurring - ${filledMessages[0]?.slice(0, 40)}`,
          message_template: filledMessages.join('\n---\n'),
          target_filters: { group_ids: targetGroupIds },
          recurrence_enabled: true,
          repeat_type: scheduleConfig.repeatType,
          interval_value: 1,
          repeat_time: scheduleConfig.repeatTime,
          cron_expression: scheduleConfig.repeatType === 'cron' ? scheduleConfig.cronExpression : undefined,
          end_type: scheduleConfig.endType === 'never' ? undefined : scheduleConfig.endType,
          end_value: scheduleConfig.endValue || undefined,
          timezone: scheduleConfig.timezone,
        }
        if (editingCampaignId) {
          await agentsApi.updateCampaign(account.id, editingCampaignId, payload)
          resetForm(); setStatus(null)
          onSaved(t('campaigns.campaignUpdated'))
        } else {
          const campaign = await agentsApi.createCampaign(account.id, payload)
          await agentsApi.activateCampaign(account.id, campaign.id)
          resetForm(); setStatus(null)
          onSaved(t('campaigns.recurringCreated'))
        }
        void agentsApi.listCampaigns(account.id).then((r) => setCampaigns(r.items ?? [])).catch(() => {})
      } catch (error) { notify(error instanceof Error ? error.message : t('campaigns.failedCreate')) }
      finally { setBulkSaving(false) }
      return
    }

    if (bulkSummary) {
      setBulkSaving(true)
      try {
        const jobPayload: Record<string, unknown> = {
          target_type: bulkTargetType,
          messages: filledMessages,
          media_urls: bulkMediaUrls,
          threshold,
          interval_seconds: intervalSeconds,
          interval_between_contacts: intervalContacts,
          messages_per_day: Number.parseInt(messagesPerDay, 10) || undefined
        }
        if (bulkTargetType === 'members') {
          jobPayload.source_group_id = bulkSourceGroup!.tg_group_id; jobPayload.source_group_title = bulkSourceGroup!.title
          jobPayload.selected_user_ids = bulkSummary.filtered_user_ids
        } else { jobPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id) }
        await agentsApi.createAgentJob(account.id, BULK_MESSAGE_TASK_KEY, jobPayload)
        setBulkSummary(null); resetForm(); setStatus(null)
        onSaved(t('campaigns.queued'))
      } catch (error) { notify(error instanceof Error ? error.message : t('campaigns.failedQueue')) }
      finally { setBulkSaving(false) }
      return
    }
    setLoadingBulkSummary(true); setStatus(null)
    try {
      const preflightPayload: Parameters<typeof agentsApi.preflightBulkMessage>[1] = {
        target_type: bulkTargetType,
        messages: filledMessages,
        media_urls: bulkMediaUrls,
        threshold,
        interval_seconds: intervalSeconds,
        interval_between_contacts: intervalContacts,
        messages_per_day: Number.parseInt(messagesPerDay, 10) || undefined
      }
      if (bulkTargetType === 'members') {
        preflightPayload.source_group_id = bulkSourceGroup!.tg_group_id;
        preflightPayload.source_group_title = bulkSourceGroup!.title
        preflightPayload.selected_user_ids = bulkSelectedMembers.map((m) => m.user_id)
      } else { preflightPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id) }
      const result = await agentsApi.preflightBulkMessage(account.id, preflightPayload)
      setBulkSummary(result)
    } catch (error) { notify(error instanceof Error ? error.message : t('campaigns.failedPrepare')) }
    finally { setLoadingBulkSummary(false) }
  }

  return (
    <>
      <Card title={t('campaigns.sendMessage')} subtitle={t('campaigns.sendMessageSubtitle')}>
        {status ? <div data-form-error><Note>{status}</Note></div> : null}
        {!showSendForm ? (
          <Button onClick={() => { resetForm(); setShowSendForm(true) }}>{t('campaigns.newMessage')}</Button>
        ) : null}
        {showSendForm ? (<>
        {/* Campaign selector */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>{t('campaigns.campaignOptional')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={qsSelectedCampaignId} onChange={(e) => setQsSelectedCampaignId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ flex: 1, boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', colorScheme: 'dark' }}>
              <option value="">{t('campaigns.noCampaign')}</option>
              {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <button type="button" onClick={() => { setQuickName(''); setQuickMessage(''); setStatus(null); setShowQuickCreate(true) }}
              style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 14px', cursor: 'pointer', fontSize: 18, lineHeight: '18px', display: 'flex', alignItems: 'center' }} title={t('campaigns.createCampaign')}>+</button>
          </div>
        </div>

        {/* Target type toggle */}
        <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 12, background: 'var(--miniapp-bg)', borderRadius: 10, border: '1px solid var(--miniapp-border-soft)' }}>
          {(['members', 'groups'] as const).map((type) => {
            const disabled = bulkSendMode === 'recurring' && type === 'members'
            return (
              <button key={type} type="button" disabled={disabled} onClick={() => { if (!disabled) { setBulkTargetType(type); setBulkSummary(null) } }} style={{
                flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
                background: bulkTargetType === type ? 'var(--miniapp-surface)' : 'transparent',
                color: disabled ? 'var(--miniapp-text-muted)' : (bulkTargetType === type ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)'),
                fontWeight: bulkTargetType === type ? 600 : 400, fontSize: 13, opacity: disabled ? 0.4 : 1,
              }}>{type === 'members' ? t('campaigns.sendToMembers') : t('campaigns.sendToGroups')}</button>
            )
          })}
        </div>

        {bulkTargetType === 'members' ? (
          <>
            <GroupDestinationField label={t('campaigns.sourceGroup')} query={bulkSourceGroupQuery} onQueryChange={setBulkSourceGroupQuery} groups={groups}
              selectedGroup={bulkSourceGroup}
              onSelect={(g) => { setBulkSourceGroup(g); setBulkSourceGroupQuery(g.title); setBulkMemberQuery(''); setBulkMemberResults([]); setBulkMemberTotal(0); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
              onClear={() => { setBulkSourceGroup(null); setBulkSourceGroupQuery(''); setBulkMemberQuery(''); setBulkMemberResults([]); setBulkMemberTotal(0); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
              syncButton={<button type="button" disabled={syncingAdminsBots} onClick={async () => {
                if (!account || !bulkSourceGroup) return; setSyncingAdminsBots(true); setSyncAdminsBotsStatus(null)
                try { const r = await agentsApi.syncAgentGroupAdminsBots(account.id, bulkSourceGroup.tg_group_id); setSyncAdminsBotsStatus(r.message || t('campaigns.syncCompleted')) }
                catch (e) { setSyncAdminsBotsStatus(e instanceof Error ? e.message : t('campaigns.syncFailed')) }
                finally { setSyncingAdminsBots(false) }
              }} style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, padding: '10px 12px', fontSize: 18, lineHeight: '18px', cursor: syncingAdminsBots ? 'default' : 'pointer', opacity: syncingAdminsBots ? 0.6 : 1 }}>{syncingAdminsBots ? '…' : '↻'}</button>}
            />
            {syncAdminsBotsStatus ? <Note>{syncAdminsBotsStatus}</Note> : null}
            <div style={{ display: 'grid', gap: 8 }}>
              {bulkMessages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <textarea value={msg} onChange={(e) => {
                      const next = [...bulkMessages]
                      next[i] = e.target.value
                      setBulkMessages(next)
                    }} rows={3} placeholder={t('campaigns.messagePlaceholder')}
                      style={{ flex: 1, boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', resize: 'vertical' }} />
                    {bulkMessages.length > 1 ? (
                      <button type="button" onClick={() => { setBulkMessages((m) => m.filter((_, j) => j !== i)); setBulkMediaUrls((u) => u.filter((_, j) => j !== i)) }}
                        style={{ flexShrink: 0, background: 'var(--miniapp-bg)', color: 'var(--miniapp-coral)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <label style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '6px 10px', fontFamily: 'var(--miniapp-sans)', fontSize: 12, color: 'var(--miniapp-text-secondary)' }}>
                      <span>{uploadingIdx === i ? '⏳ Uploading...' : (bulkMediaUrls[i] ? '📎 ' + decodeURIComponent(bulkMediaUrls[i]!.split('/').pop() || 'file') : '+ Attach media')}</span>
                      <input type="file" accept="image/*,video/*,application/pdf" style={{ display: 'none' }} onChange={async (e) => {
                        const MAX_SIZE = 20 * 1024 * 1024
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > MAX_SIZE) { notify(`File too large (max 20MB)`); return }
                        setUploadingIdx(i)
                        try {
                          const data = await agentsApi.uploadAgentMedia(account.id, file)
                          const next = [...bulkMediaUrls]; next[i] = data.url; setBulkMediaUrls(next)
                        } catch (err) { notify(err instanceof Error ? err.message : 'Upload failed') }
                        finally { setUploadingIdx(null) }
                      }} />
                    </label>
                    {bulkMediaUrls[i] ? (
                      <button type="button" onClick={() => { const next = [...bulkMediaUrls]; next[i] = null; setBulkMediaUrls(next) }}
                        style={{ flexShrink: 0, background: 'none', color: 'var(--miniapp-coral)', border: 'none', cursor: 'pointer', fontSize: 16, padding: '4px' }}>✕</button>
                    ) : null}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => { setBulkMessages((m) => [...m, '']); setBulkMediaUrls((u) => [...u, null]) }}
                style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content' }}>+ {t('campaigns.addMessage')}</button>
            </div>
            <InputField label={t('campaigns.selectMembers')} value={bulkMemberQuery} onChange={setBulkMemberQuery} placeholder={bulkSourceGroup ? t('campaigns.searchMembersPlaceholder') : t('campaigns.chooseSourceFirst')} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {bulkSelectedMembers.length ? <button type="button" onClick={() => setBulkSelectedMembers([])} style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, padding: '8px 10px', fontSize: 16, lineHeight: '18px', cursor: 'pointer' }}>✕ {bulkSelectedMembers.length}</button> : null}
              {bulkMemberResults.length > 0 ? (
                <Button tone="secondary" onClick={() => {
                  const existingIds = new Set(bulkSelectedMembers.map((m) => m.user_id))
                  const newMembers = bulkMemberResults.filter((m) => !existingIds.has(m.user_id))
                  setBulkSelectedMembers((c) => [...c, ...newMembers])
                  setBulkMemberResults((r) => r.filter((m) => existingIds.has(m.user_id)))
                }}>{t('campaigns.selectAll')} ({bulkMemberResults.length})</Button>
              ) : null}
              {bulkSelectedMembers.map((member) => (
                <span key={member.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 999, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', fontSize: 12.5 }}>
                  {member.full_name || member.username || t('campaigns.userFallback', { userId: member.user_id })}
                  {member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: 'var(--miniapp-coral)', color: '#fff', fontSize: 9, fontWeight: 700 }}>{t('campaigns.owner')}</span> : null}
                  {member.is_admin && !member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#5b8def', color: '#fff', fontSize: 9, fontWeight: 700 }}>{t('campaigns.admin')}</span> : null}
                  {member.is_bot ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#8b8b8b', color: '#fff', fontSize: 9, fontWeight: 700 }}>{t('campaigns.bot')}</span> : null}
                  {member.sent_by_agent ? <span style={{ color: 'var(--miniapp-sage)', fontSize: 10, fontWeight: 700 }}>{t('campaigns.sentByAgent')}</span> : null}
                  <button type="button" onClick={() => setBulkSelectedMembers((c) => c.filter((e) => e.user_id !== member.user_id))} style={{ border: 'none', background: 'transparent', color: 'var(--miniapp-clay)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--miniapp-clay)' }}>
              <span>{t('campaigns.sort')}</span>
              <button type="button" onClick={() => setOrderByMsgCount(orderByMsgCount === 'asc' ? 'desc' : 'asc')} style={{ background: 'none', border: '1px solid var(--miniapp-border-soft)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--miniapp-text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {orderByMsgCount === 'desc' ? t('campaigns.sortDesc') : t('campaigns.sortAsc')}
              </button>
            </div>
            {bulkSourceGroup && !loadingBulkMembers && bulkMemberTotal === 0 && !bulkMemberQuery.trim() ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: 'var(--miniapp-clay)' }}>{t('campaigns.noScrapedMembers')}</div>
                <Button tone="secondary" disabled={scrapingGroup} onClick={async () => {
                  setScrapingGroup(true)
                  try { await agentsApi.scrapeAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id); setBulkMemberQuery(' ') }
                  catch (e) { setBulkMemberStatus(e instanceof Error ? e.message : t('campaigns.scrapeFailed')) }
                  finally { setScrapingGroup(false) }
                }}>{scrapingGroup ? t('campaigns.scraping') : t('campaigns.scrapeGroup')}</Button>
                <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>{t('campaigns.scrapingNote')}</div>
              </div>
            ) : null}
            {loadingBulkMembers ? <Note>{t('campaigns.searchingMembers')}</Note> : null}
            {bulkMemberStatus && !loadingBulkMembers ? <Note>{bulkMemberStatus}</Note> : null}
            {!loadingBulkMembers && bulkMemberResults.length > 0 ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {bulkMemberResults.map((member) => (
                  <button key={member.user_id} type="button" onClick={() => { setBulkSelectedMembers((c) => [...c, member]); setBulkMemberResults((r) => r.filter((m) => m.user_id !== member.user_id)) }}
                    style={{ textAlign: 'left', padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', cursor: 'pointer', fontSize: 13, color: 'var(--miniapp-text-primary)', display: 'grid', gap: 2 }}>
                    <strong>{member.full_name || member.username || t('campaigns.userFallback', { userId: member.user_id })}</strong>
                    <div style={{ color: '#655d52' }}>{t('campaigns.memberMeta', { username: member.username, count: member.message_count, role: member.role || t('campaigns.member') })}{member.is_bot ? ' · 🤖' : ''}{member.sent_by_agent ? ' · ✓' : ''}</div>
                  </button>
                ))}
              </div>
            ) : null}
            {bulkMemberResults.length > 0 || bulkMemberTotal > 0 ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                <Button tone="secondary" disabled={bulkMemberPage <= 1} onClick={() => setBulkMemberPage((p) => p - 1)}>{t('campaigns.previous')}</Button>
                <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>{t('campaigns.page', { page: bulkMemberPage })}</span>
                <Button tone="secondary" disabled={bulkMemberPage * 20 >= bulkMemberTotal} onClick={() => setBulkMemberPage((p) => p + 1)}>{t('campaigns.next')}</Button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <MultiGroupSelect query={bulkTargetGroupQuery} onQueryChange={setBulkTargetGroupQuery} groups={groups} selected={bulkSelectedTargetGroups}
              onToggle={(g) => setBulkSelectedTargetGroups((c) => c.some((x) => x.tg_group_id === g.tg_group_id) ? c.filter((x) => x.tg_group_id !== g.tg_group_id) : [...c, g])} />
            <div style={{ display: 'grid', gap: 8 }}>
              {bulkMessages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <textarea value={msg} onChange={(e) => {
                      const next = [...bulkMessages]
                      next[i] = e.target.value
                      setBulkMessages(next)
                    }} rows={3} placeholder={t('campaigns.messagePlaceholder')}
                      style={{ flex: 1, boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', resize: 'vertical' }} />
                    {bulkMessages.length > 1 ? (
                      <button type="button" onClick={() => { setBulkMessages((m) => m.filter((_, j) => j !== i)); setBulkMediaUrls((u) => u.filter((_, j) => j !== i)) }}
                        style={{ flexShrink: 0, background: 'var(--miniapp-bg)', color: 'var(--miniapp-coral)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                    ) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <label style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '6px 10px', fontFamily: 'var(--miniapp-sans)', fontSize: 12, color: 'var(--miniapp-text-secondary)' }}>
                      <span>{uploadingIdx === i ? '⏳ Uploading...' : (bulkMediaUrls[i] ? '📎 ' + decodeURIComponent(bulkMediaUrls[i]!.split('/').pop() || 'file') : '+ Attach media')}</span>
                      <input type="file" accept="image/*,video/*,application/pdf" style={{ display: 'none' }} onChange={async (e) => {
                        const MAX_SIZE = 20 * 1024 * 1024
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > MAX_SIZE) { notify(`File too large (max 20MB)`); return }
                        setUploadingIdx(i)
                        try {
                          const data = await agentsApi.uploadAgentMedia(account.id, file)
                          const next = [...bulkMediaUrls]; next[i] = data.url; setBulkMediaUrls(next)
                        } catch (err) { notify(err instanceof Error ? err.message : 'Upload failed') }
                        finally { setUploadingIdx(null) }
                      }} />
                    </label>
                    {bulkMediaUrls[i] ? (
                      <button type="button" onClick={() => { const next = [...bulkMediaUrls]; next[i] = null; setBulkMediaUrls(next) }}
                        style={{ flexShrink: 0, background: 'none', color: 'var(--miniapp-coral)', border: 'none', cursor: 'pointer', fontSize: 16, padding: '4px' }}>✕</button>
                    ) : null}
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => { setBulkMessages((m) => [...m, '']); setBulkMediaUrls((u) => [...u, null]) }}
                style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, width: 'fit-content' }}>+ {t('campaigns.addMessage')}</button>
            </div>
          </>
        )}

        <div style={{ display: 'grid', gap: 6, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>{t('campaigns.deliverySettings')}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <InputField label={t('campaigns.threshold')} value={bulkThreshold} onChange={setBulkThreshold} type="number" />
              <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('campaigns.thresholdHint')}</div>
            </div>
            <div style={{ flex: 1 }}>
              <InputField label={t('campaigns.intervalSeconds')} value={bulkIntervalSeconds} onChange={setBulkIntervalSeconds} type="number" />
              <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('campaigns.intervalHint')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <div style={{ flex: 1 }}>
              <InputField label={t('campaigns.intervalContacts')} value={bulkIntervalContacts} onChange={setBulkIntervalContacts} type="number" />
              <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('campaigns.intervalContactsHint')}</div>
            </div>
          </div>
          <div>
            <InputField label={t('campaigns.messagesPerDay')} value={messagesPerDay} onChange={setMessagesPerDay} type="number" />
            <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('campaigns.messagesPerDayHint')}</div>
          </div>
        </div>

        {/* Send mode: standard vs recurring */}
        <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 12, background: 'var(--miniapp-bg)', borderRadius: 10, border: '1px solid var(--miniapp-border-soft)' }}>
          {(['standard', 'recurring'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setBulkSendMode(m); setBulkSummary(null); if (m === 'recurring') setBulkTargetType('groups') }} style={{
              flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
              background: bulkSendMode === m ? 'var(--miniapp-surface)' : 'transparent',
              color: bulkSendMode === m ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)',
              fontWeight: bulkSendMode === m ? 600 : 400, fontSize: 13,
            }}>{t(m === 'standard' ? 'campaigns.sendOnce' : 'campaigns.recurring')}</button>
          ))}
        </div>

        {bulkSendMode === 'recurring' ? (
          <div style={{ marginBottom: 12 }}>
            <SchedulePicker value={scheduleConfig} onChange={setScheduleConfig} />
          </div>
        ) : null}
        {bulkSummary ? (
          <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)', fontSize: 13 }}>
            <strong style={{ fontSize: 14 }}>{t('campaigns.summaryTitle')}</strong>
            <div>{t('campaigns.summaryTotal', { type: bulkSummary.target_type === 'groups' ? t('campaigns.groups') : t('campaigns.matched'), count: bulkSummary.total })}</div>
            {bulkSummary.message_count > 1 ? <div>{t('campaigns.summaryMessages', { count: bulkSummary.message_count })}</div> : null}
            {bulkSummary.target_type !== 'groups' ? (<>{bulkSummary.admins_excluded > 0 ? <div>{t('campaigns.summaryAdminsExcluded', { count: bulkSummary.admins_excluded })}</div> : null}{bulkSummary.bots_excluded > 0 ? <div>{t('campaigns.summaryBotsExcluded', { count: bulkSummary.bots_excluded })}</div> : null}{bulkSummary.already_sent_excluded > 0 ? <div>{t('campaigns.summaryAlreadySent', { count: bulkSummary.already_sent_excluded })}</div> : null}{bulkSummary.blacklisted_excluded > 0 ? <div>{t('campaigns.summaryBlacklisted', { count: bulkSummary.blacklisted_excluded })}</div> : null}</>) : null}
            <div style={{ fontWeight: 700, color: 'var(--miniapp-coral)' }}>{t('campaigns.summaryFinal', { type: bulkSummary.target_type === 'groups' ? t('campaigns.groups') : t('campaigns.recipients'), count: bulkSummary.final_count })}</div>
            {bulkSummary.message_count > 0 ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{t('campaigns.summaryTotalSends', { contacts: bulkSummary.final_count, msgs: bulkSummary.message_count, total: bulkSummary.final_count * (bulkSummary.message_count || 1) })}</div> : null}
          </div>
        ) : null}
        {loadingBulkSummary ? <Note>{t('campaigns.preparingSummary')}</Note> : null}
        <FormActions submitLabel="Save" submitDisabled={!isFormValid || loadingBulkSummary || bulkSaving || (bulkSummary !== null && bulkSummary.final_count === 0)} onSubmit={() => void handleSend()} onCancel={() => { resetForm(); setShowSendForm(false) }} />
        </>) : null}
      </Card>

      {/* Campaigns list */}
      {campaigns.length > 0 ? (
        <Card title={t('campaigns.campaigns')} subtitle={t('campaigns.campaignsSubtitle')}>
          <div style={{ display: 'grid', gap: 6 }}>
            {campaigns.map((c) => (
              <div key={c.id} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{c.name}</strong>
                    {c.created_at ? <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{formatTime(c.created_at)}</span> : null}
                  </div>
                  <span style={{ flexShrink: 0, marginLeft: 8, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                    background: c.status === 'active' ? 'var(--miniapp-sage-dim)' : c.status === 'paused' ? 'rgba(200,160,80,0.12)' : c.status === 'completed' ? 'rgba(100,100,100,0.12)' : c.status === 'draft' ? 'var(--miniapp-bg-deep)' : 'rgba(161,87,62,0.12)',
                    color: c.status === 'active' ? 'var(--miniapp-sage)' : c.status === 'paused' ? '#b8960a' : c.status === 'completed' ? '#888' : c.status === 'draft' ? 'var(--miniapp-text-muted)' : 'var(--miniapp-clay)',
                  }}>{c.status}</span>
                </div>
                {c.recurrence_enabled ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11, color: 'var(--miniapp-text-muted)' }}>
                    <span>{c.repeat_type}</span>
                    {c.next_run_at ? <span>· {t('campaigns.nextRun')}: {formatDateTime(c.next_run_at)}</span> : null}
                    {c.last_run_at ? <span>· {t('campaigns.lastRun')}: {formatTime(c.last_run_at)}</span> : null}
                    {c.run_count > 0 ? <span>· {t('campaigns.runCount', { count: c.run_count })}</span> : null}
                  </div>
                ) : null}
                {c.target_filters?.group_ids ? (
                  <div style={{ fontSize: 11, color: 'var(--miniapp-clay)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(c.target_filters.group_ids as number[]).map((gid) => (
                      <span key={gid} style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--miniapp-bg-deep)' }}>
                        {groupNameMap[gid] || `#${gid}`}
                      </span>
                    ))}
                  </div>
                ) : null}
                {c.recurrence_enabled && (c.status === 'active' || c.status === 'paused') ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {c.status === 'active' ? (
                      <button type="button" onClick={async () => {
                        try { await agentsApi.pauseCampaign(account.id, c.id); const r = await agentsApi.listCampaigns(account.id); setCampaigns(r.items ?? []) }
                        catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedAction')) }
                      }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', cursor: 'pointer', fontSize: 11, color: 'var(--miniapp-text-primary)' }}>{t('campaigns.pause')}</button>
                    ) : null}
                    {c.status === 'paused' ? (
                      <button type="button" onClick={async () => {
                        try { await agentsApi.resumeCampaign(account.id, c.id); const r = await agentsApi.listCampaigns(account.id); setCampaigns(r.items ?? []) }
                        catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedAction')) }
                      }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', cursor: 'pointer', fontSize: 11, color: 'var(--miniapp-text-primary)' }}>{t('campaigns.resume')}</button>
                    ) : null}
                    <button type="button" onClick={async () => {
                      try { await agentsApi.runCampaignNow(account.id, c.id); onSaved(t('campaigns.sendNowTriggered')) }
                      catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedAction')) }
                    }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', cursor: 'pointer', fontSize: 11, color: 'var(--miniapp-text-primary)' }}>{t('campaigns.sendNow')}</button>
                    <button type="button" onClick={() => {
                      setBulkTargetType('groups')
                      setBulkMessages([c.message_template || ''])
                      const groupIds: Array<{ tg_group_id: number; title: string }> = (c.target_filters?.group_ids as number[] || []).map((id: number) => ({ tg_group_id: id, title: String(id) }))
                      setBulkSelectedTargetGroups(groupIds)
                      setBulkSendMode('recurring')
                      if (c.repeat_time) setScheduleConfig((prev) => ({ ...prev, repeatTime: c.repeat_time! }))
                      if (c.repeat_type) setScheduleConfig((prev) => ({ ...prev, repeatType: c.repeat_type as 'daily' | 'weekly' | 'monthly' | 'cron' }))
                      if (c.cron_expression) setScheduleConfig((prev) => ({ ...prev, cronExpression: c.cron_expression! }))
                      if (c.end_type) setScheduleConfig((prev) => ({ ...prev, endType: c.end_type as 'never' | 'on_date' | 'after_n_runs' }))
                      if (c.end_value) setScheduleConfig((prev) => ({ ...prev, endValue: c.end_value! }))
                      if (c.timezone) setScheduleConfig((prev) => ({ ...prev, timezone: c.timezone! }))
                      setEditingCampaignId(c.id)
                      setShowSendForm(true)
                    }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', cursor: 'pointer', fontSize: 11, color: 'var(--miniapp-text-primary)' }}>{t('campaigns.edit')}</button>
                    <button type="button" onClick={async () => {
                      if (!confirm(t('campaigns.confirmDelete'))) return
                      try { await agentsApi.deleteCampaign(account.id, c.id); const r = await agentsApi.listCampaigns(account.id); setCampaigns(r.items ?? []) }
                      catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedAction')) }
                    }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', cursor: 'pointer', fontSize: 11, color: 'var(--miniapp-clay)' }}>{t('campaigns.delete')}</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Campaign create modal */}
      {showQuickCreate ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(32, 25, 16, 0.55)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 1100 }} onClick={() => setShowQuickCreate(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 100%)', background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 20, padding: 24, display: 'grid', gap: 16, boxShadow: '0 22px 60px rgba(32,25,16,0.22)' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>{t('campaigns.newCampaign')}</h2>
            <input type="text" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder={t('campaigns.campaignNamePlaceholder')} autoFocus
              style={{ boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', width: '100%' }} />
            <textarea value={quickMessage} onChange={(e) => setQuickMessage(e.target.value)} placeholder={t('campaigns.templatePlaceholder')} rows={4}
              style={{ boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', resize: 'vertical', width: '100%' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button disabled={quickSaving || !quickName.trim() || !quickMessage.trim()} onClick={async () => {
                if (!quickName.trim() || !quickMessage.trim()) return; setQuickSaving(true)
                try {
                  const c = await agentsApi.createCampaign(account.id, { name: quickName.trim(), message_template: quickMessage.trim() })
                  setCampaigns((prev) => [...prev, c]); setQsSelectedCampaignId(c.id); setBulkMessages([quickMessage.trim()]); setShowQuickCreate(false); onSaved(t('campaigns.campaignCreated'))
                } catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedCreate')) }
                finally { setQuickSaving(false) }
              }}>Save</Button>
              <Button tone="secondary" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}

      <BlacklistSection account={account} />
    </>
  )
}
