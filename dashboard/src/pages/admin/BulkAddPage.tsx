import { useEffect, useState, useCallback } from 'react'
import { Plus, RefreshCw, Send, Search, X } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

import { Badge, Button, Card, Dialog, EmptyState, Input, Select, Field } from '../../components/ui/primitives'
import { DataTable, type ColumnDef, type DataTableFilter } from '../../components/ui/data-table'
import { useToast } from '../../components/ui/toast'
import { GroupAutoComplete } from '../../components/ui/data-display'
import { PageShell } from '../../lib/page-shell'
import api, { fetchAgents } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
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

const AGENTS_API_PREFIX = '/api/agents'

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function statusBadge(status: string, payload?: Record<string, unknown>) {
  const p = payload || {}
  const result = p.result as Record<string, number> | undefined
  const progress = p.progress as Record<string, number> | undefined
  const userCount = (p.user_ids as number[])?.length || 0
  const successCount = result?.success_count ?? progress?.success_count ?? 0
  const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
  const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
  const totalProcessed = successCount + failureCount + skipCount

  if (status === 'completed') {
    if (totalProcessed === 0) return <Badge tone="warning">Completed (no results)</Badge>
    return <Badge tone="success">Completed</Badge>
  }
  if (status === 'running') return <Badge tone="warning">Running ({totalProcessed}/{userCount})</Badge>
  if (status === 'failed') return <Badge tone="destructive">Failed</Badge>
  return <Badge tone="default">{status}</Badge>
}

function MemberSearchList({
  members,
  searching,
  selectedUserIds,
  onToggle,
}: {
  members: MemberItem[]
  searching: boolean
  selectedUserIds: number[]
  onToggle: (userId: number) => void
}) {
  const { t } = useI18n()
  if (searching) {
    return (
      <div style={{ padding: spacing.xl, textAlign: 'center', fontSize: 13, color: 'var(--ui-text-muted)' }}>
        {t('bulkadd.searching')}
      </div>
    )
  }
  if (members.length === 0) {
    return (
      <div style={{ padding: spacing.xl, textAlign: 'center', fontSize: 13, color: 'var(--ui-text-muted)' }}>
        {t('bulkadd.noMembers')}
      </div>
    )
  }
  return (
    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--ui-border)', borderRadius: 8 }}>
      {members.map((m) => {
        const isSelected = selectedUserIds.includes(m.user_id)
        return (
          <div
            key={m.user_id}
            onClick={() => onToggle(m.user_id)}
            style={{
              padding: '7px 10px',
              cursor: 'pointer',
              background: isSelected ? 'var(--ui-primary-soft)' : 'transparent',
              borderBottom: '1px solid var(--ui-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--ui-bg-muted)' }}
            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
          >
            <input type="checkbox" checked={isSelected} onChange={() => onToggle(m.user_id)} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name || m.username || `${m.user_id}`}</span>
            {m.username && <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{m.username}</span>}
            <span style={{ fontSize: 11, color: 'var(--ui-text-muted)', marginInlineStart: 'auto' }}>{m.user_id}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminBulkAddPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const user = getStoredUser()

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
      </PageShell>
    )
  }

  // ─── DataTable state ──────────────────────────────────────────────────────

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [jobs, setJobs] = useState<AgentJobRecord[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)

  // ─── Dialog state ─────────────────────────────────────────────────────────

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
  const [syncing, setSyncing] = useState(false)

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => {})
  }, [])

  const loadJobs = useCallback(async (agentId: number) => {
    setJobsLoading(true)
    try {
      const { data } = await api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${agentId}/jobs`)
      setJobs(data.filter((j) => j.job_type === 'member_add'))
    } catch {
      setJobs([])
    } finally {
      setJobsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedAgentId) { setJobs([]); return }
    loadJobs(selectedAgentId)
  }, [selectedAgentId, loadJobs])

  // Load groups when dialog form agent changes
  useEffect(() => {
    if (!formAgentId) {
      setSourceGroups([])
      setTargetGroups([])
      setFormSourceGroupId(null)
      setFormTargetGroupId(null)
      setMembers([])
      return
    }
    api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${formAgentId}/groups`).then(({ data }) => {
      setSourceGroups(data)
      setTargetGroups(data.filter((g) => g.can_add_members))
    }).catch(() => {
      setSourceGroups([])
      setTargetGroups([])
    })
  }, [formAgentId])

  // Search members in dialog
  useEffect(() => {
    if (!formAgentId || !formSourceGroupId) {
      setMembers([])
      return
    }
    setSearching(true)
    const params: Record<string, unknown> = { tg_group_id: formSourceGroupId, limit: 50 }
    if (searchQuery.trim()) params.q = searchQuery.trim()
    api.get<{ members: MemberItem[]; total: number }>(`${AGENTS_API_PREFIX}/${formAgentId}/member-search`, { params })
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setSearching(false))
  }, [formAgentId, formSourceGroupId, searchQuery])

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function openDialog() {
    setFormAgentId(selectedAgentId)
    setFormSourceGroupId(null)
    setFormTargetGroupId(null)
    setSearchQuery('')
    setMembers([])
    setSelectedUserIds([])
    setIntervalSeconds(20)
    setSendInviteLink(false)
    setDialogOpen(true)
  }

  function toggleUser(userId: number) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  async function handleSubmit() {
    if (!formAgentId || !formTargetGroupId || !selectedUserIds.length) return
    setSubmitting(true)
    try {
      await api.post(`${AGENTS_API_PREFIX}/${formAgentId}/member-adds`, {
        target_tg_group_id: formTargetGroupId,
        interval_seconds: intervalSeconds,
        user_ids: selectedUserIds,
        send_invite_link_on_privacy_restricted: sendInviteLink,
      })
      toast.success(t('bulkadd.jobCreated'))
      setDialogOpen(false)
      if (selectedAgentId === formAgentId) {
        loadJobs(selectedAgentId)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  async function syncAgentGroups() {
    if (!selectedAgentId) return
    setSyncing(true)
    try {
      const { data } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups`)
      setSourceGroups(data)
      setTargetGroups(data.filter((g) => g.can_add_members))
    } catch (err: any) {
      toast.error(err?.message || t('bulkadd.syncFailed'))
    } finally {
      setSyncing(false)
    }
  }

  // ─── DataTable definition ─────────────────────────────────────────────────

  const columns: ColumnDef<AgentJobRecord>[] = [
    {
      key: 'id',
      label: t('bulkadd.id'),
      hideOnMobile: true,
      render: (j) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>#{j.id}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (j) => statusBadge(j.status, j.job_payload),
    },
    {
      key: 'target',
      label: t('bulkadd.target'),
      hideOnMobile: true,
      render: (j) => {
        const p = j.job_payload || {}
        return <span style={{ fontSize: 13 }}>{String(p.target_tg_group_id ?? '—')}</span>
      },
    },
    {
      key: 'users',
      label: t('bulkadd.users'),
      render: (j) => {
        const p = j.job_payload || {}
        return String((p.user_ids as number[])?.length || 0)
      },
    },
    {
      key: 'results',
      label: t('bulkadd.results'),
      render: (j) => {
        const p = j.job_payload || {}
        const result = p.result as Record<string, number> | undefined
        const progress = p.progress as Record<string, number> | undefined
        const successCount = result?.success_count ?? progress?.success_count ?? 0
        const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
        const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
        const totalProcessed = successCount + failureCount + skipCount
        const userCount = (p.user_ids as number[])?.length || 0
        const isComplete = j.status === 'completed' && totalProcessed > 0
        const summary = isComplete
          ? `${successCount} ${t('bulkadd.added')} · ${skipCount} ${t('bulkadd.skipped')} · ${failureCount} ${t('common.failed')}`
          : j.status === 'running' ? `${totalProcessed} / ${userCount}` : '—'
        return <span style={{ fontSize: 12 }}>{summary}</span>
      },
    },
    {
      key: 'created',
      label: t('bulkadd.created'),
      hideOnMobile: true,
      render: (j) => <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{timeAgo(j.created_at)}</span>,
    },
  ]

  const filters: DataTableFilter[] = [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: '', label: 'All statuses' },
        { value: 'completed', label: 'Completed' },
        { value: 'running', label: 'Running' },
        { value: 'failed', label: 'Failed' },
        { value: 'queued', label: 'Queued' },
        { value: 'pending', label: 'Pending' },
      ],
    },
  ]

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <PageShell titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={false}>
      {/* Agent selector + actions bar */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: spacing.sm,
        flexWrap: 'wrap',
        marginBottom: spacing.lg,
      }}>
        <div style={{ minWidth: 220, flex: '1 1 220px' }}>
          <Select
            value={selectedAgentId ?? ''}
            onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t('bulkadd.selectAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.external_account_id || `${t('bulkadd.agent')} ${a.id}`} {a.status !== 'active' ? `(${a.status})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={syncAgentGroups} disabled={!selectedAgentId || syncing}>
          <RefreshCw size={14} /> {syncing ? t('bulkadd.syncing') : t('bulkadd.sync')}
        </Button>
        <div style={{ flex: 1 }} />
        <Button onClick={openDialog} disabled={!selectedAgentId}>
          <Plus size={14} /> {t('bulkadd.newJob')}
        </Button>
      </div>

      {/* DataTable or empty state */}
      {!selectedAgentId ? (
        <Card>
          <EmptyState
            title={t('bulkadd.selectAgentPrompt')}
            subtitle={t('bulkadd.selectAgentDesc')}
          />
        </Card>
      ) : (
        <DataTable<AgentJobRecord>
          columns={columns}
          data={jobs}
          keyExtractor={(j) => j.id}
          loading={jobsLoading}
          searchPlaceholder={t('bulkadd.searchJobs')}
          filters={filters}
          title={t('bulkadd.recentJobs')}
          subtitle={`${jobs.length} job${jobs.length !== 1 ? 's' : ''} for ${agents.find(a => a.id === selectedAgentId)?.external_account_id || `agent #${selectedAgentId}`}`}
        />
      )}

      {/* ─── Dialog: New Bulk Add ─────────────────────────────────────────────── */}
      <Dialog
        open={dialogOpen}
        title={t('bulkadd.title')}
        description={t('bulkadd.desc')}
        onClose={() => setDialogOpen(false)}
      >
        {/* Agent */}
        <Field label={t('bulkadd.agent')}>
          <Select
            value={formAgentId ?? ''}
            onChange={(e) => setFormAgentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t('bulkadd.selectAgent')}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.external_account_id || `${t('bulkadd.agent')} ${a.id}`}
              </option>
            ))}
          </Select>
        </Field>

        {/* Source Group */}
        <Field label={t('bulkadd.sourceGroup')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <GroupAutoComplete
                items={sourceGroups}
                value={formSourceGroupId}
                onChange={setFormSourceGroupId}
                placeholder={sourceGroups.length ? t('bulkadd.selectSource') : t('bulkadd.noGroups')}
                getId={(g: any) => g.tg_group_id}
                getLabel={(g: any) => g.title}
              />
            </div>
          </div>
        </Field>

        {/* Target Group */}
        <Field label={t('bulkadd.targetGroup')}>
          <GroupAutoComplete
            items={targetGroups}
            value={formTargetGroupId}
            onChange={setFormTargetGroupId}
            placeholder={targetGroups.length ? t('bulkadd.selectTarget') : t('bulkadd.noTargetGroups')}
            getId={(g: any) => g.tg_group_id}
            getLabel={(g: any) => g.title}
          />
        </Field>

        {/* Member search */}
        {formSourceGroupId && (
          <Field label={t('bulkadd.searchMembers')}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--ui-text-muted)', pointerEvents: 'none',
              }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('bulkadd.searchPlaceholder')}
                style={{
                  width: '100%', minHeight: 38, borderRadius: 8,
                  border: '1px solid var(--ui-border-strong)', padding: '0 30px 0 32px',
                  background: 'var(--ui-surface-strong)', color: 'var(--ui-text)',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--ui-text-muted)', cursor: 'pointer', padding: 4 }}>
                  <X size={14} />
                </button>
              )}
            </div>
            <MemberSearchList members={members} searching={searching} selectedUserIds={selectedUserIds} onToggle={toggleUser} />
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 4 }}>{selectedUserIds.length} {t('bulkadd.selected')}</div>
          </Field>
        )}

        {/* Interval */}
        <Field label={t('bulkadd.interval')}>
          <Input
            type="number"
            value={intervalSeconds}
            onChange={(e) => setIntervalSeconds(Math.max(1, Number(e.target.value)))}
            min={1}
          />
        </Field>

        {/* Invite link checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={sendInviteLink}
            onChange={(e) => setSendInviteLink(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--ui-primary)' }}
          />
          {t('bulkadd.sendInviteLink')}
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formAgentId || !formTargetGroupId || !selectedUserIds.length || submitting}
          >
            <Send size={14} /> {submitting ? t('common.queuing') : `${t('bulkadd.queueJob')} (${selectedUserIds.length} ${t('bulkadd.users')})`}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
