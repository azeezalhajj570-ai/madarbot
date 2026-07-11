import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, EmptyState, Table } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import { fetchAdminOverview } from '../../lib/api'
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

export default function AdminAgentsPage() {
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
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const agents = data?.agents || []
  const activeCount = agents.filter(a => a.status === 'active').length
  const failedCount = agents.filter(a => a.status === 'failed').length
  const totalSent = agents.reduce((s, a) => s + a.total_sent, 0)
  const totalContacts = agents.reduce((s, a) => s + a.unique_contacts, 0)

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.agents" descriptionKey="page.admin.agents.desc" loading={loading}>
      {error && (
        <Card style={{ background: 'var(--ui-danger-soft, #fef2f2)', border: '1px solid var(--ui-danger, #ef4444)' }}>
          <div style={{ fontSize: 14, color: 'var(--ui-danger, #ef4444)' }}>Error: {error}</div>
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Active</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#22c55e' }}>{activeCount}</div>
          </div>
          {failedCount > 0 && (
            <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Failed</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{failedCount}</div>
            </div>
          )}
          <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Total Sent</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{totalSent}</div>
          </div>
          <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Contacts</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{totalContacts}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>{lastRefresh.toLocaleTimeString()}</span>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      <Card title="Linked Agents">
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
    </PageShell>
  )
}
