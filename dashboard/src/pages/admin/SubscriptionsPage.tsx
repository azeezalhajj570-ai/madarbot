import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock } from 'lucide-react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table, LoadingState, Select } from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import { fetchOwnerSubscriptions, updateOwnerSubscription, fetchOwnerStats } from '../../lib/api'

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

  const subRows = (subs || []).map((sub: any) => [
    <div>
      <div style={{ fontWeight: 700 }}>{sub.full_name || 'Telegram User'}</div>
      <div style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>@{sub.username || 'no_username'} · {sub.tg_user_id}</div>
    </div>,
    <div style={{ maxWidth: 240, fontSize: 13, color: 'var(--ui-text-muted, #71717a)', fontStyle: sub.message ? 'normal' : 'italic' }}>
      {sub.message || 'No message provided'}
    </div>,
    <Badge tone={
      sub.status === 'approved' ? 'success' :
      sub.status === 'pending' ? 'warning' :
      sub.status === 'declined' ? 'destructive' : 'neutral'
    }>
      {sub.status}
    </Badge>,
    <div style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>
      {new Date(sub.created_at).toLocaleDateString()}
    </div>,
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {sub.status === 'pending' ? (
        <>
          <div style={{ width: 100 }}>
            <Select
              uiSize="sm"
              value={approvalPlans[sub.id] || 'pro'}
              onChange={(e) => setApprovalPlans({ ...approvalPlans, [sub.id]: e.target.value as any })}
            >
              <option value="pro">Pro</option>
              <option value="business">Business</option>
            </Select>
          </div>
          <Button
            size="sm"
            variant="default"
            onClick={() => subMutation.mutate({
              id: sub.id,
              action: 'approve',
              plan: approvalPlans[sub.id] || 'pro',
            })}
            disabled={subMutation.isPending}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => subMutation.mutate({ id: sub.id, action: 'decline' })}
            disabled={subMutation.isPending}
          >
            Decline
          </Button>
        </>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--ui-text-muted, #71717a)' }}>
          {sub.status === 'approved' ? `Approved as ${sub.plan || 'pro'}` : 'No actions'}
        </span>
      )}
    </div>,
  ])

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.subscriptions" descriptionKey="page.admin.subscriptions.desc" loading={false}>
      <ContentGrid columns="repeat(auto-fit, minmax(200px, 1fr))">
        <MetricCard label="Active Subs" value={String(stats?.active_subscriptions ?? approvedCount)} hint="Approved accounts" icon={<CheckCircle2 size={20} />} />
        <MetricCard label="Pending Requests" value={String(stats?.pending_requests ?? pendingCount)} hint="Awaiting review" icon={<Clock size={20} />} />
      </ContentGrid>

      <Card title="Subscription Requests" subtitle="Users requesting access to premium features.">
        {isLoading ? (
          <LoadingState />
        ) : subRows.length > 0 ? (
          <Table
            columns={['Requester', 'Message', 'Status', 'Requested', 'Actions']}
            rows={subRows}
          />
        ) : (
          <EmptyState title="No requests" subtitle="Manual subscription requests will appear here." />
        )}
      </Card>
    </PageShell>
  )
}
