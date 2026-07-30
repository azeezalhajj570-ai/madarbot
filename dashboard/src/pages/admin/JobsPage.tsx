import { useEffect, useState, useCallback, useRef } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { useI18n } from '../../lib/i18n'
import { fetchAdminOverview, fetchRecentAgentJobs, fetchRecentScrapeJobs } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview } from '../../lib/types'
import type { ScrapeJobSummary } from '../../lib/api'

export default function AdminJobsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
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
      toast.error(err?.message || t('common.failedToLoad'))
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
        if (cancelled) return
        const overview = await fetchAdminOverview()
        if (cancelled) return
        const [knowledgeJobs] = await Promise.all([
          fetchRecentAgentJobs('knowledge_extraction', 20).catch(() => []),
        ])
        const seen = new Set(jobs.map(j => j.job_id))
        const extra: ScrapeJobSummary[] = [...knowledgeJobs, ...(overview.recent_jobs || [])]
          .filter(j => !seen.has(j.job_id))
          .map(j => ({
            job_id: j.job_id,
            agent_id: j.agent_id,
            agent_phone: undefined,
            job_type: j.job_type,
            status: j.status,
            tg_group_id: undefined,
            group_title: undefined,
            member_count: undefined,
            progress: undefined,
            retry_count: 0,
            created_at: j.created_at ?? undefined,
            updated_at: undefined,
          }))
        setScrapeJobs([...jobs, ...extra])
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
            <RefreshCw size={14} /> {t('common.refresh')}
          </Button>
        </div>
      </div>

      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard label={t('job.totalJobs')} value={String(js?.total || 0)} hint={`${Object.keys(js?.by_status || {}).length} ${t('job.statuses')}`} />
        <MetricCard label={t('agent.totalSent')} value={String(totalSent)} hint={`${totalContacts} ${t('job.uniqueContacts')}`} />
        <MetricCard
          label={t('common.failed')}
          value={String((js?.by_status?.failed || 0) + (js?.by_status?.aborted || 0))}
          hint={js?.total ? `${(((js.by_status.failed || 0) + (js.by_status.aborted || 0)) / js.total * 100).toFixed(1)}${t('job.failureRate')}` : '—'}
        />
        <MetricCard
          label={t('common.running')}
          value={String((js?.by_status?.running || 0) + (js?.by_status?.pending || 0))}
          hint={`${js?.by_status?.completed || 0} ${t('common.completed')}`}
        />
      </ContentGrid>

      <Card title={t('job.recentJobs')}>
        <DataTable<ScrapeJobSummary>
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
                  {job.group_title || (job.tg_group_id ? `tg:${job.tg_group_id}` : '-')}
                  {job.member_count != null ? <span style={{ color: 'var(--ui-text-muted)', fontSize: 11, marginInlineStart: 6 }}>({job.member_count} members)</span> : null}
                </span>
              ),
            },
            {
              key: 'job_type', label: t('job.type'),
              hideOnMobile: true,
              render: (job) => (
                <span style={{ color: 'var(--ui-text-muted)', fontSize: 13 }}>
                  {job.job_type.replace('scraper_', '').replace('_', ' ')}
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
      </Card>
      </>)}
    </PageShell>
  )
}
