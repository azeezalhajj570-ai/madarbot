import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, RefreshCw, Send, Search, X, Eye, Loader, UserCheck, Bot, Shield } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

import { Badge, Button, Dialog, Input, Select, Field } from '../../components/ui/primitives'
import { DataTable, type ColumnDef, type DataTableFilter } from '../../components/ui/data-table'
import { useToast } from '../../components/ui/toast'
import { GroupAutoComplete } from '../../components/ui/data-display'
import { PageShell } from '../../lib/page-shell'
import api, { fetchAgents } from '../../lib/api'
import { spacing } from '../../../../shared/ui-system/tokens'
import type { Agent, AgentJobRecord } from '../../lib/types'

interface AgentGroup {
  id: number
  tg_group_id: number
  title: string
  username?: string
  group_type?: string
  member_count?: number
  messages_count?: number
  can_add_members: boolean
}

interface MemberItem {
  user_id: number
  username?: string
  full_name?: string
  role?: string
  is_bot?: boolean
}

interface MemberAddPayload {
  target_tg_group_id?: number
  source_tg_group_id?: number
  interval_seconds?: number
  user_ids?: number[]
  send_invite_link_on_privacy_restricted?: boolean
  result?: { success_count?: number; failure_count?: number; skip_count?: number; details?: MemberAddResult[] }
  progress?: { success_count?: number; failure_count?: number; skip_count?: number }
}

interface MemberAddResult {
  user_id: number
  success: boolean
  error_code?: string
  flood_wait_seconds?: number
  skipped?: boolean
  method?: 'direct' | 'invite_link'
}

const AGENTS_API_PREFIX = '/api/agents'



function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function extractJobStats(payload: Record<string, unknown> | undefined) {
  const p = (payload || {}) as MemberAddPayload
  const result = p.result
  const progress = p.progress
  const userCount = p.user_ids?.length || 0
  const successCount = result?.success_count ?? progress?.success_count ?? 0
  const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
  const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
  const totalProcessed = successCount + failureCount + skipCount
  return { successCount, failureCount, skipCount, totalProcessed, userCount, details: result?.details }
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function statusBadge(status: string, payload?: Record<string, unknown>) {
  const { totalProcessed, userCount } = extractJobStats(payload)
  if (status === 'completed') {
    if (totalProcessed === 0) return <Badge tone="warning">Completed (no results)</Badge>
    return <Badge tone="success">Completed</Badge>
  }
  if (status === 'running') return <Badge tone="warning">Running ({totalProcessed}/{userCount})</Badge>
  if (status === 'failed') return <Badge tone="destructive">Failed</Badge>
  return <Badge tone="default">{status}</Badge>
}

function MemberRow({ m, isSelected, disabled, onToggle }: { m: MemberItem; isSelected: boolean; disabled?: boolean; onToggle: (id: number) => void }) {
  const badges: React.ReactNode[] = []
  if (disabled) badges.push(<Badge key="already" tone="neutral" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px' }}>Already</Badge>)
  else if (m.is_bot) badges.push(<Badge key="bot" tone="default" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px' }}><Bot size={10} /> Bot</Badge>)
  else if (m.role === 'creator' || m.role === 'admin') badges.push(<Badge key="admin" tone="info" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px' }}><Shield size={10} /> {m.role}</Badge>)

  return (
    <div key={m.user_id} onClick={() => { if (!disabled) onToggle(m.user_id) }}
      style={{ padding: '7px 10px', cursor: disabled ? 'default' : 'pointer', background: isSelected ? 'var(--ui-primary-soft)' : 'transparent', borderBottom: '1px solid var(--ui-border)', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.1s', opacity: disabled ? 0.5 : 1 }}
      onMouseEnter={(e) => { if (!isSelected && !disabled) e.currentTarget.style.background = 'var(--ui-bg-muted)' }}
      onMouseLeave={(e) => { if (!isSelected && !disabled) e.currentTarget.style.background = 'transparent' }}
    >
      <input type="checkbox" checked={isSelected} disabled={disabled} onChange={() => { if (!disabled) onToggle(m.user_id) }} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name || m.username || `${m.user_id}`}</span>
      {m.username && <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{m.username}</span>}
      <div style={{ display: 'flex', gap: 4, marginInlineStart: 'auto', alignItems: 'center' }}>{badges}</div>
      <span style={{ fontSize: 11, color: 'var(--ui-text-muted)', marginInlineStart: badges.length ? 4 : 'auto' }}>{m.user_id}</span>
    </div>
  )
}

const detailResultColumns: ColumnDef<MemberAddResult>[] = [
  { key: 'user_id', label: 'User ID', render: (r) => <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.user_id}</span> },
  { key: 'status', label: 'Status', render: (r) => r.success
    ? <Badge tone="success">Added{r.method === 'invite_link' ? ' (via invite link)' : ''}</Badge>
    : r.skipped
      ? <Badge tone="warning">Skipped{r.error_code ? ` (${r.error_code})` : ''}</Badge>
      : <Badge tone="destructive">Failed{r.error_code ? ` (${r.error_code})` : ''}</Badge>
  },
  { key: 'method', label: 'Method', hideOnMobile: true, render: (r) => r.method === 'invite_link' ? 'Invite link' : r.success ? 'Direct' : '—' },
]

export default function AdminBulkAddPage() {
  const { t } = useI18n()
  const { toast } = useToast()

  const [agents, setAgents] = useState<Agent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [jobs, setJobs] = useState<AgentJobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsRefreshing, setJobsRefreshing] = useState(false)
  const [groupsMap, setGroupsMap] = useState<Map<number, string>>(new Map())

  const [dialogOpen, setDialogOpen] = useState(false)
  const [formAgentId, setFormAgentId] = useState<number | null>(null)
  const [formSourceGroupId, setFormSourceGroupId] = useState<number | null>(null)
  const [formTargetGroupId, setFormTargetGroupId] = useState<number | null>(null)
  const [sourceGroups, setSourceGroups] = useState<AgentGroup[]>([])
  const [targetGroups, setTargetGroups] = useState<AgentGroup[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [members, setMembers] = useState<MemberItem[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState(20)
  const [sendInviteLink, setSendInviteLink] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [searching, setSearching] = useState(false)
  const [fetchingTarget, setFetchingTarget] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [memberPage, setMemberPage] = useState(1)
  const [memberTotal, setMemberTotal] = useState(0)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [detailJob, setDetailJob] = useState<AgentJobRecord | null>(null)
  const [excludeAdminsAndBots, setExcludeAdminsAndBots] = useState(true)
  const [targetMemberIds, setTargetMemberIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    setAgentsLoading(true)
    fetchAgents().then(setAgents).catch(() => {}).finally(() => setAgentsLoading(false))
  }, [])

  const loadGroups = useCallback(async (agentId: number) => {
    try {
      const { data } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${agentId}/groups`)
      const map = new Map<number, string>()
      for (const g of data) {
        map.set(g.tg_group_id, g.title)
      }
      setGroupsMap(map)
    } catch {
      setGroupsMap(new Map())
    }
  }, [])

  const loadJobs = useCallback(async (agentId: number, background?: boolean) => {
    if (background) setJobsRefreshing(true)
    else setJobsLoading(true)
    try {
      const { data } = await api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${agentId}/jobs`)
      setJobs(data.filter((j) => j.job_type === 'member_add'))
    } catch {
      setJobs([])
    } finally {
      setJobsLoading(false)
      setJobsRefreshing(false)
    }
  }, [])

  const handleAgentChange = useCallback((agentId: number | null) => {
    setSelectedAgentId(agentId)
    if (agentId) {
      loadGroups(agentId)
      loadJobs(agentId)
    } else {
      setJobs([])
      setGroupsMap(new Map())
    }
  }, [loadGroups, loadJobs])

  useEffect(() => {
    if (!selectedAgentId) { setJobs([]); return }
    loadJobs(selectedAgentId)
  }, [selectedAgentId, loadJobs])

  const hasActiveJobs = useMemo(() => jobs.some(j => ['running', 'pending', 'queued'].includes(j.status)), [jobs])

  useEffect(() => {
    if (!selectedAgentId || !hasActiveJobs) return
    const id = setInterval(() => loadJobs(selectedAgentId, true), 10_000)
    return () => clearInterval(id)
  }, [selectedAgentId, hasActiveJobs, loadJobs])

  useEffect(() => {
    if (!formAgentId) { setSourceGroups([]); setTargetGroups([]); setFormSourceGroupId(null); setFormTargetGroupId(null); setMembers([]); return }
    api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${formAgentId}/groups`).then(({ data }) => {
      const seen = new Set<number>()
      const deduped: AgentGroup[] = []
      for (const g of data) {
        if (seen.has(g.tg_group_id)) continue
        seen.add(g.tg_group_id)
        deduped.push(g)
      }
      setSourceGroups(deduped)
      setTargetGroups(deduped.filter((g) => g.can_add_members))
    }).catch(() => { setSourceGroups([]); setTargetGroups([]) })
  }, [formAgentId])

  const MEMBER_PAGE_SIZE = 50

  useEffect(() => {
    if (!formAgentId || !formSourceGroupId) { setMembers([]); setMemberTotal(0); return }
    setSearching(true)
    const params: Record<string, unknown> = { tg_group_id: formSourceGroupId, limit: MEMBER_PAGE_SIZE, page: memberPage }
    if (searchQuery.trim()) params.q = searchQuery.trim()
    api.get<{ members: MemberItem[]; total: number }>(`${AGENTS_API_PREFIX}/${formAgentId}/member-search`, { params })
      .then(({ data }) => { setMembers(data.members || []); setMemberTotal(data.total) })
      .catch(() => { setMembers([]); setMemberTotal(0) })
      .finally(() => setSearching(false))
  }, [formAgentId, formSourceGroupId, searchQuery, memberPage])

  useEffect(() => { setMemberPage(1) }, [formSourceGroupId, searchQuery])

  useEffect(() => {
    if (!formAgentId || !formTargetGroupId) { setTargetMemberIds(new Set()); return }
    setFetchingTarget(true)
    api.get<{ user_ids: number[]; total: number }>(
      `${AGENTS_API_PREFIX}/${formAgentId}/target-group-members/${formTargetGroupId}`,
    ).then(({ data }) => {
      const ids = new Set(data.user_ids || [])
      setTargetMemberIds(ids)
      setSelectedUserIds(prev => prev.filter(id => !ids.has(id)))
    }).catch(() => {
      setTargetMemberIds(new Set())
    }).finally(() => setFetchingTarget(false))
  }, [formAgentId, formTargetGroupId])

  const visibleMembers = useMemo(() => {
    let list = members
    if (excludeAdminsAndBots) {
      list = list.filter(m => !m.is_bot && m.role !== 'creator' && m.role !== 'admin')
    }
    return list.map(m => ({ ...m, alreadyInTarget: targetMemberIds.has(m.user_id) }))
  }, [members, excludeAdminsAndBots, targetMemberIds])

  function getGroupName(tgGroupId: number | null | undefined): string {
    if (tgGroupId == null) return '—'
    return groupsMap.get(tgGroupId) || `#${tgGroupId}`
  }

  function openDialog() {
    setFormAgentId(selectedAgentId); setFormSourceGroupId(null); setFormTargetGroupId(null)
    setSearchQuery(''); setMembers([]); setMemberTotal(0); setMemberPage(1); setSelectedUserIds([]); setIntervalSeconds(20)
    setSendInviteLink(false); setExcludeAdminsAndBots(true); setFormErrors({}); setDialogOpen(true)
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {}
    if (!formTargetGroupId) errors.target = t('bulkadd.errorTargetRequired')
    if (!selectedUserIds.length) errors.members = t('bulkadd.errorMembersRequired')
    if (intervalSeconds < 1) errors.interval = t('bulkadd.errorIntervalMin')
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  function toggleUser(userId: number) {
    setSelectedUserIds((prev) => prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId])
    if (formErrors.members && selectedUserIds.length === 0) setFormErrors(prev => { const { members, ...rest } = prev; return rest })
  }

  function selectAll() {
    setSelectedUserIds(visibleMembers.filter((m: any) => !m.alreadyInTarget).map(m => m.user_id))
  }

  function unselectAll() {
    setSelectedUserIds([])
  }

  const adminCount = useMemo(() => members.filter(m => m.role === 'creator' || m.role === 'admin').length, [members])
  const botCount = useMemo(() => members.filter(m => m.is_bot).length, [members])

  async function handleSubmit() {
    if (!formAgentId || !formTargetGroupId || !selectedUserIds.length) return
    if (!validateForm()) return
    setSubmitting(true)
    try {
      await api.post(`${AGENTS_API_PREFIX}/${formAgentId}/member-adds`, {
        target_tg_group_id: formTargetGroupId,
        source_tg_group_id: formSourceGroupId,
        interval_seconds: intervalSeconds,
        user_ids: selectedUserIds,
        send_invite_link_on_privacy_restricted: sendInviteLink,
      })
      toast.success(t('bulkadd.jobCreated'))
      setDialogOpen(false)
      if (selectedAgentId === formAgentId) loadJobs(selectedAgentId)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create job')
    } finally { setSubmitting(false) }
  }

  async function syncAgentGroups() {
    if (!selectedAgentId) return
    setSyncing(true)
    try {
      const { data } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups`)
      const map = new Map<number, string>()
      for (const g of data) {
        map.set(g.tg_group_id, g.title)
      }
      setGroupsMap(map)
      setSourceGroups(data); setTargetGroups(data.filter((g) => g.can_add_members))
      toast.success(`Synced ${data.length} groups`)
    } catch (err: any) { toast.error(err?.message || t('bulkadd.syncFailed')) }
    finally { setSyncing(false) }
  }

  const columns: ColumnDef<AgentJobRecord>[] = [
    { key: 'id', label: t('bulkadd.id'), hideOnMobile: true, render: (j) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>#{j.id}</span> },
    { key: 'source', label: 'Source', hideOnMobile: true, render: (j) => {
      const p = (j.job_payload || {}) as MemberAddPayload
      return <span style={{ fontSize: 13 }}>{getGroupName(p.source_tg_group_id)}</span>
    }},
    { key: 'target', label: 'Dest', render: (j) => {
      const p = (j.job_payload || {}) as MemberAddPayload
      return <span style={{ fontSize: 13 }}>{getGroupName(p.target_tg_group_id)}</span>
    }},
    { key: 'status', label: 'Status', render: (j) => statusBadge(j.status, j.job_payload) },
    { key: 'users', label: 'Users', hideOnMobile: true, render: (j) => { const p = (j.job_payload || {}) as MemberAddPayload; return String(p.user_ids?.length || 0) } },
    { key: 'results', label: 'Results', render: (j) => {
      const { successCount, failureCount, skipCount, totalProcessed, userCount } = extractJobStats(j.job_payload)
      const isComplete = j.status === 'completed' && totalProcessed > 0
      const summary = isComplete ? `${successCount} added · ${skipCount} skipped · ${failureCount} failed` : j.status === 'running' ? `${totalProcessed} / ${userCount}` : '—'
      return <span style={{ fontSize: 12 }}>{summary}</span>
    }},
    { key: 'created', label: 'Created', hideOnMobile: true, render: (j) => <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{formatDate(j.created_at)}</span> },
    { key: 'actions', label: '', hideOnMobile: false, render: (j) => (
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetailJob(j) }}><Eye size={14} /> View</Button>
    )},
  ]

  const filters: DataTableFilter[] = [{ key: 'status', label: 'Status', options: STATUS_OPTIONS }]

  return (
    <PageShell titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={false}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.lg }}>
        <div style={{ minWidth: 220, flex: '1 1 220px', position: 'relative' }}>
          <Select value={selectedAgentId ?? ''} onChange={(e) => handleAgentChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{agentsLoading ? t('common.loading') : t('bulkadd.selectAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.external_account_id || `${t('bulkadd.agent')} ${a.id}`} {a.status !== 'active' ? `(${a.status})` : ''}</option>
            ))}
          </Select>
          {agentsLoading && <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}><Loader size={14} className="spin" /></div>}
        </div>
        <Button variant="outline" size="sm" onClick={syncAgentGroups} disabled={!selectedAgentId || syncing}>
          <RefreshCw size={14} /> {syncing ? t('bulkadd.syncing') : t('bulkadd.sync')}
        </Button>
        <div style={{ flex: 1 }} />
        <Button onClick={openDialog} disabled={!selectedAgentId}><Plus size={14} /> {t('bulkadd.newJob')}</Button>
      </div>

      {hasActiveJobs && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ui-text-muted)', marginBottom: spacing.sm }}>
        <Loader size={12} className="spin" />
        Auto-refreshing every 10s — {jobs.filter(j => ['running', 'pending', 'queued'].includes(j.status)).length} active job(s)
      </div>}
      <DataTable<AgentJobRecord>
        columns={columns} data={jobs} keyExtractor={(j) => j.id} loading={jobsLoading} isFetching={jobsRefreshing}
        searchPlaceholder={t('bulkadd.searchJobs')} filters={filters}
        title={t('bulkadd.recentJobs')}
        subtitle={selectedAgentId
          ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''} for ${agents.find(a => a.id === selectedAgentId)?.external_account_id || `agent #${selectedAgentId}`}`
          : t('bulkadd.selectAgentDesc')}
      />

      <Dialog open={dialogOpen} title={t('bulkadd.title')} description={t('bulkadd.desc')} onClose={() => setDialogOpen(false)}>
        <Field label={t('bulkadd.agent')}>
          <Select value={formAgentId ?? ''} onChange={(e) => setFormAgentId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('bulkadd.selectAgent')}</option>
            {agents.map((a) => (<option key={a.id} value={a.id}>{a.external_account_id || `${t('bulkadd.agent')} ${a.id}`}</option>))}
          </Select>
        </Field>
        <Field label={t('bulkadd.sourceGroup')}>
          <GroupAutoComplete items={sourceGroups} value={formSourceGroupId} onChange={setFormSourceGroupId}
            placeholder={sourceGroups.length ? t('bulkadd.selectSource') : t('bulkadd.noGroups')}
            getId={(g: any) => g.tg_group_id} getLabel={(g: any) => g.title} />
        </Field>
        <Field label={t('bulkadd.targetGroup')}>
          <GroupAutoComplete items={targetGroups} value={formTargetGroupId}
            onChange={(v) => { setFormTargetGroupId(v); if (formErrors.target) setFormErrors(prev => { const { target, ...rest } = prev; return rest }) }}
            placeholder={targetGroups.length ? t('bulkadd.selectTarget') : t('bulkadd.noTargetGroups')}
            getId={(g: any) => g.tg_group_id} getLabel={(g: any) => g.title} />
          {formErrors.target && <div style={{ color: 'var(--ui-danger)', fontSize: 12, marginTop: 2 }}>{formErrors.target}</div>}
          {fetchingTarget && <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Loader size={12} className="spin" /> Fetching target group members from Telegram...</div>}
        </Field>
        {formSourceGroupId && (
          <Field label={t('bulkadd.searchMembers')}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ui-text-muted)', pointerEvents: 'none' }} />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('bulkadd.searchPlaceholder')}
                style={{ width: '100%', minHeight: 38, borderRadius: 8, border: '1px solid var(--ui-border-strong)', padding: '0 30px 0 32px', background: 'var(--ui-surface-strong)', color: 'var(--ui-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              {searchQuery && <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ui-text-muted)', cursor: 'pointer', padding: 4 }}><X size={14} /></button>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <Button variant="outline" size="sm" onClick={selectAll}><UserCheck size={12} /> Select All</Button>
              <Button variant="outline" size="sm" onClick={unselectAll}>Unselect All</Button>
              <div style={{ flex: 1 }} />
              <Button
                variant={excludeAdminsAndBots ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setExcludeAdminsAndBots(!excludeAdminsAndBots); setSelectedUserIds([]) }}
              >
                {excludeAdminsAndBots ? <Shield size={12} /> : <Bot size={12} />} {excludeAdminsAndBots ? 'Admins/Bots excluded' : 'Show all'}
              </Button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginBottom: 4 }}>
              {visibleMembers.length} members{excludeAdminsAndBots && (adminCount > 0 || botCount > 0) ? ` (${adminCount} admin, ${botCount} bot hidden)` : ''}
            </div>
            {searching ? <div style={{ padding: spacing.xl, textAlign: 'center', fontSize: 13, color: 'var(--ui-text-muted)' }}>{t('bulkadd.searching')}</div>
             : visibleMembers.length === 0 ? <div style={{ padding: spacing.xl, textAlign: 'center', fontSize: 13, color: 'var(--ui-text-muted)' }}>{t('bulkadd.noMembers')}</div>
             : <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--ui-border)', borderRadius: 8 }}>
                 {visibleMembers.map((m: any) => <MemberRow key={m.user_id} m={m} isSelected={selectedUserIds.includes(m.user_id)} disabled={m.alreadyInTarget} onToggle={toggleUser} />)}
               </div>
            }
             <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 4 }}>{selectedUserIds.length} {t('bulkadd.selected')}</div>
             {memberTotal > MEMBER_PAGE_SIZE && !searching && (
               <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }}>
                 <button onClick={() => setMemberPage(Math.max(1, memberPage - 1))} disabled={memberPage <= 1}
                   style={{ background: 'var(--ui-surface-strong)', border: '1px solid var(--ui-border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: memberPage <= 1 ? 'var(--ui-text-muted)' : 'var(--ui-text)' }}>Prev</button>
                 <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{memberPage} / {Math.ceil(memberTotal / MEMBER_PAGE_SIZE)}</span>
                 <button onClick={() => setMemberPage(memberPage + 1)} disabled={memberPage >= Math.ceil(memberTotal / MEMBER_PAGE_SIZE)}
                   style={{ background: 'var(--ui-surface-strong)', border: '1px solid var(--ui-border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: memberPage >= Math.ceil(memberTotal / MEMBER_PAGE_SIZE) ? 'var(--ui-text-muted)' : 'var(--ui-text)' }}>Next</button>
               </div>
             )}
             {formErrors.members && <div style={{ color: 'var(--ui-danger)', fontSize: 12, marginTop: 2 }}>{formErrors.members}</div>}
          </Field>
        )}
        <Field label={t('bulkadd.interval')}>
          <Input type="number" value={intervalSeconds} onChange={(e) => { setIntervalSeconds(Math.max(1, Number(e.target.value))); if (formErrors.interval) setFormErrors(prev => { const { interval, ...rest } = prev; return rest }) }} min={1} />
          {formErrors.interval && <div style={{ color: 'var(--ui-danger)', fontSize: 12, marginTop: 2 }}>{formErrors.interval}</div>}
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={sendInviteLink} onChange={(e) => setSendInviteLink(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--ui-primary)' }} />
          {t('bulkadd.sendInviteLink')}
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => { if (validateForm()) handleSubmit() }} disabled={!formAgentId || !formTargetGroupId || !selectedUserIds.length || submitting}>
            <Send size={14} /> {submitting ? t('common.queuing') : `${t('bulkadd.queueJob')} (${selectedUserIds.length} users)`}
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!detailJob} title={`Job #${detailJob?.id} — Per-User Results`} onClose={() => setDetailJob(null)} style={{ width: 'min(90vw, 680px)' }}>
        {detailJob && (() => {
          const { details, successCount, failureCount, skipCount } = extractJobStats(detailJob.job_payload)
          return <div>
            <div style={{ display: 'flex', gap: spacing.md, marginBottom: spacing.md, fontSize: 13 }}>
              <Badge tone="success">{successCount} added</Badge>
              <Badge tone="warning">{skipCount} skipped</Badge>
              <Badge tone="destructive">{failureCount} failed</Badge>
            </div>
            {details?.length ? (
              <DataTable<MemberAddResult>
                columns={detailResultColumns} data={details} keyExtractor={(r) => r.user_id}
                searchPlaceholder="Search by user ID..."
              />
            ) : (
              <div style={{ padding: spacing.lg, textAlign: 'center', color: 'var(--ui-text-muted)', fontSize: 13 }}>No per-user details available.</div>
            )}
          </div>
        })()}
      </Dialog>
    </PageShell>
  )
}
