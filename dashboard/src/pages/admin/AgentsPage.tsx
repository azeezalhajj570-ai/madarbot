import { useEffect, useState, useCallback } from 'react'
import { Badge, Card, EmptyState } from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { useI18n } from '../../lib/i18n'
import { fetchAdminOverview } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminAgent } from '../../lib/types'

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

export default function AdminAgentsPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
      </PageShell>
    )
  }

  const [agents, setAgents] = useState<AdminAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const overview = await fetchAdminOverview()
      setAgents(overview.agents || [])
      setError(null)
    } catch (err: any) {
      setError(err?.message || t('common.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const activeCount = agents.filter(a => a.status === 'active').length
  const totalSent = agents.reduce((s, a) => s + a.total_sent, 0)

  return (
    <PageShell titleKey="page.admin.agents" descriptionKey="page.admin.agents.desc" loading={false}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card style={{ padding: '12px 18px', display: 'grid', gap: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('common.active')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ui-success)' }}>{activeCount}</div>
        </Card>
        <Card style={{ padding: '12px 18px', display: 'grid', gap: 2 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('agent.totalSent')}</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{totalSent}</div>
        </Card>
      </div>

      <DataTable<AdminAgent>
        data={agents}
        total={agents.length}
        loading={loading}
        error={error}
        columns={[
          { key: 'phone', label: t('agent.phone'), render: (a) => <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{a.phone}</span> },
          { key: 'status', label: t('agent.status'), render: (a) => <Badge tone={a.status === 'active' ? 'success' : 'destructive'}>{a.status}</Badge> },
          { key: 'sent', label: t('agent.sent'), hideOnMobile: true, render: (a) => String(a.total_sent) },
          { key: 'contacts', label: t('agent.contacts'), hideOnMobile: true, render: (a) => String(a.unique_contacts) },
          { key: 'jobs', label: t('agent.jobs'), hideOnMobile: true, render: (a) => String(a.jobs_count) },
          { key: 'lastActivity', label: t('agent.lastActivity'), render: (a) => timeAgo(a.last_job_at) },
        ]}
        keyExtractor={(a) => a.id}
        searchPlaceholder={t('agent.searchPlaceholder')}
      />
    </PageShell>
  )
}
