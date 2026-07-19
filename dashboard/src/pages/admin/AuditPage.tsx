import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'

import { Badge, Button, Card, EmptyState, LoadingState } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import { fetchOwnerAuditLog } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'

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

export default function AdminAuditPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell eyebrow="Admin" titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }
  const [page, setPage] = useState(0)
  const limit = 50

  const { data: entries, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => fetchOwnerAuditLog(limit, page * limit),
  })

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.audit" descriptionKey="page.admin.audit.desc" loading={false}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--ui-text-muted, #71717a)' }}>
          Showing {page * limit + 1}–{(page + 1) * limit}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Prev</Button>
          <Button variant="outline" size="sm" disabled={!entries || entries.length < limit} onClick={() => setPage(p => p + 1)}>Next</Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      <Card title="Audit Log">
        {isLoading ? (
          <LoadingState />
        ) : entries && entries.length > 0 ? (
          <div style={{ display: 'grid', gap: 0 }}>
            {entries.map((entry: any, i: number) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--ui-border, #e4e4e7)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {entry.action}
                    {entry.target_type && (
                      <span style={{ fontWeight: 400, color: 'var(--ui-text-muted, #71717a)' }}>
                        {' → '}{entry.target_type}#{entry.target_id}
                      </span>
                    )}
                  </div>
                  {entry.detail && (
                    <div style={{ fontSize: 12, color: 'var(--ui-text-subtle, #a1a1aa)', maxWidth: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                      {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)', whiteSpace: 'nowrap', marginLeft: 16 }}>
                  {timeAgo(entry.created_at)}
                </span>
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
