import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'

import { Button, Card, EmptyState } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import { fetchAdminOverview } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { AdminOverview } from '../../lib/types'

export default function AdminBulkAddPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell eyebrow="Admin" titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
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
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.bulkadd" descriptionKey="page.admin.bulkadd.desc" loading={loading}>
      {error && (
        <Card style={{ background: 'var(--ui-danger-soft, #fef2f2)', border: '1px solid var(--ui-danger, #ef4444)' }}>
          <div style={{ fontSize: 14, color: 'var(--ui-danger, #ef4444)' }}>Error: {error}</div>
        </Card>
      )}

      <Card title="Bulk Add Members" subtitle="Invite multiple users to groups via linked agent accounts.">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--ui-text-muted, #71717a)', lineHeight: 1.6 }}>
            <p>Bulk Add Members lets agents add multiple users from a source group to a target group where the agent is admin.</p>
            <ul style={{ marginTop: 8, paddingLeft: 20 }}>
              <li>Select a source group and search for members</li>
              <li>Pick target group where your agent has invite rights</li>
              <li>Set interval between adds to avoid flood-waits</li>
              <li>Optionally send invite links to privacy-restricted users</li>
            </ul>
          </div>

          <div>
            <a href="/webapp" target="_blank" rel="noopener noreferrer">
              <Button variant="primary">
                <ExternalLink size={14} /> Open Dashboard
              </Button>
            </a>
          </div>

          {data && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Agents</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{data.agents.length}</div>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--ui-surface-alt, #f4f4f5)', border: '1px solid var(--ui-border, #e4e4e7)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ui-text-muted, #71717a)' }}>Total Jobs</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{data.jobs_summary.total}</div>
              </div>
            </div>
          )}

          <div>
            <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>Last refreshed: {lastRefresh.toLocaleTimeString()}</span>
            <Button variant="outline" size="sm" onClick={refresh} style={{ marginLeft: 8 }}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        </div>
      </Card>
    </PageShell>
  )
}
