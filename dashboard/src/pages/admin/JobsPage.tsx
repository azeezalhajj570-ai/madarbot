import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { fetchAdminOverview, fetchRecentScrapeJobs } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview, AdminJob, ScrapeJobSummary } from '../../lib/api'

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
  const { toast } = useToast()
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
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const refresh = useCallback(async () => {
    try {
      const overview = await fetchAdminOverview()
      setData(overview)
      setLastRefresh(new Date())
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [refresh])

  const [scrapeJobs, setScrapeJobs] = useState<ScrapeJobSummary[]>([])
  const scrapePollRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    async function poll() {
      if (scrapePollRef.current) return
      scrapePollRef.current = true
      try {
        const jobs = await fetchRecentScrapeJobs(50)
        if (!cancelled) setScrapeJobs(jobs)
      } catch { /* ignore */ } finally {
        scrapePollRef.current = false
      }
      if (!cancelled) setTimeout(poll, 5000)
    }
    poll()
    return () => { cancelled = true }
  }, [])

  const js = data?.jobs_summary
  const recentJobs = data?.recent_jobs || []
  const recentFailures = data?.recent_failures || []
  const totalSent = data?.agents?.reduce((s, a) => s + a.total_sent, 0) || 0
  const totalContacts = data?.agents?.reduce((s, a) => s + a.unique_contacts, 0) || 0

  return (
    <PageShell titleKey="page.admin.jobs" descriptionKey="page.admin.jobs.desc" loading={false}>
      {loading ? (
        <CardSkeleton />
      ) : (<>
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
          <DataTable<ScrapeJobSummary>
            columns={[
              {
                key: 'job_id', label: 'ID',
                render: (job) => <span style={{ fontWeight: 700 }}>#{job.job_id}</span>,
              },
              {
                key: 'agent', label: 'Agent',
                render: (job) => <span style={{ fontSize: 13 }}>{job.agent_phone ?? `#${job.agent_id}`}</span>,
              },
              {
                key: 'group', label: 'Group',
                render: (job) => (
                  <span style={{ fontSize: 13 }}>
                    {job.group_title || (job.tg_group_id ? `tg:${job.tg_group_id}` : '-')}
                    {job.member_count != null ? <span style={{ color: 'var(--ui-text-muted)', fontSize: 11, marginLeft: 6 }}>({job.member_count} members)</span> : null}
                  </span>
                ),
              },
              {
                key: 'job_type', label: 'Type',
                hideOnMobile: true,
                render: (job) => (
                  <span style={{ color: 'var(--ui-text-muted)', fontSize: 13 }}>
                    {job.job_type.replace('scraper_', '').replace('_', ' ')}
                  </span>
                ),
              },
              {
                key: 'retries', label: 'Retries',
                render: (job) => job.retry_count ? (
                  <span style={{ color: 'var(--ui-danger)', fontWeight: 700, fontSize: 13 }}>{job.retry_count}</span>
                ) : <span style={{ color: 'var(--ui-text-muted)', fontSize: 13 }}>0</span>,
              },
              {
                key: 'status', label: 'Status',
                render: (job) => (
                  <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'destructive' : job.status === 'running' ? 'info' : 'neutral'}>
                    {job.status}
                  </Badge>
                ),
              },
              {
                key: 'progress', label: 'Progress',
                render: (job) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', minWidth: 140 }}>
                    <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                      {job.progress ? `${job.progress.total_fetched ?? 0} / ${job.progress.limit ?? '?'}` : '-'}
                    </span>
                    {job.status === 'running' && job.progress && job.progress.limit ? (
                      <div style={{ width: '100%', height: 6, background: 'var(--ui-bg-muted)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, Math.round(((job.progress.total_fetched ?? 0) / job.progress.limit) * 100))}%`,
                          height: '100%',
                          background: 'var(--ui-accent)',
                          borderRadius: 3,
                          transition: 'width 1s ease',
                        }} />
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'created_at', label: 'When',
                hideOnMobile: true,
                render: (job) => (
                  <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                    {job.created_at ? new Date(job.created_at).toLocaleString() : '-'}
                  </span>
                ),
              },
            ]}
            data={scrapeJobs}
            total={scrapeJobs.length}
            keyExtractor={(job) => job.job_id}
            searchPlaceholder="Search jobs..."
            filters={[
              { key: 'status', label: 'Status', options: [
                { value: '', label: 'All' },
                { value: 'running', label: 'Running' },
                { value: 'pending', label: 'Pending' },
                { value: 'queued', label: 'Queued' },
                { value: 'completed', label: 'Completed' },
                { value: 'failed', label: 'Failed' },
              ]},
            ]}
            pageSize={10}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        </Card>

        <Card title="Recent Failures (24h)">
          <DataTable<AdminJob>
            columns={[
              { key: 'id', label: 'ID', render: (job) => (
                <span style={{ fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></span>
              )},
              { key: 'agent', label: 'Agent', render: (job) => `#${job.agent_id}` },
              { key: 'created', label: 'When', render: (job) => (
                <span style={{ color: 'var(--ui-text-subtle)' }}>{timeAgo(job.created_at)}</span>
              )},
              { key: 'status', label: 'Status', render: () => (
                <Badge tone="destructive">Failed</Badge>
              )},
            ]}
            data={recentFailures}
            total={recentFailures.length}
            keyExtractor={(job) => job.job_id}
            pageSize={recentFailures.length}
            pageSizeOptions={[5, 10, 20]}
            searchPlaceholder=""
          />
        </Card>
      </ContentGrid>
      </>)}
    </PageShell>
  )
}
