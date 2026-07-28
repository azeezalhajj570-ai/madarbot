import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import { fetchAdminOverview } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview } from '../../lib/types'

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

export default function AdminJobsPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }
  const [data, setData] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

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
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  const js = data?.jobs_summary
  const recentJobs = data?.recent_jobs || []
  const recentFailures = data?.recent_failures || []
  const totalSent = data?.agents?.reduce((s, a) => s + a.total_sent, 0) || 0
  const totalContacts = data?.agents?.reduce((s, a) => s + a.unique_contacts, 0) || 0

  return (
    <PageShell titleKey="page.admin.jobs" descriptionKey="page.admin.jobs.desc" loading={loading}>
      {error && (
        <Card style={{ background: 'var(--ui-danger-soft, #fef2f2)', border: '1px solid var(--ui-danger, #ef4444)' }}>
          <div style={{ fontSize: 14, color: 'var(--ui-danger, #ef4444)' }}>Error: {error}</div>
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{lastRefresh.toLocaleTimeString()}</span>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
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

      <ContentGrid columns="repeat(auto-fit, minmax(320px, 1fr))">
        <Card title="Recent Jobs">
          {recentJobs.length > 0 ? (
            <div style={{ display: 'grid', gap: 0 }}>
              {recentJobs.map((job, i) => (
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
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
                <div key={job.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle)' }}>agent #{job.agent_id} · {timeAgo(job.created_at)}</div>
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
    </PageShell>
  )
}
