import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Send } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

import { Badge, Button, Card, ColumnDef, EmptyState, Input, Select, Table } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { GroupAutoComplete, SearchInput } from '../../components/ui/data-display'
import { PageShell } from '../../lib/page-shell'
import api, { fetchAdminOverview, fetchAgents } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import { spacing } from '../../../../shared/ui-system/tokens'
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

function JobsTable({ jobs, selectedAgentId, onJobsUpdate }: {
  jobs: AgentJobRecord[]
  selectedAgentId: number | null
  onJobsUpdate: (jobs: AgentJobRecord[]) => void
}) {
  const { t } = useI18n()
  if (jobs.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--ui-text-muted)', padding: spacing.md }}>
        {t('bulkadd.noJobs')}
      </div>
    )
  }
  return (
    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
      <Table<AgentJobRecord>
        columns={[
          { key: 'id', label: t('bulkadd.id'), hideOnMobile: true, render: (j) => String(j.id) },
          {
            key: 'status', label: t('job.status'), render: (j) => {
              const p = j.job_payload || {}
              const result = p.result as Record<string, number> | undefined
              const progress = p.progress as Record<string, number> | undefined
              const userCount = (p.user_ids as number[])?.length || 0
              const successCount = result?.success_count ?? progress?.success_count ?? 0
              const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
              const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
              const totalProcessed = successCount + failureCount + skipCount
              if (j.status === 'completed') {
                if (totalProcessed === 0) return <Badge tone="warning">{t('common.completed')} (no results)</Badge>
                return <Badge tone="success">{t('common.completed')}</Badge>
              }
              if (j.status === 'running') return <Badge tone="warning">{t('common.running')} ({totalProcessed}/{userCount})</Badge>
              if (j.status === 'failed') return <Badge tone="destructive">{t('common.failed')}</Badge>
              return <Badge tone="default">{j.status}</Badge>
            }
          },
          { key: 'target', label: t('bulkadd.target'), hideOnMobile: true, render: (j) => { const p = j.job_payload || {}; return String(p.target_tg_group_id ?? '—') } },
          { key: 'users', label: t('bulkadd.users'), render: (j) => { const p = j.job_payload || {}; return String((p.user_ids as number[])?.length || 0) } },
          {
            key: 'results', label: t('bulkadd.results'), render: (j) => {
              const p = j.job_payload || {}
              const result = p.result as Record<string, number> | undefined
              const progress = p.progress as Record<string, number> | undefined
              const successCount = result?.success_count ?? progress?.success_count ?? 0
              const failureCount = result?.failure_count ?? progress?.failure_count ?? 0
              const skipCount = result?.skip_count ?? progress?.skip_count ?? 0
              const totalProcessed = successCount + failureCount + skipCount
              const userCount = (p.user_ids as number[])?.length || 0
              const isComplete = j.status === 'completed' && totalProcessed > 0
              const resultSummary = isComplete
                ? `${successCount} ${t('bulkadd.added')} · ${skipCount} ${t('bulkadd.skipped')} · ${failureCount} ${t('common.failed')}`
                : j.status === 'running' ? `${totalProcessed} / ${userCount}` : '—'
              return <span style={{ fontSize: 12 }}>{resultSummary}</span>
            }
          },
          { key: 'created', label: t('bulkadd.created'), hideOnMobile: true, render: (j) => j.created_at ? timeAgo(j.created_at) : '—' },
        ]}
        data={jobs.slice(0, 20)}
        keyExtractor={(j) => j.id}
      />
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

  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
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
      setLastRefresh(new Date())
    } catch (err: any) {
      toast.error(err?.message || t('common.failedToLoad'))
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
      toast.error(err?.message || 'Scrape failed')
    } finally {
      setScraping(false)
    }
  }

  async function refreshJobs() {
    if (!selectedAgentId) return
    const { data } = await api.get<AgentJobRecord[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/jobs`)
    setJobs(data.filter((j) => j.job_type === 'member_add'))
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
      await refreshJobs()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create job')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={loading}>
      <div className="grid-2col" style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        {/* Left: Form */}
        <Card title={t('bulkadd.title')} subtitle={t('bulkadd.desc')}>
          <div style={{ display: 'grid', gap: 14 }}>

            {/* Agent select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--ui-text-muted)' }}>{t('bulkadd.agent')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select
                  value={selectedAgentId ?? ''}
                  onChange={(e) => setSelectedAgentId(e.target.value ? Number(e.target.value) : null)}
                  style={{ flex: 1 }}
                >
                  <option value="">{t('bulkadd.selectAgent')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.external_account_id || `${t('bulkadd.agent')} ${a.id}`} {a.status !== 'active' ? `(${a.status})` : ''}
                    </option>
                  ))}
                </Select>
                <Button variant="outline" size="sm" onClick={async () => {
                  if (!selectedAgentId) return
                  setSyncingGroups(true)
                  try {
                    const { data: freshGroups } = await api.get<AgentGroup[]>(`${AGENTS_API_PREFIX}/${selectedAgentId}/groups`)
                    setSourceGroups(freshGroups)
                    setTargetGroups(freshGroups.filter((g) => g.can_add_members))
                  } catch (err: any) {
                    toast.error(err?.message || t('bulkadd.syncFailed'))
                  } finally {
                    setSyncingGroups(false)
                  }
                }} disabled={!selectedAgentId || syncingGroups}>
                  <RefreshCw size={14} /> {syncingGroups ? t('bulkadd.syncing') : t('bulkadd.sync')}
                </Button>
              </div>
            </div>

            {/* Source group select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--ui-text-muted)' }}>{t('bulkadd.sourceGroup')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <GroupAutoComplete
                    items={sourceGroups}
                    value={selectedSourceGroupId}
                    onChange={setSelectedSourceGroupId}
                    placeholder={sourceGroups.length ? t('bulkadd.selectSource') : t('bulkadd.noGroups')}
                    getId={(g: any) => g.tg_group_id}
                    getLabel={(g: any) => g.title}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={scrapeSourceGroup} disabled={!selectedSourceGroupId || scraping}>
                  {scraping ? t('bulkadd.scraping') : t('bulkadd.scrape')}
                </Button>
              </div>
            </div>

            {/* Target group select */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--ui-text-muted)' }}>{t('bulkadd.targetGroup')}</label>
              <GroupAutoComplete
                items={targetGroups}
                value={selectedTargetGroupId}
                onChange={setSelectedTargetGroupId}
                placeholder={targetGroups.length ? t('bulkadd.selectTarget') : t('bulkadd.noTargetGroups')}
                getId={(g: any) => g.tg_group_id}
                getLabel={(g: any) => g.title}
              />
            </div>

            {/* Member search */}
            {selectedSourceGroupId && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--ui-text-muted)' }}>{t('bulkadd.searchMembers')}</label>
                <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder={t('bulkadd.searchPlaceholder')} style={{ width: '100%' }} />
                <MemberSearchList members={members} searching={searching} selectedUserIds={selectedUserIds} onToggle={toggleUser} />
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', marginTop: 4 }}>{selectedUserIds.length} {t('bulkadd.selected')}</div>
              </div>
            )}

            {/* Interval */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4, color: 'var(--ui-text-muted)' }}>{t('bulkadd.interval')}</label>
              <Input
                type="number"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Math.max(1, Number(e.target.value)))}
                min={1}
              />
            </div>

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

            {/* Submit */}
            <Button
              variant="default"
              onClick={handleSubmit}
              disabled={!selectedAgentId || !selectedTargetGroupId || !selectedUserIds.length || submitting}
            >
              <Send size={14} /> {submitting ? t('common.queuing') : `${t('bulkadd.queueJob')} (${selectedUserIds.length} ${t('bulkadd.users')})`}
            </Button>
          </div>
        </Card>

        {/* Right: Recent Jobs */}
        <Card title={t('bulkadd.recentJobs')} subtitle={t('bulkadd.recentJobsDesc')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Button variant="outline" size="sm" onClick={refreshJobs}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </Button>
          </div>
          <JobsTable jobs={jobs} selectedAgentId={selectedAgentId} onJobsUpdate={setJobs} />
        </Card>
      </div>
    </PageShell>
  )
}
