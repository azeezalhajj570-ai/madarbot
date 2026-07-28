import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock } from 'lucide-react'

import { Badge, Button, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import { fetchOwnerSubscriptions, updateOwnerSubscription, fetchOwnerStats } from '../../lib/api'
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

export default function AdminSubscriptionsPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }
  const queryClient = useQueryClient()
  const [approvalPlans, setApprovalPlans] = useState<Record<number, 'pro' | 'business'>>({})

  const { data: stats } = useQuery({
    queryKey: ['owner', 'stats'],
    queryFn: fetchOwnerStats,
  })

  const { data: subs, isLoading } = useQuery({
    queryKey: ['owner', 'subscriptions'],
    queryFn: fetchOwnerSubscriptions,
  })

  const subMutation = useMutation({
    mutationFn: ({ id, action, plan }: { id: number; action: 'approve' | 'decline'; plan?: 'pro' | 'business' }) =>
      updateOwnerSubscription(id, action, plan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['owner', 'stats'] })
    },
  })

  const pendingCount = subs?.filter(s => s.status === 'pending').length || 0
  const approvedCount = subs?.filter(s => s.status === 'approved').length || 0

  return (
    <PageShell titleKey="page.admin.subscriptions" descriptionKey="page.admin.subscriptions.desc" loading={false}>
      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard label="Active Subs" value={String(stats?.active_subscriptions ?? approvedCount)} hint="Approved accounts" icon={<CheckCircle2 size={20} />} />
        <MetricCard label="Pending Requests" value={String(stats?.pending_requests ?? pendingCount)} hint="Awaiting review" icon={<Clock size={20} />} />
      </ContentGrid>

      <DataTable
        data={subs || []}
        total={(subs || []).length}
        loading={isLoading}
        title="Subscription Requests"
        subtitle="Users requesting access to premium features."
        searchPlaceholder="Search by name or username..."
        filters={[
          { key: 'status', label: 'Status', options: [
            { value: '', label: 'All statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
            { value: 'declined', label: 'Declined' },
          ]},
        ]}
        columns={[
          { key: 'requester', label: 'Requester', render: (sub: any) => (
            <div>
              <div style={{ fontWeight: 700 }}>{sub.full_name || 'Telegram User'}</div>
              <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{sub.username || 'no_username'} · {sub.tg_user_id}</div>
            </div>
          )},
          { key: 'message', label: 'Message', hideOnMobile: true, render: (sub: any) => (
            <div style={{ maxWidth: 240, fontSize: 13, color: 'var(--ui-text-muted)', fontStyle: sub.message ? 'normal' : 'italic' }}>
              {sub.message || 'No message provided'}
            </div>
          )},
          { key: 'status', label: 'Status', render: (sub: any) => (
            <Badge tone={sub.status === 'approved' ? 'success' : sub.status === 'pending' ? 'warning' : sub.status === 'declined' ? 'destructive' : 'neutral'}>
              {sub.status}
            </Badge>
          )},
          { key: 'requested', label: 'Requested', hideOnMobile: true, render: (sub: any) => (
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
              {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : '—'}
            </div>
          )},
          { key: 'actions', label: 'Actions', render: (sub: any) => (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {sub.status === 'pending' ? (
                <>
                  <div style={{ width: 100 }}>
                    <select
                      value={approvalPlans[sub.id] || 'pro'}
                      onChange={(e) => setApprovalPlans({ ...approvalPlans, [sub.id]: e.target.value as 'pro' | 'business' })}
                      style={{ width: '100%', minHeight: 32, borderRadius: 8, border: '1px solid var(--ui-border)', padding: '0 8px', fontSize: 13, background: 'var(--ui-surface-strong)', color: 'var(--ui-text)' }}
                    >
                      <option value="pro">Pro</option>
                      <option value="business">Business</option>
                    </select>
                  </div>
                  <Button size="sm" variant="default"
                    onClick={() => subMutation.mutate({ id: sub.id, action: 'approve', plan: approvalPlans[sub.id] || 'pro' })}
                    disabled={subMutation.isPending}
                  >
                    Approve
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => subMutation.mutate({ id: sub.id, action: 'decline' })}
                    disabled={subMutation.isPending}
                  >
                    Decline
                  </Button>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                  {sub.status === 'approved' ? `Approved as ${sub.plan || 'pro'}` : 'No actions'}
                </span>
              )}
            </div>
          )},
        ]}
        keyExtractor={(sub: any) => sub.id}
      />
    </PageShell>
  )
}
