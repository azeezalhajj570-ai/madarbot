import { useEffect, useState } from 'react'

import { MultiGroupSelect } from '../components/MultiGroupSelect'
import { FormActions } from '../components/FormActions'
import { GroupDestinationField } from '../components/GroupDestinationField'

import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
  TextAreaField,
} from '@miniapp/shared'
import type {
  Agent,
  AgentGroupMember,
  AgentManagedGroup,
  AgentJobRecord,
  BulkPreflightResult,
  Campaign,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'

export function CampaignsPage({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])

  // Send form
  const [qsSelectedCampaignId, setQsSelectedCampaignId] = useState<number | ''>('')
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [quickName, setQuickName] = useState('')
  const [quickMessage, setQuickMessage] = useState('')
  const [quickSaving, setQuickSaving] = useState(false)
  const [bulkTargetType, setBulkTargetType] = useState<'members' | 'groups'>('members')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkThreshold, setBulkThreshold] = useState('25')
  const [bulkIntervalSeconds, setBulkIntervalSeconds] = useState('5')
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
  const [broadcastJobs, setBroadcastJobs] = useState<AgentJobRecord[]>([])
  const [bulkSaving, setBulkSaving] = useState(false)

  // Effects
  useEffect(() => {
    void agentsApi.listCampaigns(account.id).then(setCampaigns).catch(() => {})
  }, [account.id])

  useEffect(() => {
    const gq = bulkSourceGroupQuery || bulkTargetGroupQuery
    if (!gq.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, gq).then(setGroups).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, bulkSourceGroupQuery, bulkTargetGroupQuery])

  useEffect(() => {
    void agentsApi.fetchAgentJobs(account.id, BULK_MESSAGE_TASK_KEY, 50).then(setBroadcastJobs).catch(() => {})
  }, [account.id])

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
        setBulkMemberStatus(members.filter((m) => !selectedIds.has(m.user_id)).length ? null : 'No matching members found.')
      }).catch((error) => {
        if (cancelled) return; setBulkMemberResults([]); setBulkMemberTotal(0)
        setBulkMemberStatus(error instanceof Error ? error.message : 'Failed to search group members')
      }).finally(() => { if (!cancelled) setLoadingBulkMembers(false) })
    return () => { cancelled = true }
  }, [account.id, bulkMemberQuery, bulkSelectedMembers, bulkSourceGroup, bulkMemberPage, orderByMsgCount])

  useEffect(() => {
    if (qsSelectedCampaignId === '') return
    const campaign = campaigns.find((c) => c.id === qsSelectedCampaignId)
    if (campaign?.message_template) setBulkMessage(campaign.message_template)
  }, [qsSelectedCampaignId])

  function resetForm() {
    setBulkTargetType('members'); setBulkSourceGroupQuery(''); setBulkSourceGroup(null); setBulkMessage('')
    setBulkThreshold('25'); setBulkIntervalSeconds('1')
    setBulkTargetGroupQuery(''); setBulkSelectedTargetGroups([])
    setBulkMemberQuery(''); setBulkMemberResults([]); setBulkSelectedMembers([]); setBulkMemberStatus(null)
    setBulkScheduleMode('now'); setBulkScheduledAt('')
    setExcludeAdmins(false); setExcludeBots(false); setBulkSummary(null)
    setQsSelectedCampaignId(''); setStatus(null)
  }

  async function handleSend() {
    if (!bulkMessage.trim()) { setStatus('Message text is required'); return }
    if (bulkTargetType === 'members' && !bulkSourceGroup?.tg_group_id) { setStatus('Source group is required'); return }
    if (bulkTargetType === 'groups' && !bulkSelectedTargetGroups.length) { setStatus('At least one target group is required'); return }
    const threshold = Number.parseInt(bulkThreshold, 10)
    if (!Number.isFinite(threshold) || threshold <= 0) { setStatus('Threshold must be a positive integer'); return }
    const intervalSeconds = Number.parseFloat(bulkIntervalSeconds)
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) { setStatus('Interval seconds must be 0 or more'); return }
    if (bulkSummary) {
      setBulkSaving(true)
      try {
        const jobPayload: Record<string, unknown> = { target_type: bulkTargetType, message: bulkMessage.trim(), threshold, interval_seconds: intervalSeconds }
        if (bulkTargetType === 'members') {
          jobPayload.source_group_id = bulkSourceGroup!.tg_group_id; jobPayload.source_group_title = bulkSourceGroup!.title
          jobPayload.selected_user_ids = bulkSummary.filtered_user_ids
        } else { jobPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id) }
        const scheduledAt = bulkScheduleMode === 'schedule' && bulkScheduledAt ? new Date(bulkScheduledAt).toISOString() : undefined
        await agentsApi.createAgentJob(account.id, BULK_MESSAGE_TASK_KEY, jobPayload, scheduledAt)
        setBulkSummary(null); resetForm(); setStatus(null)
        onSaved(scheduledAt ? 'Bulk message scheduled' : 'Bulk message job queued')
        void agentsApi.fetchAgentJobs(account.id, BULK_MESSAGE_TASK_KEY, 50).then(setBroadcastJobs).catch(() => {})
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Failed to queue bulk message') }
      finally { setBulkSaving(false) }
      return
    }
    setLoadingBulkSummary(true); setStatus(null)
    try {
      const preflightPayload: Record<string, unknown> = { target_type: bulkTargetType, message: bulkMessage.trim(), threshold, interval_seconds: intervalSeconds }
      if (bulkTargetType === 'members') {
        preflightPayload.source_group_id = bulkSourceGroup!.tg_group_id; preflightPayload.source_group_title = bulkSourceGroup!.title
        preflightPayload.selected_user_ids = bulkSelectedMembers.map((m) => m.user_id)
      } else { preflightPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id) }
      const result = await agentsApi.preflightBulkMessage(account.id, preflightPayload)
      setBulkSummary(result)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Failed to prepare bulk message') }
    finally { setLoadingBulkSummary(false) }
  }

  return (
    <>
      <Card title="Send Message" subtitle="Send bulk messages to members or groups.">
        {status ? <Note>{status}</Note> : null}

        {/* Campaign selector */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>Campaign (optional)</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={qsSelectedCampaignId} onChange={(e) => setQsSelectedCampaignId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ flex: 1, boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', colorScheme: 'dark' }}>
              <option value="">— No campaign —</option>
              {campaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <button type="button" onClick={() => { setQuickName(''); setQuickMessage(''); setShowQuickCreate(true) }}
              style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 14px', cursor: 'pointer', fontSize: 18, lineHeight: '18px', display: 'flex', alignItems: 'center' }} title="Create new campaign">+</button>
          </div>
        </div>

        {/* Target type toggle */}
        <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 12, background: 'var(--miniapp-bg)', borderRadius: 10, border: '1px solid var(--miniapp-border-soft)' }}>
          {(['members', 'groups'] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setBulkTargetType(t); setBulkSummary(null) }} style={{
              flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
              background: bulkTargetType === t ? 'var(--miniapp-surface)' : 'transparent',
              color: bulkTargetType === t ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)',
              fontWeight: bulkTargetType === t ? 600 : 400, fontSize: 13,
            }}>{t === 'members' ? 'Send to Members' : 'Send to Groups'}</button>
          ))}
        </div>

        {bulkTargetType === 'members' ? (
          <>
            <GroupDestinationField label="Source group" query={bulkSourceGroupQuery} onQueryChange={setBulkSourceGroupQuery} groups={groups}
              selectedGroup={bulkSourceGroup}
              onSelect={(g) => { setBulkSourceGroup(g); setBulkSourceGroupQuery(g.title); setBulkMemberQuery(''); setBulkMemberResults([]); setBulkMemberTotal(0); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
              onClear={() => { setBulkSourceGroup(null); setBulkSourceGroupQuery(''); setBulkMemberQuery(''); setBulkMemberResults([]); setBulkMemberTotal(0); setBulkSelectedMembers([]); setBulkMemberStatus(null) }}
              syncButton={<button type="button" disabled={syncingAdminsBots} onClick={async () => {
                if (!account || !bulkSourceGroup) return; setSyncingAdminsBots(true); setSyncAdminsBotsStatus(null)
                try { const r = await agentsApi.syncAgentGroupAdminsBots(account.id, bulkSourceGroup.tg_group_id); setSyncAdminsBotsStatus(r.message || 'Sync completed') }
                catch (e) { setSyncAdminsBotsStatus(e instanceof Error ? e.message : 'Sync failed') }
                finally { setSyncingAdminsBots(false) }
              }} style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, padding: '10px 12px', fontSize: 18, lineHeight: '18px', cursor: syncingAdminsBots ? 'default' : 'pointer', opacity: syncingAdminsBots ? 0.6 : 1 }}>{syncingAdminsBots ? '…' : '↻'}</button>}
            />
            {syncAdminsBotsStatus ? <Note>{syncAdminsBotsStatus}</Note> : null}
            <TextAreaField label="Message" value={bulkMessage} onChange={setBulkMessage} rows={4} placeholder="Hello, this is our latest update." />
            <InputField label="Select members" value={bulkMemberQuery} onChange={setBulkMemberQuery} placeholder={bulkSourceGroup ? 'Search by name, username, or user id' : 'Choose a source group first'} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {bulkSelectedMembers.length ? <button type="button" onClick={() => setBulkSelectedMembers([])} style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, padding: '8px 10px', fontSize: 16, lineHeight: '18px', cursor: 'pointer' }}>✕ {bulkSelectedMembers.length}</button> : null}
              {bulkSelectedMembers.map((member) => (
                <span key={member.user_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 999, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', fontSize: 12.5 }}>
                  {member.full_name || member.username || `User ${member.user_id}`}
                  {member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: 'var(--miniapp-coral)', color: '#fff', fontSize: 9, fontWeight: 700 }}>Owner</span> : null}
                  {member.is_admin && !member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#5b8def', color: '#fff', fontSize: 9, fontWeight: 700 }}>Admin</span> : null}
                  {member.is_bot ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#8b8b8b', color: '#fff', fontSize: 9, fontWeight: 700 }}>Bot</span> : null}
                  {member.sent_by_agent ? <span style={{ color: 'var(--miniapp-sage)', fontSize: 10, fontWeight: 700 }}>✓</span> : null}
                  <button type="button" onClick={() => setBulkSelectedMembers((c) => c.filter((e) => e.user_id !== member.user_id))} style={{ border: 'none', background: 'transparent', color: 'var(--miniapp-clay)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--miniapp-clay)' }}>
              <span>Sort:</span>
              <button type="button" onClick={() => setOrderByMsgCount(orderByMsgCount === 'asc' ? 'desc' : 'asc')} style={{ background: 'none', border: '1px solid var(--miniapp-border-soft)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--miniapp-text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {orderByMsgCount === 'desc' ? '↓ Most' : '↑ Least'}
              </button>
            </div>
            {bulkSourceGroup && !loadingBulkMembers && bulkMemberTotal === 0 && !bulkMemberQuery.trim() ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, color: 'var(--miniapp-clay)' }}>No scraped members yet.</div>
                <Button tone="secondary" disabled={scrapingGroup} onClick={async () => {
                  setScrapingGroup(true)
                  try { await agentsApi.scrapeAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id); setBulkMemberQuery(' ') }
                  catch (e) { setBulkMemberStatus(e instanceof Error ? e.message : 'Scrape failed') }
                  finally { setScrapingGroup(false) }
                }}>{scrapingGroup ? 'Scraping...' : 'Scrape group'}</Button>
                <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>May take a few minutes.</div>
              </div>
            ) : null}
            {loadingBulkMembers ? <Note>Searching members...</Note> : null}
            {bulkMemberStatus && !loadingBulkMembers ? <Note>{bulkMemberStatus}</Note> : null}
            {!loadingBulkMembers && bulkMemberResults.length > 0 ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {bulkMemberResults.map((member) => (
                  <button key={member.user_id} type="button" onClick={() => { setBulkSelectedMembers((c) => [...c, member]); setBulkMemberResults((r) => r.filter((m) => m.user_id !== member.user_id)) }}
                    style={{ textAlign: 'left', padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', cursor: 'pointer', fontSize: 13, color: 'var(--miniapp-text-primary)', display: 'grid', gap: 2 }}>
                    <strong>{member.full_name || member.username || `User ${member.user_id}`}</strong>
                    <div style={{ color: '#655d52' }}>@{member.username} · msgs: {member.message_count} · {member.role || 'member'}{member.is_bot ? ' · 🤖' : ''}{member.sent_by_agent ? ' · ✓' : ''}</div>
                  </button>
                ))}
              </div>
            ) : null}
            {bulkMemberResults.length > 0 || bulkMemberTotal > 0 ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                <Button tone="secondary" disabled={bulkMemberPage <= 1} onClick={() => setBulkMemberPage((p) => p - 1)}>Previous</Button>
                <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>Page {bulkMemberPage}</span>
                <Button tone="secondary" disabled={bulkMemberPage * 20 >= bulkMemberTotal} onClick={() => setBulkMemberPage((p) => p + 1)}>Next</Button>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <MultiGroupSelect query={bulkTargetGroupQuery} onQueryChange={setBulkTargetGroupQuery} groups={groups} selected={bulkSelectedTargetGroups}
              onToggle={(g) => setBulkSelectedTargetGroups((c) => c.some((x) => x.tg_group_id === g.tg_group_id) ? c.filter((x) => x.tg_group_id !== g.tg_group_id) : [...c, g])} />
            <TextAreaField label="Message" value={bulkMessage} onChange={setBulkMessage} rows={4} placeholder="Hello, this is our latest update." />
          </>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div style={{ flex: 1 }}><InputField label="Threshold" value={bulkThreshold} onChange={setBulkThreshold} type="number" /></div>
        </div>
        <InputField label="Interval seconds" value={bulkIntervalSeconds} onChange={setBulkIntervalSeconds} type="number" />

        <div style={{ display: 'flex', gap: 4, padding: 4, marginBottom: 12, background: 'var(--miniapp-bg)', borderRadius: 10, border: '1px solid var(--miniapp-border-soft)' }}>
          {(['now', 'schedule'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setBulkScheduleMode(m)} style={{
              flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
              background: bulkScheduleMode === m ? 'var(--miniapp-surface)' : 'transparent',
              color: bulkScheduleMode === m ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)',
              fontWeight: bulkScheduleMode === m ? 600 : 400, fontSize: 13,
            }}>{m === 'now' ? 'Send now' : 'Schedule'}</button>
          ))}
        </div>
        {bulkScheduleMode === 'schedule' ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>Schedule date & time</span>
            <input type="datetime-local" value={bulkScheduledAt} onChange={(e) => setBulkScheduledAt(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', colorScheme: 'dark' }} />
          </div>
        ) : null}
        {bulkSummary ? (
          <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)', fontSize: 13 }}>
            <strong style={{ fontSize: 14 }}>Send summary</strong>
            <div>Total {bulkSummary.target_type === 'groups' ? 'groups' : 'matched'}: {bulkSummary.total}</div>
            {bulkSummary.target_type !== 'groups' ? (<>{bulkSummary.admins_excluded > 0 ? <div>Admins excluded: {bulkSummary.admins_excluded}</div> : null}{bulkSummary.bots_excluded > 0 ? <div>Bots excluded: {bulkSummary.bots_excluded}</div> : null}{bulkSummary.already_sent_excluded > 0 ? <div>Already sent excluded: {bulkSummary.already_sent_excluded}</div> : null}</>) : null}
            <div style={{ fontWeight: 700, color: 'var(--miniapp-coral)' }}>Final {bulkSummary.target_type === 'groups' ? 'groups' : 'recipients'}: {bulkSummary.final_count}</div>
          </div>
        ) : null}
        {loadingBulkSummary ? <Note>Preparing summary...</Note> : null}
        <FormActions submitLabel={bulkSummary ? (bulkScheduleMode === 'schedule' ? 'Confirm & Schedule' : 'Confirm & Send') : loadingBulkSummary ? 'Preparing...' : 'Prepare'} submitDisabled={bulkSummary !== null && bulkSummary.final_count === 0} onSubmit={() => void handleSend()} onCancel={resetForm} />
      </Card>

      {broadcastJobs.length > 0 ? (
        <Card title="Recent Jobs" subtitle="Recent broadcast and scheduled messages.">
          <div style={{ display: 'grid', gap: 6 }}>
            {broadcastJobs.map((job) => {
              const p = job.progress || {}; const total = p.total_count ?? 0; const sent = p.success_count ?? 0
              return (
                <div key={job.id} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', display: 'grid', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{(job.message_preview || '').slice(0, 48)}</strong>
                      {job.created_at ? <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
                    </div>
                    <span style={{ flexShrink: 0, marginLeft: 8, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                      background: job.status === 'completed' ? 'var(--miniapp-sage-dim)' : job.status === 'failed' ? 'rgba(161,87,62,0.12)' : job.status === 'scheduled' ? 'rgba(200,160,80,0.12)' : 'var(--miniapp-bg-deep)',
                      color: job.status === 'completed' ? 'var(--miniapp-sage)' : job.status === 'failed' ? 'var(--miniapp-clay)' : job.status === 'scheduled' ? '#b8960a' : 'var(--miniapp-text-muted)',
                    }}>{job.status}</span>
                  </div>
                  {job.status === 'scheduled' && job.scheduled_at ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>Scheduled for {new Date(job.scheduled_at).toLocaleString()}</div> : total > 0 ? <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}><span style={{ fontSize: 12, fontWeight: 600 }}>{sent} / {total}</span><span style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{job.target_type === 'groups' ? 'groups' : 'members'}</span></div> : null}
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {/* Campaign create modal */}
      {showQuickCreate ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(32, 25, 16, 0.55)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 1100 }} onClick={() => setShowQuickCreate(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 100%)', background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 20, padding: 24, display: 'grid', gap: 16, boxShadow: '0 22px 60px rgba(32,25,16,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>New Campaign</h2>
              <Button tone="secondary" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
            </div>
            <input type="text" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Campaign name" autoFocus
              style={{ boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', width: '100%' }} />
            <textarea value={quickMessage} onChange={(e) => setQuickMessage(e.target.value)} placeholder="Message template" rows={4}
              style={{ boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', resize: 'vertical', width: '100%' }} />
            <Button disabled={quickSaving || !quickName.trim() || !quickMessage.trim()} onClick={async () => {
              if (!quickName.trim() || !quickMessage.trim()) return; setQuickSaving(true)
              try {
                const c = await agentsApi.createCampaign(account.id, { name: quickName.trim(), message_template: quickMessage.trim() })
                setCampaigns((prev) => [...prev, c]); setQsSelectedCampaignId(c.id); setBulkMessage(quickMessage.trim()); setShowQuickCreate(false); onSaved('Campaign created')
              } catch (e) { setStatus(e instanceof Error ? e.message : 'Failed to create campaign') }
              finally { setQuickSaving(false) }
            }}>{quickSaving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
