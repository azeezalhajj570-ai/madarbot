import { useEffect, useState, useCallback } from 'react'
import { uiVars } from '../../../../shared/ui-system/tokens'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
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

function StatusDot({ status }: { status: string }) {
  const color = status === 'ok' ? 'var(--ui-success)' : status === 'degraded' ? 'var(--ui-warning)' : status === 'down' ? 'var(--ui-danger)' : 'var(--ui-text-muted)'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 }} />
}

function HealthBadge({ status }: { status: string }) {
  const tone = status === 'ok' ? 'success' : status === 'degraded' ? 'warning' : 'destructive'
  return <Badge tone={tone}>{status.toUpperCase()}</Badge>
}

export default function AdminHealthPage() {
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

  const sh = data?.system_health
  const checks = [
    { label: 'Database', check: sh?.database },
    { label: 'Redis', check: sh?.redis },
    { label: 'Bot Worker', check: sh?.bot_worker },
    { label: 'Agent Worker', check: sh?.agent_worker },
    { label: 'Queue', check: sh?.queue },
  ]
  const okCount = checks.filter(c => c.check?.status === 'ok').length

  return (
    <PageShell titleKey="page.admin.health" descriptionKey="page.admin.health.desc" loading={loading}>
      {error && (
        <Card style={{ background: uiVars.dangerSoft, border: `1px solid ${uiVars.danger}` }}>
          <div style={{ fontSize: 14, color: uiVars.danger }}>Error: {error}</div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 800 }}>System Status</span>
            {sh && <HealthBadge status={sh.status} />}
            <span style={{ fontSize: 12, color: uiVars.textMuted }}>{okCount}/{checks.length} healthy</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: uiVars.textMuted }}>
              {lastRefresh.toLocaleTimeString()}
            </span>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw size={14} style={{ marginRight: 4 }} /> Refresh
            </Button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {checks.map(({ label, check }) => (
            <div key={label} style={{ padding: '14px 16px', borderRadius: 8, background: uiVars.surfaceAlt, border: `1px solid ${uiVars.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: uiVars.textMuted, marginBottom: 6 }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusDot status={check?.status || 'unknown'} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{check?.status || 'unknown'}</span>
              </div>
              {check?.latency_ms !== undefined && (
                <div style={{ fontSize: 12, color: uiVars.textSubtle, marginTop: 4 }}>{check.latency_ms}ms latency</div>
              )}
              {check?.pending !== undefined && (
                <div style={{ fontSize: 12, color: uiVars.textSubtle, marginTop: 4 }}>
                  {check.pending} pending · {check.running} running{check.stuck ? ` · ${check.stuck} stuck` : ''}
                </div>
              )}
              {check?.last_seen && (
                <div style={{ fontSize: 12, color: uiVars.textSubtle, marginTop: 4 }}>Last seen {timeAgo(check.last_seen)}</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard label="Agents" value={String(data?.agents?.length || 0)} hint={`${data?.agents?.filter(a => a.status === 'active').length || 0} active`} />
        <MetricCard label="Total Jobs" value={String(data?.jobs_summary?.total || 0)} hint={`${data?.jobs_summary?.by_status?.completed || 0} completed`} />
        <MetricCard label="Total Sent" value={String(data?.agents?.reduce((s, a) => s + a.total_sent, 0) || 0)} hint="messages sent" />
      </ContentGrid>
    </PageShell>
  )
}
