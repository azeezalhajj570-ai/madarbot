import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Plus, Send } from 'lucide-react'

import { Badge, Button, Card, EmptyState, Table } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import api, {
  fetchAdminOverview,
  fetchAgents,
} from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview, Agent, AgentJobRecord } from '../../lib/types'

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

export default function AdminBulkAddPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell eyebrow="Admin" titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }

  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [sourceGroups, setSourceGroups] = useState<AgentGroup[]>([])
  const [targetGroups, setTargetGroups] = useState<AgentGroup[]>([])
  const [selectedSourceGroupId, setSelectedSourceGroupId] = useState<number | null>(null)
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [members, setMembers] = useState<MemberItem[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState(20)
  const [sendInviteLink, setSendInviteLink] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [jobs, setJobs] = useState<AgentJobRecord[]>([])
  const [searching, setSearching] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [syncingGroups, setSyncingGroups] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const overview = await fetchAdminOverview()
      setData(overview)
      setError(null)
      setLastRefresh(new Date())
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    fetchAgents().then(setAgents).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedAgentId) {
      setGroups([])
      setSourceGroups([])
      setTargetGroups([])
      setSelectedSourceGroupId(null)
      setSelectedTargetGroupId(null)
      setMembers([])
      return
    }
    api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups`).then(({ data }) => {
      setGroups(data)
      setSourceGroups(data)
      setTargetGroups(data.filter((g) => g.can_add_members))
    }).catch(() => {
      setGroups([])
      setSourceGroups([])
      setTargetGroups([])
    })
  }, [selectedAgentId])

  useEffect(() => {
    if (!selectedAgentId || !selectedSourceGroupId) {
      setMembers([])
      return
    }
    setSearching(true)
    const params: Record<string, unknown> = { tg_group_id: selectedSourceGroupId, limit: 50 }
    if (searchQuery.trim()) params.q = searchQuery.trim()
    api.get<{ members: MemberItem[]; total: number }>(`${AGENTS_API_PREFIX}/${selectedAgentId}/member-search`, { params })
      .then(({ data }) => setMembers(data.members || []))
      .catch(() => setMembers([]))
      .finally(() => setSearching(false))
  }, [selectedAgentId, selectedSourceGroupId, searchQuery])

  useEffect(() => {
    if (!selectedAgentId) { setJobs([]); return }
    api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/jobs`)
      .then(({ data }) => setJobs(data.filter((j) => j.job_type === 'member_add')))
      .catch(() => setJobs([]))
  }, [selectedAgentId])

  function toggleUser(userId: number) {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    )
  }

  async function scrapeSourceGroup() {
    if (!selectedAgentId || !selectedSourceGroupId) return
    setScraping(true)
    try {
      await api.post(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups/${selectedSourceGroupId}/scrape-members`)
      setSearchQuery((prev) => prev || ' ')
      setTimeout(() => setSearchQuery((prev) => prev.trim() || ''), 100)
    } catch (err: any) {
      setError(err?.message || 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }

  async function handleSubmit() {
    if (!selectedAgentId || !selectedTargetGroupId || !selectedUserIds.length) return
    setSubmitting(true)
    try {
      await api.post(`${AGENTS_API_PREFIX}/${selectedAgentId}/member-adds`, {
        target_tg_group_id: selectedTargetGroupId,
        interval_seconds: intervalSeconds,
        user_ids: selectedUserIds,
        send_invite_link_on_privacy_restricted: sendInviteLink,
      })
      setSelectedUserIds([])
      const { data: freshJobs } = await api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/jobs`)
      setJobs(freshJobs.filter((j) => j.job_type === 'member_add'))
    } catch (err: any) {
      setError(err?.message || 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={loading}>
      {error && (
        <Card style={{ background: 'var(--ui-danger-soft, #fef2f2)', border: '1px solid var(--ui-danger, #ef4444)', marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--ui-danger, #ef4444)' }}>{error}</div>
        </Card>
      )}

      <div className="grid-2col" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        {/* Left: Form */}
        <Card title="New Bulk Add Job" subtitle="Select agent, target group, and members to invite.">
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Agent select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Agent</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={selectedAgentId ?? ''}
                  onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : null)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--ui-border, #e4e4e7)', background: 'var(--ui-surface, #fff)', fontSize: 14 }}
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.external_account_id || `Agent ${a.id}`} {a.status !== 'active' ? `(${a.status})` : ''}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={async () => {
                  if (!selectedAgentId) return
                  setSyncingGroups(true)
                  setError(null)
                  try {
                    const { data: freshGroups } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups`)
                    setSourceGroups(freshGroups)
                    setTargetGroups(freshGroups.filter((g) => g.can_add_members))
                  } catch (err: any) {
                    setError(err?.message || 'Failed to sync groups')
                  } finally {
                    setSyncingGroups(false)
                  }
                }} disabled={!selectedAgentId || syncingGroups} style={{ whiteSpace: 'nowrap' }}>
                  <RefreshCw size={14} /> {syncingGroups ? 'Syncing...' : 'Sync'}
                </Button>
              </div>
            </div>

            {/* Source group select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Source Group</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={selectedSourceGroupId ?? ''}
                  onChange={(e) => setSelectedSourceGroupId(e.target.value ? Number(e.target.value) : null)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--ui-border, #e4e4e7)', background: 'var(--ui-surface, #fff)', fontSize: 14 }}
                  disabled={!sourceGroups.length}
                >
                  <option value="">{sourceGroups.length ? 'Select source group...' : 'No groups'}</option>
                  {sourceGroups.map((g) => (
                    <option key={g.tg_group_id} value={g.tg_group_id}>{g.title}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={scrapeSourceGroup}
                  disabled={!selectedSourceGroupId || scraping}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {scraping ? 'Scraping...' : 'Scrape'}
                </Button>
              </div>
            </div>

            {/* Target group select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Target Group</label>
              <select
                value={selectedTargetGroupId ?? ''}
                onChange={(e) => setSelectedTargetGroupId(e.target.value ? Number(e.target.value) : null)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--ui-border, #e4e4e7)', background: 'var(--ui-surface, #fff)', fontSize: 14 }}
                disabled={!targetGroups.length}
              >
                <option value="">{targetGroups.length ? 'Select target group...' : 'No groups with add permission'}</option>
                {targetGroups.map((g) => (
                  <option key={g.tg_group_id} value={g.tg_group_id}>{g.title}</option>
                ))}
              </select>
            </div>

            {/* Member search */}
            {selectedSourceGroupId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Search Members</label>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by username or name..."
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--ui-border, #e4e4e7)', background: 'var(--ui-surface, #fff)', fontSize: 14 }}
                />
                <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6, border: '1px solid var(--ui-border, #e4e4e7)', borderRadius: 6 }}>
                  {searching ? (
                    <div style={{ padding: 12, fontSize: 13, color: 'var(--ui-text-muted, #71717a)' }}>Searching...</div>
                  ) : members.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: 'var(--ui-text-muted, #71717a)' }}>No members found. Select a group and search.</div>
                  ) : (
                    members.map((m) => {
                      const isSelected = selectedUserIds.includes(m.user_id)
                      return (
                        <div
                          key={m.user_id}
                          onClick={() => toggleUser(m.user_id)}
                          style={{
                            padding: '6px 10px',
                            cursor: 'pointer',
                            background: isSelected ? 'var(--ui-primary-soft, #eff6ff)' : 'transparent',
                            borderBottom: '1px solid var(--ui-border, #e4e4e7)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <input type="checkbox" checked={isSelected} onChange={() => toggleUser(m.user_id)} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{m.full_name || m.username || `User ${m.user_id}`}</span>
                          {m.username && <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>@{m.username}</span>}
                          <span style={{ fontSize: 11, color: 'var(--ui-text-muted, #71717a)', marginLeft: 'auto' }}>{m.user_id}</span>
                        </div>
                      )
                    })
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)', marginTop: 4 }}>{selectedUserIds.length} selected</div>
              </div>
            )}

            {/* Interval */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>Interval (seconds)</label>
              <input
                type="number"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Math.max(1, Number(e.target.value)))}
                min={1}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--ui-border, #e4e4e7)', background: 'var(--ui-surface, #fff)', fontSize: 14 }}
              />
            </div>

            {/* Invite link checkbox */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={sendInviteLink} onChange={(e) => setSendInviteLink(e.target.checked)} />
                <span style={{ fontSize: 13 }}>Send invite link if user has privacy restrictions</span>
              </label>
            </div>

            {/* Submit */}
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!selectedAgentId || !selectedTargetGroupId || !selectedUserIds.length || submitting}
            >
              <Send size={14} /> {submitting ? 'Queuing...' : `Queue Member Add (${selectedUserIds.length} users)`}
            </Button>
          </div>
        </Card>

        {/* Right: Recent Jobs */}
        <Card title="Recent Member Add Jobs" subtitle="Latest bulk-add jobs for the selected agent.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button variant="outline" size="sm" onClick={() => {
              if (!selectedAgentId) return
              api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/jobs`)
                .then(({ data }) => setJobs(data.filter((j) => j.job_type === 'member_add')))
            }}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
          {jobs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ui-text-muted, #71717a)', padding: 12 }}>No member_add jobs yet.</div>
          ) : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <Table
                columns={['ID', 'Status', 'Target', 'Users', 'Results', 'Created']}
                rows={jobs.slice(0, 20).map((j) => {
                  const p = j.job_payload || {}
                  const result = p.result as Record<string, number> | undefined
                  const progress = p.progress as Record<string, number> | undefined
                  const userCount = (p.user_ids as number[])?.length || 0
                  const successCount = result?.success_count ?? progress?.success_count ?? 0
                  const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
                  const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
                  const totalProcessed = successCount + failureCount + skipCount

                  let statusBadge = <Badge tone="default">{j.status}</Badge>
                  if (j.status === 'completed') {
                    if (totalProcessed === 0) {
                      statusBadge = <Badge tone="warning">completed (no results)</Badge>
                    } else {
                      statusBadge = <Badge tone="success">completed</Badge>
                    }
                  } else if (j.status === 'running') {
                    statusBadge = <Badge tone="warning">running ({totalProcessed}/{userCount})</Badge>
                  } else if (j.status === 'failed') {
                    statusBadge = <Badge tone="destructive">failed</Badge>
                  }

                  const isComplete = j.status === 'completed' && totalProcessed > 0
                  const resultSummary = isComplete
                    ? `${successCount} added · ${skipCount} skipped · ${failureCount} failed`
                    : j.status === 'running'
                    ? `${totalProcessed} / ${userCount}`
                    : '—'

                  return [
                    String(j.id),
                    statusBadge,
                    String(p.target_tg_group_id ?? '—'),
                    String(userCount),
                    <span style={{ fontSize: 12 }}>{resultSummary}</span>,
                    j.created_at ? timeAgo(j.created_at) : '—',
                  ]
                })}
              />
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  )
}
