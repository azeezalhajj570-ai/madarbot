import { useEffect, useState, useRef } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, ContentGrid, MetricCard } from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { useI18n } from '../../lib/i18n'
import { fetchRecentAgentJobs } from '../../lib/api'

interface JobSummary {
  job_id: number
  agent_id: number
  agent_phone?: string
  job_type: string
  status: string
  job_payload?: Record<string, any>
  tg_group_id?: number | null
  progress?: { total_fetched?: number; total_errors?: number; batches_completed?: number; limit?: number }
  retry_count?: number
  created_at?: string
  updated_at?: string
}

export default function AdminJobsPage() {
  const { t } = useI18n()
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [scrapeJobs, setScrapeJobs] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const scrapePollRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      if (scrapePollRef.current) return
      scrapePollRef.current = true
      try {
        const jobs = await fetchRecentAgentJobs(undefined, 50)
        if (!cancelled) {
          setScrapeJobs(jobs as JobSummary[])
          setLastRefresh(new Date())
        }
      } catch { /* ignore */ } finally {
        scrapePollRef.current = false
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) setTimeout(poll, 5000)
    }
    poll()
    return () => { cancelled = true }
  }, [])

  const byStatus = scrapeJobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1
    return acc
  }, {})
  const totalJobs = scrapeJobs.length
  const failedCount = (byStatus.failed || 0) + (byStatus.aborted || 0)
  const runningCount = (byStatus.running || 0) + (byStatus.pending || 0) + (byStatus.queued || 0)
  const completedCount = byStatus.completed || 0

  return (
    <PageShell titleKey="page.admin.jobs" descriptionKey="page.admin.jobs.desc" loading={false}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{lastRefresh.toLocaleTimeString()}</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> {t('common.refresh')}
          </Button>
        </div>
      </div>

      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard label={t('job.totalJobs')} value={String(totalJobs)} hint={Object.keys(byStatus).length === 0 ? '—' : `${Object.keys(byStatus).length} ${t('job.statuses')}`} />
        <MetricCard label={t('common.completed')} value={String(completedCount)} hint={totalJobs > 0 ? `${((completedCount / totalJobs) * 100).toFixed(0)}%` : '—'} />
        <MetricCard label={t('common.failed')} value={String(failedCount)} hint={totalJobs > 0 ? `${((failedCount / totalJobs) * 100).toFixed(1)}%` : '—'} />
        <MetricCard label={t('common.running')} value={String(runningCount)} hint={`${completedCount} ${t('common.completed')}`} />
      </ContentGrid>

      <Card title={t('job.recentJobs')}>
        {loading ? <CardSkeleton /> : (
          <DataTable<JobSummary>
            columns={[
              {
                key: 'job_id', label: t('job.id'),
                render: (job) => <span style={{ fontWeight: 700 }}>#{job.job_id}</span>,
              },
              {
                key: 'agent', label: t('job.agent'),
                render: (job) => <span style={{ fontSize: 13 }}>{job.agent_phone ?? `#${job.agent_id}`}</span>,
              },
              {
                key: 'group', label: t('job.group'),
                render: (job) => (
                  <span style={{ fontSize: 13 }}>
                    {job.tg_group_id ? `tg:${job.tg_group_id}` : '-'}
                  </span>
                ),
              },
              {
                key: 'job_type', label: t('job.type'),
                hideOnMobile: true,
                render: (job) => (
                  <span style={{ color: 'var(--ui-text-muted)', fontSize: 13 }}>
                    {(job.job_type || '').replace('scraper_', '').replace('_', ' ')}
                  </span>
                ),
              },
              {
                key: 'retries', label: t('job.retries'),
                render: (job) => job.retry_count ? (
                  <span style={{ color: 'var(--ui-danger)', fontWeight: 700, fontSize: 13 }}>{job.retry_count}</span>
                ) : <span style={{ color: 'var(--ui-text-muted)', fontSize: 13 }}>0</span>,
              },
              {
                key: 'status', label: t('job.status'),
                render: (job) => (
                  <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'destructive' : job.status === 'running' ? 'info' : 'neutral'}>
                    {job.status}
                  </Badge>
                ),
              },
              {
                key: 'progress', label: t('job.progress'),
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
                key: 'created_at', label: t('job.when'),
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
            searchPlaceholder={t('common.search')}
            filters={[
              { key: 'status', label: t('job.status'), options: [
                { value: '', label: t('common.all') },
                { value: 'running', label: t('common.running') },
                { value: 'pending', label: t('common.pending') },
                { value: 'queued', label: t('common.queued') },
                { value: 'completed', label: t('common.completed') },
                { value: 'failed', label: t('common.failed') },
              ]},
            ]}
            pageSize={10}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        )}
      </Card>
    </PageShell>
  )
}
