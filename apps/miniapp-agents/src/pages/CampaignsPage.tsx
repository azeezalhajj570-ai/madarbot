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
  CampaignSendLogEntry,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'

export function CampaignsPage({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)

  // Campaign list
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)

  // Quick Send form
  const [qsCampaigns, setQsCampaigns] = useState<Campaign[]>([])
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

  // Create campaign form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createMessage, setCreateMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Campaign detail modal
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null)
  const [showSendPicker, setShowSendPicker] = useState(false)
  const [sendGroupQuery, setSendGroupQuery] = useState('')
  const [sendSelectedGroups, setSendSelectedGroups] = useState<SelectedGroupChip[]>([])
  const [sendLoading, setSendLoading] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)
  const [sendLogs, setSendLogs] = useState<CampaignSendLogEntry[]>([])
  const [sendLogsTotal, setSendLogsTotal] = useState(0)
  const [sendLogsPage, setSendLogsPage] = useState(1)
  const [loadingSendLogs, setLoadingSendLogs] = useState(false)

  const groupQuery = bulkSourceGroupQuery || bulkTargetGroupQuery || sendGroupQuery

  // Effects
  useEffect(() => { loadCampaigns() }, [account.id])

  async function loadCampaigns() {
    setLoadingCampaigns(true)
    try {
      const result = await agentsApi.listCampaigns(account.id)
      setCampaigns(result.items)
      setQsCampaigns(result.items)
    } catch { setStatus('Failed to load campaigns') }
    finally { setLoadingCampaigns(false) }
  }

  useEffect(() => {
    if (!groupQuery.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, groupQuery).then(setGroups).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, groupQuery])

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
    const campaign = qsCampaigns.find((c) => c.id === qsSelectedCampaignId)
    if (campaign?.message_template) setBulkMessage(campaign.message_template)
  }, [qsSelectedCampaignId])

  // Helpers
  function resetBulkForm() {
    setBulkTargetType('members'); setBulkSourceGroupQuery(''); setBulkSourceGroup(null); setBulkMessage('')
    setBulkThreshold('25'); setBulkIntervalSeconds('1')
    setBulkTargetGroupQuery(''); setBulkSelectedTargetGroups([])
    setBulkMemberQuery(''); setBulkMemberResults([]); setBulkSelectedMembers([]); setBulkMemberStatus(null)
    setBulkScheduleMode('now'); setBulkScheduledAt('')
    setExcludeAdmins(false); setExcludeBots(false); setBulkSummary(null)
    setQsSelectedCampaignId(''); setShowQuickCreate(false); setStatus(null)
  }

  async function handleQuickSend() {
    if (!bulkMessage.trim()) { setStatus('Bulk message text is required'); return }
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
        setBulkSummary(null); resetBulkForm(); setStatus(null)
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

  async function loadSendLogs(campaignId: number, page = 1) {
    setLoadingSendLogs(true); setSendLogsPage(page)
    try { const result = await agentsApi.getCampaignSendLogs(account.id, campaignId, { page, page_size: 50 }); setSendLogs(result.items); setSendLogsTotal(result.total) }
    catch { setStatus('Failed to load send logs') }
    finally { setLoadingSendLogs(false) }
  }

  async function handleSend(campaign: Campaign) {
    if (!sendSelectedGroups.length) { setSendResult('Select at least one group'); return }
    setSendLoading(true); setSendResult(null)
    try {
      const result = await agentsApi.sendCampaign(account.id, campaign.id, { group_ids: sendSelectedGroups.map((g) => g.tg_group_id) })
      setSendResult(`${result.jobs_created} job(s) created`); setSendSelectedGroups([]); setShowSendPicker(false)
      onSaved(`Sent to ${result.jobs_created} group(s)`); await loadCampaigns(); await loadSendLogs(campaign.id)
    } catch (error) { setSendResult(error instanceof Error ? error.message : 'Failed to send') }
    finally { setSendLoading(false) }
  }

  // Campaign detail modal
  if (detailCampaign) {
    return (
      <Card title={detailCampaign.name} subtitle={`Status: ${detailCampaign.status}`}>
        {status ? <Note>{status}</Note> : null}
        <div style={{ display: 'grid', gap: 8, marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', fontSize: 13 }}>
          {detailCampaign.description ? <div>{detailCampaign.description}</div> : null}
          {detailCampaign.message_template ? <div style={{ color: 'var(--miniapp-text-muted)' }}>Template: {detailCampaign.message_template.slice(0, 120)}</div> : null}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>Sent: <strong>{detailCampaign.sent_count}</strong></span><span>Failed: <strong>{detailCampaign.failed_count}</strong></span><span>Skipped: <strong>{detailCampaign.skipped_count}</strong></span>
          </div>
          {detailCampaign.started_at ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>First send: {new Date(detailCampaign.started_at).toLocaleString()}</div> : null}
        </div>
        {!showSendPicker ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => { setShowSendPicker(true); setSendResult(null) }}>Send to Groups</Button>
            <Button tone="secondary" onClick={() => { setDetailCampaign(null) }}>Back</Button>
            {detailCampaign.status !== 'draft' ? <Button tone="secondary" onClick={() => loadSendLogs(detailCampaign.id, 1)}>Refresh Logs</Button> : null}
          </div>
        ) : null}
        {showSendPicker ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <MultiGroupSelect query={sendGroupQuery} onQueryChange={setSendGroupQuery} groups={groups} selected={sendSelectedGroups}
              onToggle={(g) => setSendSelectedGroups((c) => c.some((x) => x.tg_group_id === g.tg_group_id) ? c.filter((x) => x.tg_group_id !== g.tg_group_id) : [...c, g])} />
            {sendResult ? <Note>{sendResult}</Note> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => handleSend(detailCampaign)} disabled={sendLoading || !sendSelectedGroups.length}>{sendLoading ? 'Sending...' : `Send to ${sendSelectedGroups.length} group(s)`}</Button>
              <Button tone="secondary" onClick={() => { setShowSendPicker(false); setSendSelectedGroups([]); setSendResult(null) }}>Cancel</Button>
            </div>
          </div>
        ) : null}
        {loadingSendLogs ? <Note>Loading send logs...</Note> : null}
        {!loadingSendLogs && sendLogs.length > 0 ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>Send Logs ({sendLogsTotal})</strong>
            {sendLogs.map((log) => (
              <div key={log.id} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', fontSize: 12, display: 'grid', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>User {log.tg_user_id ?? 'N/A'}</span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: log.status === 'sent' ? 'var(--miniapp-sage-dim)' : log.status === 'failed' ? 'rgba(161,87,62,0.12)' : 'var(--miniapp-bg-deep)', color: log.status === 'sent' ? 'var(--miniapp-sage)' : log.status === 'failed' ? 'var(--miniapp-clay)' : 'var(--miniapp-text-muted)' }}>{log.status}</span>
                </div>
                <div style={{ color: 'var(--miniapp-text-muted)' }}>{log.message_text.slice(0, 80)}</div>
                {log.sent_at ? <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{new Date(log.sent_at).toLocaleString()}</div> : null}
              </div>
            ))}
            {sendLogsTotal > 50 ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                <Button tone="secondary" disabled={sendLogsPage <= 1} onClick={() => loadSendLogs(detailCampaign.id, sendLogsPage - 1)}>Prev</Button>
                <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', alignSelf: 'center' }}>{sendLogsPage}</span>
                <Button tone="secondary" disabled={sendLogsPage * 50 >= sendLogsTotal} onClick={() => loadSendLogs(detailCampaign.id, sendLogsPage + 1)}>Next</Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loadingSendLogs && detailCampaign.status !== 'draft' && sendLogs.length === 0 ? <Note>No send logs yet.</Note> : null}
      </Card>
    )
  }

  // Main view
  return (
    <>
      {/* ── Quick Send Form (always visible) ── */}
      <Card title="Send Message" subtitle="Send bulk messages to members or groups.">
        {status ? <Note>{status}</Note> : null}

        {/* Campaign selector */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>Campaign (optional)</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={qsSelectedCampaignId} onChange={(e) => setQsSelectedCampaignId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ flex: 1, boxSizing: 'border-box', background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', colorScheme: 'dark' }}>
              <option value="">— No campaign —</option>
              {qsCampaigns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <button type="button" onClick={() => { setQuickName(''); setQuickMessage(''); setShowQuickCreate(true) }}
              style={{ background: 'var(--miniapp-bg)', color: 'var(--miniapp-text-primary)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '11px 14px', cursor: 'pointer', fontSize: 18, lineHeight: '18px', display: 'flex', alignItems: 'center' }}>+</button>
          </div>
          {showQuickCreate ? (
            <div style={{ display: 'grid', gap: 8, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)' }}>
              <strong style={{ fontSize: 13 }}>New Campaign</strong>
              <input type="text" value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Campaign name"
                style={{ boxSizing: 'border-box', background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', width: '100%' }} />
              <textarea value={quickMessage} onChange={(e) => setQuickMessage(e.target.value)} placeholder="Message template" rows={3}
                style={{ boxSizing: 'border-box', background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 'var(--miniapp-radius-sm)', padding: '10px 12px', fontFamily: 'var(--miniapp-sans)', fontSize: 13, color: 'var(--miniapp-text-primary)', outline: 'none', resize: 'vertical', width: '100%' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Button disabled={quickSaving || !quickName.trim() || !quickMessage.trim()} onClick={async () => {
                  if (!quickName.trim() || !quickMessage.trim()) return; setQuickSaving(true)
                  try {
                    const c = await agentsApi.createCampaign(account.id, { name: quickName.trim(), message_template: quickMessage.trim() })
                    setQsCampaigns((prev) => [...prev, c]); setQsSelectedCampaignId(c.id); setBulkMessage(quickMessage.trim()); setShowQuickCreate(false); onSaved('Campaign created')
                  } catch (e) { setStatus(e instanceof Error ? e.message : 'Failed to create campaign') }
                  finally { setQuickSaving(false) }
                }}>{quickSaving ? 'Creating...' : 'Save'}</Button>
                <Button tone="secondary" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}
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
            }}>{m === 'now' ? 'Send now' : 'Schedule for later'}</button>
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
        <FormActions submitLabel={bulkSummary ? (bulkScheduleMode === 'schedule' ? 'Confirm & Schedule' : 'Confirm & Send') : loadingBulkSummary ? 'Preparing...' : 'Prepare'} submitDisabled={bulkSummary !== null && bulkSummary.final_count === 0} onSubmit={() => void handleQuickSend()} onCancel={resetBulkForm} />
      </Card>

      {/* ── Recent Jobs ── */}
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

      {/* ── Campaign List ── */}
      <Card title="Campaigns" subtitle="Tap a campaign to send or view logs.">
        {loadingCampaigns ? <Note>Loading campaigns...</Note> : null}
        {!showCreateForm ? <Button onClick={() => { setCreateName(''); setCreateDescription(''); setCreateMessage(''); setShowCreateForm(true) }}>New Campaign</Button> : null}
        {showCreateForm ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <InputField label="Campaign Name" value={createName} onChange={setCreateName} placeholder="Summer promotion" />
            <InputField label="Description (optional)" value={createDescription} onChange={setCreateDescription} placeholder="Campaign goal" />
            <TextAreaField label="Message Template" value={createMessage} onChange={setCreateMessage} rows={4} placeholder="Hello, this is our latest update." />
            <FormActions submitLabel={isSaving ? 'Saving...' : 'Save'} submitDisabled={isSaving} onSubmit={async () => {
              if (!createName.trim() || !createMessage.trim()) { setStatus('Name and message are required'); return }
              setIsSaving(true)
              try { await agentsApi.createCampaign(account.id, { name: createName.trim(), description: createDescription.trim() || undefined, message_template: createMessage.trim() }); setShowCreateForm(false); onSaved('Campaign created'); await loadCampaigns() }
              catch (error) { setStatus(error instanceof Error ? error.message : 'Failed to create campaign') }
              finally { setIsSaving(false) }
            }} onCancel={() => { setShowCreateForm(false); setStatus(null) }} />
          </div>
        ) : null}
        {!loadingCampaigns && campaigns.length > 0 ? (
          <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
            {campaigns.map((c) => (
              <div key={c.id} onClick={async () => {
                try { const camp = await agentsApi.getCampaign(account.id, c.id); setDetailCampaign(camp); setSendLogs([]); setSendLogsTotal(0); setSendLogsPage(1); setShowSendPicker(false); setSendResult(null); if (camp.status !== 'draft') await loadSendLogs(camp.id) }
                catch { setStatus('Failed to load campaign') }
              }} style={{ cursor: 'pointer', padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  <span style={{ padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: c.status === 'completed' ? 'var(--miniapp-sage-dim)' : c.status === 'running' ? 'rgba(90,122,90,0.12)' : 'var(--miniapp-bg-deep)', color: c.status === 'completed' ? 'var(--miniapp-sage)' : 'var(--miniapp-text-muted)' }}>{c.status}</span>
                </div>
                {c.description ? <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>{c.description}</div> : null}
                <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', display: 'flex', gap: 12 }}><span>Sent: {c.sent_count}</span><span>Failed: {c.failed_count}</span><span>Skipped: {c.skipped_count}</span></div>
              </div>
            ))}
          </div>
        ) : null}
        {!loadingCampaigns && campaigns.length === 0 ? <div style={{ marginTop: 8 }}><Note>No campaigns yet.</Note></div> : null}
      </Card>
    </>
  )
}
