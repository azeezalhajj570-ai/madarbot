import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, Send, Search, X, Eye, Loader, UserCheck, Bot, Shield } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

import { Badge, Button, Dialog, Input, Select, Field } from '../../components/ui/primitives'
import { DataTable, type ColumnDef, type DataTableFilter } from '../../components/ui/data-table'
import { useToast } from '../../components/ui/toast'
import { PageShell } from '../../lib/page-shell'
import api, { fetchAgents, fetchMemberOperations, verifyMemberOperations } from '../../lib/api'
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
  /** Whether the agent is a member of the group (bulk-add eligibility). */
  is_member?: boolean
  /** Whether the agent is an admin/creator of the group. Independent of can_add_members. */
  is_admin?: boolean
  /** Deprecated alias of is_member — kept for backward compatibility. */
  can_add_members?: boolean
}

interface MemberItem {
  user_id: number
  username?: string
  full_name?: string
  role?: string
  is_bot?: boolean
  invitation_status?: {
    status?: string
    sent_at?: string | null
    invitation_link?: string | null
    agent_id?: number
    is_own?: boolean
  } | null
  already_added?: boolean
}

interface MemberAddPayload {
  target_tg_group_id?: number
  source_tg_group_id?: number
  interval_seconds?: number
  user_ids?: number[]
  send_invite_link_on_privacy_restricted?: boolean
  result?: { success_count?: number; failure_count?: number; skip_count?: number; invite_link_count?: number; details?: MemberAddResult[]; results?: MemberAddResult[] }
  progress?: { success_count?: number; failure_count?: number; skip_count?: number; invite_link_count?: number }
}

interface MemberAddResult {
  user_id: number
  status?: string
  success?: boolean
  skipped?: boolean
  inviteLinkSent?: boolean
  error_code?: string
  reason?: string
  flood_wait_seconds?: number
  method?: 'direct' | 'invite_link'
}

const AGENTS_API_PREFIX = '/api/agents'

interface AsyncGroupAutoCompleteProps {
  agentId: number
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  canAddMembersOnly?: boolean
  errorText?: string
}

/** Debounced server-side group autocomplete scoped to the selected agent. */
function AsyncGroupAutoComplete({ agentId, value, onChange, placeholder, canAddMembersOnly, errorText }: AsyncGroupAutoCompleteProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<AgentGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = options.find((g) => g.tg_group_id === value) ?? null

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setOpen(false)
      setOptions([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${agentId}/groups`, { params: { q } })
        const seen = new Set<number>()
        const deduped: AgentGroup[] = []
        for (const g of data) {
          if (seen.has(g.tg_group_id)) continue
          seen.add(g.tg_group_id)
          // Any group the agent is a member of is a valid bulk-add target.
          // Membership grants eligibility; admin status is not required
          // (Telegram still enforces each add). `can_add_members` is retained
          // as a backward-compatible alias of `is_member`.
          if (canAddMembersOnly && !g.is_member && !g.can_add_members) continue
          deduped.push(g)
        }
        setOptions(deduped)
        setOpen(true)
      } catch {
        setOptions([])
        setError('Search failed')
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [agentId, query, canAddMembersOnly])

  function handleSelect(id: number) {
    onChange(id)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        placeholder={placeholder}
        value={selected && !open ? `${selected.title}` : query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (query.trim()) setOpen(true) }}
        style={{
          width: '100%', minHeight: 42, borderRadius: 8, border: '1px solid var(--ui-border-strong)',
          padding: '0 12px', background: 'var(--ui-surface-strong)', color: 'var(--ui-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
        }}
        aria-label={placeholder}
      />
      {query.trim() && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, marginTop: 4,
          borderRadius: 8, border: '1px solid var(--ui-border)', background: 'var(--ui-surface)',
          boxShadow: 'var(--ui-shadow)', maxHeight: 240, overflowY: 'auto',
        }}>
          {loading ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--ui-text-muted)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Loader size={13} className="spin" /> Searching...
            </div>
          ) : error ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--ui-danger)', textAlign: 'center' }}>{error}</div>
          ) : options.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--ui-text-muted)', textAlign: 'center' }}>No matching groups</div>
          ) : options.map((g) => (
            <div
              key={g.tg_group_id}
              onClick={() => handleSelect(g.tg_group_id)}
              style={{
                padding: '9px 12px', cursor: 'pointer', fontSize: 13, background: g.tg_group_id === value ? 'var(--ui-primary-soft)' : 'transparent',
                borderBottom: '1px solid var(--ui-border)', transition: 'background 0.1s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ui-bg-muted)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = g.tg_group_id === value ? 'var(--ui-primary-soft)' : 'transparent' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
              {g.username && <span style={{ fontSize: 11, color: 'var(--ui-text-muted)', flexShrink: 0 }}>@{g.username}</span>}
            </div>
          ))}
        </div>
      )}
      {errorText && <div style={{ color: 'var(--ui-danger)', fontSize: 12, marginTop: 2 }}>{errorText}</div>}
    </div>
  )
}



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
  const inviteLinkCount = result?.invite_link_count ?? progress?.invite_link_count ?? 0
  const totalProcessed = successCount + failureCount + skipCount + inviteLinkCount
  const rawDetails = result?.details ?? result?.results
  const details: MemberAddResult[] | undefined = Array.isArray(rawDetails)
    ? rawDetails.map((r: any) => ({
        user_id: r.user_id,
        status: r.status,
        success: r.status === 'success' || r.status === 'joined',
        skipped: r.status === 'skipped',
        inviteLinkSent: r.status === 'invite_link_sent' || r.status === 'joined',
        error_code: r.error_code,
        reason: r.reason,
        flood_wait_seconds: r.flood_wait_seconds,
        method: r.method || (r.status === 'success' ? 'direct' : undefined),
      }))
    : undefined
  return { successCount, failureCount, skipCount, inviteLinkCount, totalProcessed, userCount, details }
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
  const { totalProcessed, userCount, inviteLinkCount } = extractJobStats(payload)
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
  const joinedViaInvite = m.invitation_status?.status === 'joined'
  if (disabled) badges.push(<Badge key="already" tone="neutral" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px' }}>{joinedViaInvite ? 'Joined via invite' : 'Already in group'}</Badge>)
  else if (m.invitation_status) badges.push(<Badge key="invited" tone="info" style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px' }}>{joinedViaInvite ? 'Joined via invite' : (m.invitation_status.is_own === false ? 'Invitation sent by other agent' : 'Invitation sent')}</Badge>)
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
  { key: 'status', label: 'Status', render: (r) => {
    if (r.success) return <Badge tone="success">Added</Badge>
    if (r.status === 'invite_link_sent') return <Badge tone="info">Invite sent</Badge>
    if (r.status === 'joined') return <Badge tone="success">Joined via invite</Badge>
    if (r.inviteLinkSent) return <Badge tone="warning">Invite link sent</Badge>
    if (r.skipped) return <Badge tone="warning">Skipped{(r.reason || r.error_code) ? ` (${r.reason || r.error_code})` : ''}</Badge>
    return <Badge tone="destructive">Failed{r.error_code ? ` (${r.error_code})` : ''}</Badge>
  }},
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
  const [searchQuery, setSearchQuery] = useState('')
  const [members, setMembers] = useState<MemberItem[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState(20)
  const [sendInviteLink, setSendInviteLink] = useState(false)
  const [customInviteMessage, setCustomInviteMessage] = useState('')
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
  const [verifying, setVerifying] = useState(false)

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

  const MEMBER_PAGE_SIZE = 50

  useEffect(() => {
    if (!formAgentId || !formSourceGroupId) { setMembers([]); setMemberTotal(0); return }
    setSearching(true)
    const params: Record<string, unknown> = { tg_group_id: formSourceGroupId, limit: MEMBER_PAGE_SIZE, page: memberPage }
    if (searchQuery.trim()) params.q = searchQuery.trim()
    if (formTargetGroupId) params.target_tg_group_id = formTargetGroupId
    api.get<{ members: MemberItem[]; total: number }>(`${AGENTS_API_PREFIX}/${formAgentId}/member-search`, { params })
      .then(({ data }) => { setMembers(data.members || []); setMemberTotal(data.total) })
      .catch(() => { setMembers([]); setMemberTotal(0) })
      .finally(() => setSearching(false))
  }, [formAgentId, formSourceGroupId, searchQuery, memberPage, formTargetGroupId])

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
    return list.map(m => ({
      ...m,
      alreadyInTarget: targetMemberIds.has(m.user_id) || !!m.already_added || m.invitation_status?.status === 'joined',
    }))
  }, [members, excludeAdminsAndBots, targetMemberIds])

  function getGroupName(tgGroupId: number | null | undefined): string {
    if (tgGroupId == null) return '—'
    return groupsMap.get(tgGroupId) || `#${tgGroupId}`
  }

  function openDialog() {
    setFormAgentId(selectedAgentId); setFormSourceGroupId(null); setFormTargetGroupId(null)
    setSearchQuery(''); setMembers([]); setMemberTotal(0); setMemberPage(1); setSelectedUserIds([]); setIntervalSeconds(3600)
    setSendInviteLink(false); setCustomInviteMessage(''); setExcludeAdminsAndBots(true); setFormErrors({}); setDialogOpen(true)
  }

  function validateForm(): boolean {
    const errors: Record<string, string> = {}
    if (!formTargetGroupId) errors.target = t('bulkadd.errorTargetRequired')
    if (!selectedUserIds.length) errors.members = t('bulkadd.errorMembersRequired')
    if (intervalSeconds < 3600) errors.interval = t('bulkadd.errorIntervalMin')
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
        custom_invite_message: customInviteMessage.trim() ? customInviteMessage.trim() : null,
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
      toast.success(`Synced ${data.length} groups`)
    } catch (err: any) { toast.error(err?.message || t('bulkadd.syncFailed')) }
    finally { setSyncing(false) }
  }

  async function handleVerify() {
    if (!selectedAgentId) return
    setVerifying(true)
    try {
      const result = await verifyMemberOperations(selectedAgentId)
      toast.success(`Verified: ${result.total_joined || 0} joined, ${result.total_not_joined || 0} not joined`)
      loadJobs(selectedAgentId, true)
    } catch (err: any) {
      toast.error(err?.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
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
      const { successCount, failureCount, skipCount, inviteLinkCount, totalProcessed, userCount } = extractJobStats(j.job_payload)
      const isComplete = j.status === 'completed' && totalProcessed > 0
      const parts = []
      if (successCount > 0) parts.push(`${successCount} added`)
      if (skipCount > 0) parts.push(`${skipCount} skipped`)
      if (inviteLinkCount > 0) parts.push(`${inviteLinkCount} invites sent`)
      if (failureCount > 0) parts.push(`${failureCount} failed`)
      const summary = isComplete
        ? parts.join(' · ') || 'No results'
        : j.status === 'running' ? `${totalProcessed} / ${userCount}` : '—'
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
        <Button variant="outline" size="sm" onClick={handleVerify} disabled={!selectedAgentId || verifying}>
          <UserCheck size={14} /> {verifying ? 'Verifying...' : 'Verify Joins'}
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
          <AsyncGroupAutoComplete agentId={formAgentId!} value={formSourceGroupId} onChange={setFormSourceGroupId}
            placeholder={t('bulkadd.selectSource')} />
        </Field>
        <Field label={t('bulkadd.targetGroup')}>
          <AsyncGroupAutoComplete agentId={formAgentId!} value={formTargetGroupId}
            onChange={(v) => { setFormTargetGroupId(v); if (formErrors.target) setFormErrors(prev => { const { target, ...rest } = prev; return rest }) }}
            placeholder={t('bulkadd.selectTarget')} canAddMembersOnly errorText={formErrors.target} />
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
          <Input type="number" value={intervalSeconds} onChange={(e) => { setIntervalSeconds(Math.max(3600, Number(e.target.value) || 3600)); if (formErrors.interval) setFormErrors(prev => { const { interval, ...rest } = prev; return rest }) }} min={3600} />
          {formErrors.interval && <div style={{ color: 'var(--ui-danger)', fontSize: 12, marginTop: 2 }}>{formErrors.interval}</div>}
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={sendInviteLink} onChange={(e) => setSendInviteLink(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--ui-primary)' }} />
          {t('bulkadd.sendInviteLink')}
        </label>
        {sendInviteLink && (
          <Field label={t('bulkadd.customMessage')}>
            <textarea
              value={customInviteMessage}
              onChange={(e) => setCustomInviteMessage(e.target.value)}
              rows={3}
              placeholder={t('bulkadd.customMessagePlaceholder')}
              maxLength={2000}
              style={{ width: '100%', minHeight: 72, borderRadius: 8, border: '1px solid var(--ui-border-strong)', padding: 10, background: 'var(--ui-surface-strong)', color: 'var(--ui-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--ui-text-muted)', marginTop: 2 }}>{t('bulkadd.customMessageHint')}</div>
          </Field>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => { if (validateForm()) handleSubmit() }} disabled={!formAgentId || !formTargetGroupId || !selectedUserIds.length || submitting}>
            <Send size={14} /> {submitting ? t('common.queuing') : `${t('bulkadd.queueJob')} (${selectedUserIds.length} users)`}
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!detailJob} title={`Job #${detailJob?.id} — Per-User Results`} onClose={() => setDetailJob(null)} style={{ width: 'min(90vw, 680px)' }}>
        {detailJob && (() => {
          const { details, successCount, failureCount, skipCount, inviteLinkCount } = extractJobStats(detailJob.job_payload)
          return <div>
            <div style={{ display: 'flex', gap: spacing.md, marginBottom: spacing.md, fontSize: 13, flexWrap: 'wrap' }}>
              <Badge tone="success">{successCount} added</Badge>
              <Badge tone="warning">{skipCount} skipped</Badge>
              <Badge tone="info">{inviteLinkCount} invites sent</Badge>
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
