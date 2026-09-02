import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime, formatTime } from '../i18n/format'

import { FormActions } from '../components/FormActions'
import { BlacklistSection } from '../features/blacklist/BlacklistSection'
import { ClaimAwareMemberPicker } from '../components/ClaimAwareMemberPicker'
import { MessageComposer } from '../components/MessageComposer'
import { SchedulePicker, DEFAULT_SCHEDULE } from '../components/SchedulePicker'
import type { ScheduleConfig } from '../components/SchedulePicker'
import { MemberFilterDialog, isEmptyFilter, resolveFilterMemberIds } from '../features/memberSearch'
import type { MemberFilterValue } from '../features/memberSearch'

import {
  agentsApi,
  Button,
  Card,
  GroupAutocomplete,
  InputField,
  Note,
} from '@miniapp/shared'
import type {
  Agent,
  AgentManagedGroup,
  BulkPreflightResult,
  Campaign,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'

const _groupNameCache: Record<number, string> = {}

export function CampaignsPage({ account, workspaceId, onSaved }: { account: Agent; workspaceId?: string | null; onSaved: (message: string, kind?: 'error' | 'success' | 'info') => void }) {
  const { t } = useTranslation()

  // Ensure claim/send requests carry the active workspace context so the
  // backend validates workspace ownership (FR-011).
  useEffect(() => {
    if (workspaceId) {
      void import('@miniapp/shared').then(({ setWorkspaceContext }) => setWorkspaceContext(workspaceId))
    }
  }, [workspaceId])

  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [showSendForm, setShowSendForm] = useState(false)

  // Send form
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
  const [bulkMemberStatus, setBulkMemberStatus] = useState<string | null>(null)
  const [bulkMembersEmpty, setBulkMembersEmpty] = useState(false)
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<number[]>([])
  const [bulkScheduleMode, setBulkScheduleMode] = useState<'now' | 'schedule'>('now')
  const [bulkScheduledAt, setBulkScheduledAt] = useState('')
  const [bulkSendMode, setBulkSendMode] = useState<'standard' | 'recurring'>('standard')
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>(DEFAULT_SCHEDULE)
  const [excludeAdmins, setExcludeAdmins] = useState(true)
  // Members already part of a running/pending send_to_claimed_members job for
  // the selected source group are "held" — disable re-selection so the same
  // member isn't queued twice while the earlier job is still in flight (same
  // behavior as the bulk-add task's member picker).
  const [bulkHeldMemberIds, setBulkHeldMemberIds] = useState<Set<number>>(new Set())
  const [scrapingGroup, setScrapingGroup] = useState(false)
  const [bulkSummary, setBulkSummary] = useState<BulkPreflightResult | null>(null)
  const [loadingBulkSummary, setLoadingBulkSummary] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  // Advanced member filter (dialog) — narrows the member picker to matching ids.
  const [bulkFilterOpen, setBulkFilterOpen] = useState(false)
  const [bulkFilter, setBulkFilter] = useState<MemberFilterValue | null>(null)
  const [bulkNarrowIds, setBulkNarrowIds] = useState<number[] | null>(null)
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
    const missing = [...groupIds].filter((id) => !(id in _groupNameCache))
    if (missing.length === 0) {
      const cached: Record<number, string> = {}
      for (const id of groupIds) {
        if (id in _groupNameCache) cached[id] = _groupNameCache[id]
      }
      if (Object.keys(cached).length) setGroupNameMap((prev) => ({ ...prev, ...cached }))
      return
    }
    let cancelled = false
    void Promise.all(missing.map((id) =>
      agentsApi.fetchAgentGroups(account.id, String(id)).then((r) => {
        if (cancelled) return null
        const g = Array.isArray(r) ? r.find((g) => g.tg_group_id === id || g.id === id) : null
        return g ? { id, title: g.title || '' } : null
      }).catch(() => null)
    )).then((results) => {
      if (cancelled) return
      for (const r of results) {
        if (r) _groupNameCache[r.id] = r.title
      }
      setGroupNameMap((prev) => ({ ...prev, ..._groupNameCache }))
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
          // Only offer groups the agent is a member of — membership is what
          // grants send eligibility (same filter as the bulk-add target picker).
          if (g.is_member === false || g.can_send_messages === false) return false
          return true
        }))
      }).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, bulkSourceGroupQuery, bulkTargetGroupQuery])

  // Members currently targeted by a running/pending send_to_claimed_members job
  // for the selected source group are "held" — they show the running-job clock
  // badge and are disabled in the picker (parity with the bulk-add picker).
  useEffect(() => {
    if (!bulkSourceGroup?.tg_group_id) { setBulkHeldMemberIds(new Set()); return }
    let cancelled = false
    void agentsApi.fetchAgentJobs(account.id, 'send_to_claimed_members', 100, true)
      .then((jobs) => {
        if (cancelled) return
        const held = new Set<number>()
        for (const j of jobs) {
          const active = ['running', 'pending', 'queued'].includes(j.status)
          if (!active) continue
          const payload = j.job_payload || {}
          if (Number(payload.source_group_id) !== bulkSourceGroup.tg_group_id) continue
          const ids = Array.isArray(payload.user_ids) ? payload.user_ids : []
          for (const uid of ids) {
            const n = Number(uid)
            if (n > 0) held.add(n)
          }
        }
        setBulkHeldMemberIds(held)
      })
      .catch(() => setBulkHeldMemberIds(new Set()))
    return () => { cancelled = true }
  }, [account.id, bulkSourceGroup?.tg_group_id])

  function resetForm() {
    setBulkTargetType('members'); setBulkSourceGroupQuery(''); setBulkSourceGroup(null); setBulkMessages(['']); setBulkMediaUrls([null])
    setBulkThreshold('25'); setBulkIntervalSeconds('5'); setBulkIntervalContacts('5'); setMessagesPerDay(String(account.max_messages_per_day ?? 30))
    setBulkTargetGroupQuery(''); setBulkSelectedTargetGroups([])
    setBulkSelectedMembers([]); setBulkMemberStatus(null)
    setBulkHeldMemberIds(new Set())
    setBulkScheduleMode('now'); setBulkScheduledAt('')
    setBulkSendMode('standard'); setScheduleConfig(DEFAULT_SCHEDULE)
    setExcludeAdmins(true); setBulkSummary(null); setEditingCampaignId(null)
    setBulkFilter(null); setBulkNarrowIds(null); setBulkFilterOpen(false)
    setStatus(null)
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
        if (bulkTargetType === 'members') {
          // Claimed-members send: the recipients must already be claimed by
          // this agent. Unclaimed/other-agent members are rejected by the
          // backend with a conflict report (FR-021/FR-012). Claim the selected
          // members up front (idempotent) so sends work regardless of whether
          // the picker's claims were released or expired.
          const claimResult = await agentsApi.claimMembers(account.id, {
            source_tg_group_id: bulkSourceGroup!.tg_group_id,
            user_ids: bulkSummary.filtered_user_ids,
          })
          const otherConflicts = claimResult.conflicts.filter((c) => c.claimed_by_agent_id !== account.id)
          const recipientIds = bulkSummary.filtered_user_ids.filter(
            (id) =>
              claimResult.claimed.includes(id) ||
              claimResult.conflicts.some((c) => c.tg_user_id === id && c.claimed_by_agent_id === account.id),
          )
          if (recipientIds.length === 0) {
            notify(t('campaigns.claimedSendConflicts', { unclaimed: bulkSummary.filtered_user_ids.length, other: otherConflicts.length }))
            setBulkSummary(null)
            return
          }
          const result = await agentsApi.sendToClaimedMembers(account.id, {
            source_tg_group_id: bulkSourceGroup!.tg_group_id,
            user_ids: recipientIds,
            messages: filledMessages,
            media_urls: bulkMediaUrls,
            threshold,
            interval_seconds: intervalSeconds,
            interval_between_contacts: intervalContacts,
          })
          if (result.status === 'conflicts') {
            // Rare race: a claim expired/reassigned between our claim and the send.
            const unclaimedCount = result.unclaimed?.length ?? 0
            const otherCount = result.claimed_by_other?.length ?? 0
            notify(t('campaigns.claimedSendConflicts', { unclaimed: unclaimedCount, other: otherCount }))
            setBulkSummary(null)
            return
          }
          if (otherConflicts.length > 0) {
            notify(t('campaigns.claimedSendSkipped', { count: recipientIds.length, skipped: otherConflicts.length }), 'info')
          } else {
            onSaved(t('campaigns.queued'))
          }
          setBulkSummary(null); resetForm(); setStatus(null)
          return
        }
        const jobPayload: Record<string, unknown> = {
          target_type: 'groups',
          messages: filledMessages,
          media_urls: bulkMediaUrls,
          threshold,
          interval_seconds: intervalSeconds,
          interval_between_contacts: intervalContacts,
          messages_per_day: Number.parseInt(messagesPerDay, 10) || undefined,
          target_group_ids: bulkSelectedTargetGroups.map((g) => g.tg_group_id),
        }
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
        preflightPayload.selected_user_ids = bulkSelectedMembers
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
        {showSendForm ? (
          <div className="mb-send-flow">
            {/* Step 1: Audience */}
            <div className="mb-section">
              <div className="mb-step-head">
                <span className="mb-step-num">1</span>
                <div>
                  <div className="mb-step-title">{t('campaigns.stepAudience')}</div>
                  <div className="mb-step-sub">{t('campaigns.stepAudienceSub')}</div>
                </div>
              </div>

              <div className="mb-toggle" role="group" aria-label={t('campaigns.targetType')}>
                {(['members', 'groups'] as const).map((type) => {
                  const disabled = bulkSendMode === 'recurring' && type === 'members'
                  return (
                    <button key={type} type="button" disabled={disabled} aria-pressed={bulkTargetType === type} onClick={() => { if (!disabled) { setBulkTargetType(type); setBulkSummary(null) } }} className="mb-toggle-btn">
                      {type === 'members' ? t('campaigns.sendToMembers') : t('campaigns.sendToGroups')}
                    </button>
                  )
                })}
              </div>

              {bulkTargetType === 'members' ? (
                <>
                  <GroupAutocomplete label={t('campaigns.sourceGroup')} query={bulkSourceGroupQuery} onQueryChange={setBulkSourceGroupQuery} groups={groups} t={t}
                    mode="single"
                    selectedGroup={bulkSourceGroup}
                    onSelect={(g) => { setBulkSourceGroup(g); setBulkSourceGroupQuery(g.title); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
                    onClear={() => { setBulkSourceGroup(null); setBulkSourceGroupQuery(''); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
                  />
                  <ClaimAwareMemberPicker
                    account={account}
                    sourceGroup={bulkSourceGroup}
                    heldMemberIds={bulkHeldMemberIds}
                    pageSize={20}
                    selected={bulkSelectedMembers}
                    onSelectedChange={setBulkSelectedMembers}
                    onEmptyChange={setBulkMembersEmpty}
                    excludeAdminsBots={excludeAdmins}
                    onExcludeAdminsBotsChange={setExcludeAdmins}
                    autoClaim
                    hideEmptyState
                    narrowToMemberIds={bulkNarrowIds}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <Button tone="secondary" onClick={() => setBulkFilterOpen(true)}>
                      {t('memberSearch.advancedFilter')}
                    </Button>
                    {bulkFilter ? (
                      <span style={{ fontSize: 12.5, color: 'var(--miniapp-text-muted)' }}>
                        {t('memberSearch.filterActive')}{' '}
                        {bulkNarrowIds ? `${bulkNarrowIds.length}` : '…'}
                      </span>
                    ) : null}
                  </div>
                  {bulkSourceGroup && bulkMembersEmpty ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, color: 'var(--miniapp-clay)' }}>{t('campaigns.noScrapedMembers')}</div>
                      <Button tone="secondary" disabled={scrapingGroup} onClick={async () => {
                        setScrapingGroup(true)
                        try { await agentsApi.scrapeAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id); setBulkMembersEmpty(false) }
                        catch (e) { setBulkMemberStatus(e instanceof Error ? e.message : t('campaigns.scrapeFailed')) }
                        finally { setScrapingGroup(false) }
                      }}>{scrapingGroup ? t('campaigns.scraping') : t('campaigns.scrapeGroup')}</Button>
                      <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>{t('campaigns.scrapingNote')}</div>
                    </div>
                  ) : null}
                  {bulkMemberStatus ? <Note>{bulkMemberStatus}</Note> : null}
                </>
              ) : (
                <GroupAutocomplete label={t('campaigns.targetGroups')} query={bulkTargetGroupQuery} onQueryChange={setBulkTargetGroupQuery} groups={groups} t={t}
                  mode="multi" selected={bulkSelectedTargetGroups}
                  onToggle={(g) => setBulkSelectedTargetGroups((c) => c.some((x) => x.tg_group_id === g.tg_group_id) ? c.filter((x) => x.tg_group_id !== g.tg_group_id) : [...c, g])}
                  onRemove={(id) => setBulkSelectedTargetGroups((c) => c.filter((x) => x.tg_group_id !== id))} />
              )}
            </div>

            {/* Step 2: Compose & delivery */}
            <div className="mb-section">
              <div className="mb-step-head">
                <span className="mb-step-num">2</span>
                <div>
                  <div className="mb-step-title">{t('campaigns.stepOptions')}</div>
                  <div className="mb-step-sub">{t('campaigns.stepOptionsSub')}</div>
                </div>
              </div>
              <MessageComposer
                account={account}
                messages={bulkMessages}
                mediaUrls={bulkMediaUrls}
                onChange={(messages, mediaUrls) => { setBulkMessages(messages); setBulkMediaUrls(mediaUrls) }}
                onError={(msg) => notify(msg)}
              />
              <details className="mb-delivery">
                <summary>{t('campaigns.deliverySettings')}</summary>
                <div style={{ display: 'grid', gap: 10 }}>
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
              </details>

              <div className="mb-toggle" role="group" aria-label={t('campaigns.sendMode')}>
                {(['standard', 'recurring'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={bulkSendMode === m} className="mb-toggle-btn" onClick={() => { setBulkSendMode(m); setBulkSummary(null); if (m === 'recurring') setBulkTargetType('groups') }}>
                    {t(m === 'standard' ? 'campaigns.sendOnce' : 'campaigns.recurring')}
                  </button>
                ))}
              </div>

              {bulkSendMode === 'recurring' ? (
                <SchedulePicker value={scheduleConfig} onChange={setScheduleConfig} />
              ) : null}
            </div>

            {bulkSummary ? (
              <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)', fontSize: 13 }}>
                <strong style={{ fontSize: 14 }}>{t('campaigns.summaryTitle')}</strong>
                <div>{t('campaigns.summaryTotal', { type: bulkSummary.target_type === 'groups' ? t('campaigns.groups') : t('campaigns.matched'), count: bulkSummary.total })}</div>
                {(bulkSummary.message_count ?? 0) > 1 ? <div>{t('campaigns.summaryMessages', { count: bulkSummary.message_count ?? 1 })}</div> : null}
                {bulkSummary.target_type !== 'groups' ? (<>{bulkSummary.admins_excluded > 0 ? <div>{t('campaigns.summaryAdminsExcluded', { count: bulkSummary.admins_excluded })}</div> : null}{bulkSummary.bots_excluded > 0 ? <div>{t('campaigns.summaryBotsExcluded', { count: bulkSummary.bots_excluded })}</div> : null}{bulkSummary.already_sent_excluded > 0 ? <div>{t('campaigns.summaryAlreadySent', { count: bulkSummary.already_sent_excluded })}</div> : null}{bulkSummary.blacklisted_excluded > 0 ? <div>{t('campaigns.summaryBlacklisted', { count: bulkSummary.blacklisted_excluded })}</div> : null}</>) : null}
                <div style={{ fontWeight: 700, color: 'var(--miniapp-coral)' }}>{t('campaigns.summaryFinal', { type: bulkSummary.target_type === 'groups' ? t('campaigns.groups') : t('campaigns.recipients'), count: bulkSummary.final_count })}</div>
                {(bulkSummary.message_count ?? 0) > 0 ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{t('campaigns.summaryTotalSends', { contacts: bulkSummary.final_count, msgs: bulkSummary.message_count ?? 1, total: bulkSummary.final_count * (bulkSummary.message_count ?? 1) })}</div> : null}
              </div>
            ) : null}
            {loadingBulkSummary ? <Note>{t('campaigns.preparingSummary')}</Note> : null}
            <FormActions submitLabel={bulkSummary ? t('campaigns.confirmSend') : t('campaigns.prepare')} submitDisabled={!isFormValid || loadingBulkSummary || bulkSaving || (bulkSummary !== null && bulkSummary.final_count === 0)} onSubmit={() => void handleSend()} onCancel={() => { resetForm(); setShowSendForm(false) }} />
          </div>
        ) : null}
      </Card>

      {/* Campaigns list */}
      <Card title={t('campaigns.campaigns')} subtitle={t('campaigns.campaignsSubtitle')}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button tone="secondary" onClick={() => { setQuickName(''); setQuickMessage(''); setStatus(null); setShowQuickCreate(true) }}>{t('campaigns.newCampaign')}</Button>
        </div>
        {campaigns.length > 0 ? (
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
        ) : (
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)' }}>{t('campaigns.noCampaigns')}</div>
        )}
      </Card>

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
                  setCampaigns((prev) => [...prev, c]); setShowQuickCreate(false); onSaved(t('campaigns.campaignCreated'))
                } catch (e) { notify(e instanceof Error ? e.message : t('campaigns.failedCreate')) }
                finally { setQuickSaving(false) }
              }}>{t('common.save')}</Button>
              <Button tone="secondary" onClick={() => setShowQuickCreate(false)}>{t('common.cancel')}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <MemberFilterDialog
        open={bulkFilterOpen}
        onClose={() => setBulkFilterOpen(false)}
        value={bulkFilter ?? { filter: null, groupIds: [], dateFrom: null, dateTo: null, sort: 'newest_matching_activity' }}
        groups={(groups ?? []).filter((g) => g.tg_group_id != null).map((g) => ({ tg_group_id: g.tg_group_id!, title: g.title || `Group ${g.tg_group_id}` }))}
        scopeGroup={bulkSourceGroup ? { tg_group_id: bulkSourceGroup.tg_group_id, title: bulkSourceGroup.title } : null}
        countMatches={async (v) => {
          const { total } = await resolveFilterMemberIds(account.id, v, { pageSize: 1, maxPages: 1 })
          return total
        }}
        resolveIds={async (v) => {
          const { ids } = await resolveFilterMemberIds(account.id, v)
          return ids
        }}
        onApply={(v) => {
          setBulkFilter(isEmptyFilter(v) ? null : v)
          setBulkNarrowIds(v.memberIds && v.memberIds.length ? v.memberIds : null)
        }}
      />

      <BlacklistSection account={account} />
    </>
  )
}
