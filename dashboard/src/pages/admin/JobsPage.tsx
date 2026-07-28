import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { useI18n } from '../../lib/i18n'
import { fetchAdminOverview } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview, AdminJob } from '../../lib/types'

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

      <ContentGrid columns="repeat(auto-fit, minmax(320px, 1fr))">
        <Card title={t('job.recentJobs')}>
          <DataTable<AdminJob>
            columns={[
              { key: 'id', label: t('job.id'), render: (job) => (
                <span style={{ fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></span>
              )},
              { key: 'agent', label: t('job.agent'), render: (job) => `#${job.agent_id}` },
              { key: 'created', label: t('job.when'), render: (job) => (
                <span style={{ color: 'var(--ui-text-subtle)' }}>{timeAgo(job.created_at)}</span>
              )},
              { key: 'status', label: t('job.status'), render: (job) => (
                <Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' || job.status === 'aborted' ? 'destructive' : job.status === 'running' ? 'info' : 'neutral'}>
                  {job.status}
                </Badge>
              )},
            ]}
            data={recentJobs}
            total={recentJobs.length}
            keyExtractor={(job) => job.job_id}
            pageSize={recentJobs.length}
            pageSizeOptions={[5, 10, 20]}
            searchPlaceholder=""
          />
        </Card>

        <Card title={t('job.recentFailures')}>
          <DataTable<AdminJob>
            columns={[
              { key: 'id', label: t('job.id'), render: (job) => (
                <span style={{ fontWeight: 700 }}>#{job.job_id} <span style={{ fontWeight: 400, color: 'var(--ui-text-muted)' }}>{job.job_type}</span></span>
              )},
              { key: 'agent', label: t('job.agent'), render: (job) => `#${job.agent_id}` },
              { key: 'created', label: t('job.when'), render: (job) => (
                <span style={{ color: 'var(--ui-text-subtle)' }}>{timeAgo(job.created_at)}</span>
              )},
              { key: 'status', label: t('job.status'), render: () => (
                <Badge tone="destructive">{t('common.failed')}</Badge>
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
