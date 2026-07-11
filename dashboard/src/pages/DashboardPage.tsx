import { useEffect, useState, useCallback } from 'react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import * as api from '../lib/api'
import type { AdminOverview, OwnerSubscriptionRequest, PromotionCode } from '../lib/types'

const REFRESH_INTERVAL = 30_000

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' ? '#22c55e' : status === 'degraded' ? '#f59e0b' : status === 'down' ? '#ef4444' : '#6b7280'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 }} />
}

function HealthBadge({ status }: { status: string }) {
  const tone = status === 'ok' ? 'success' : status === 'degraded' ? 'warning' : 'destructive'
  return <Badge tone={tone}>{status.toUpperCase()}</Badge>
}

export default function DashboardPage() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [subs, setSubs] = useState<OwnerSubscriptionRequest[]>([])
  const [promos, setPromos] = useState<PromotionCode[]>([])
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    try {
      const [overview, subsData, promosData, auditData] = await Promise.all([
        api.fetchAdminOverview(),
        api.fetchOwnerSubscriptions().catch(() => []),
        api.fetchOwnerPromoCodes().catch(() => []),
        api.fetchOwnerAuditLog(20, 0).catch(() => []),
      ])
      setData(overview)
      setSubs(subsData)
      setPromos(promosData)
      setAuditLog(auditData)
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
    const id = setInterval(refresh, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  const sh = data?.system_health
  const q = sh?.queue
  const js = data?.jobs_summary
  const agents = data?.agents || []
  const recentJobs = data?.recent_jobs || []
  const recentFailures = data?.recent_failures || []

  const activeCount = agents.filter(a => a.status === 'active').length
  const failedCount = agents.filter(a => a.status === 'failed').length
  const totalSent = agents.reduce((s, a) => s + a.total_sent, 0)
  const totalContacts = agents.reduce((s, a) => s + a.unique_contacts, 0)

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin" descriptionKey="page.admin.desc" loading={loading}>
      {error && (
        <Card style={{ background: 'var(--ui-danger-soft, #fef2f2)', border: '1px solid var(--ui-danger, #ef4444)' }}>
          <div style={{ fontSize: 14, color: 'var(--ui-danger, #ef4444)' }}>Error: {error}</div>
        </Card>
      )}

      {/* Section 1: System Health */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>System Status</span>
            {sh && <HealthBadge status={sh.status} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>
              {lastRefresh.toLocaleTimeString()}
            </span>
            <Button variant="outline" size="sm" onClick={refresh}>Refresh</Button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[
            { label: 'Database', check: sh?.database },
            { label: 'Redis', check: sh?.redis },
            { label: 'Bot Worker', check: sh?.bot_worker },
            { label: 'Agent Worker', check: sh?.agent_worker },
            { label: 'Queue', check: sh?.queue },
          ].map(({ label, check }) => (
            <div key={label} style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)', marginBottom: 4 }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusDot status={check?.status || 'unknown'} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{check?.status || 'unknown'}</span>
              </div>
              {check?.latency_ms !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle, #a1a1aa)', marginTop: 2 }}>{check.latency_ms}ms</div>
              )}
              {check?.pending !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle, #a1a1aa)', marginTop: 2 }}>
                  {check.pending} pending, {check.running} running{check.stuck ? `, ${check.stuck} stuck` : ''}
                </div>
              )}
              {check?.last_seen && (
                <div style={{ fontSize: 11, color: 'var(--ui-text-subtle, #a1a1aa)', marginTop: 2 }}>seen {timeAgo(check.last_seen)}</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Section 2: Agents */}
      <Card title={`Agents (${activeCount} active${failedCount ? `, ${failedCount} failed` : ''})`}>
        {agents.length > 0 ? (
          <Table
            columns={['Phone', 'Status', 'Sent', 'Contacts', 'Jobs', 'Last Activity']}
            rows={agents.map(a => [
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{a.phone}</span>,
              <Badge tone={a.status === 'active' ? 'success' : 'destructive'}>{a.status}</Badge>,
              String(a.total_sent),
              String(a.unique_contacts),
              String(a.jobs_count),
              timeAgo(a.last_job_at),
            ])}
          />
        ) : (
          <EmptyState title="No agents" subtitle="No linked Telegram accounts found." />
        )}
      </Card>

      {/* Section 3: Jobs Overview */}
      <ContentGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
        <MetricCard label="Total Jobs" value={String(js?.total || 0)} hint={`${Object.keys(js?.by_status || {}).length} statuses`} />
        <MetricCard label="Total Sent" value={String(totalSent)} hint={`${totalContacts} unique contacts`} />
        <MetricCard
          label="Failed"
          value={String((js?.by_status?.failed || 0) + (js?.by_status?.aborted || 0))}
          hint={js?.total ? `${(((js.by_status.failed || 0) + (js.by_status.aborted || 0)) / js.total * 100).toFixed(1)}% failure rate` : '—'}
        />
        <MetricCard
          label="Running"
          value={String((js?.by_status?.running || 0) + (js?.by_status?.pending || 0))}
          hint={`${js?.by_status?.completed || 0} completed`}
        />
      </ContentGrid>

      {/* Section 4: Recent Jobs & Failures */}
      <ContentGrid columns="repeat(auto-fit, minmax(320px, 1fr))">
        <Card title="Recent Jobs">
          {recentJobs.length > 0 ? (
            <div style={{ display: 'grid', gap: 0 }}>
              {recentJobs.map((job, i) => (
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border, #e4e4e7)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted, #71717a)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle, #a1a1aa)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
                  </div>
                  <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' || job.status === 'aborted' ? 'destructive' : job.status === 'running' ? 'info' : 'neutral'}>
                    {job.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No recent jobs" subtitle="No jobs found." />
          )}
        </Card>

        <Card title="Recent Failures (24h)">
          {recentFailures.length > 0 ? (
            <div style={{ display: 'grid', gap: 0 }}>
              {recentFailures.map((job, i) => (
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border, #e4e4e7)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted, #71717a)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle, #a1a1aa)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
                  </div>
                  <Badge tone="destructive">{job.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No failures" subtitle="No failed jobs in the last 24 hours." />
          )}
        </Card>
      </ContentGrid>

      {/* Section 5: Subscriptions */}
      <Card title={`Subscriptions (${subs.filter(s => s.status === 'pending').length} pending)`}>
        {subs.length > 0 ? (
          <Table
            columns={['User', 'Message', 'Status', 'Plan', 'Requested']}
            rows={subs.map(s => [
              <div>
                <div style={{ fontWeight: 700 }}>{s.fullName || 'Telegram User'}</div>
                <div style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>@{s.username || 'no_username'} · {s.tgUserId}</div>
              </div>,
              <div style={{ maxWidth: 200, fontSize: 13, color: 'var(--ui-text-muted, #71717a)', fontStyle: s.message ? 'normal' : 'italic' }}>
                {s.message || '—'}
              </div>,
              <Badge tone={s.status === 'approved' ? 'success' : s.status === 'pending' ? 'warning' : 'destructive'}>
                {s.status}
              </Badge>,
              s.plan ? <Badge tone={s.plan === 'business' ? 'success' : 'neutral'}>{s.plan}</Badge> : '—',
              <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>{timeAgo(s.createdAt)}</span>,
            ])}
          />
        ) : (
          <EmptyState title="No subscriptions" subtitle="No subscription requests found." />
        )}
      </Card>

      {/* Section 6: Promo Codes */}
      <Card title={`Promo Codes (${promos.length} total)`}>
        {promos.length > 0 ? (
          <Table
            columns={['Code', 'Plan', 'Duration', 'Usage', 'Active', 'Expires']}
            rows={promos.map(p => [
              <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14 }}>{p.code}</span>,
              <Badge tone={p.plan === 'business' ? 'success' : 'neutral'}>{p.plan}</Badge>,
              <span style={{ fontWeight: 600 }}>{p.duration_days}d</span>,
              <span>{p.used_count} / {p.max_uses || '∞'}</span>,
              <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'yes' : 'no'}</Badge>,
              <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>{p.expiry_date ? new Date(p.expiry_date).toLocaleDateString() : '—'}</span>,
            ])}
          />
        ) : (
          <EmptyState title="No promo codes" subtitle="No promotion codes have been created." />
        )}
      </Card>

      {/* Section 7: Audit Log */}
      <Card title="Audit Log">
        {auditLog.length > 0 ? (
          <div style={{ display: 'grid', gap: 0 }}>
            {auditLog.map((entry: any, i: number) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border, #e4e4e7)' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {entry.action}
                    {entry.target_type && <span style={{ fontWeight: 400, color: 'var(--ui-text-muted, #71717a)' }}> → {entry.target_type}#{entry.target_id}</span>}
                  </div>
                  {entry.detail && (
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle, #a1a1aa)', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)', whiteSpace: 'nowrap' }}>{timeAgo(entry.created_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No audit entries" subtitle="No audit log entries found." />
        )}
      </Card>
    </PageShell>
  )
}
