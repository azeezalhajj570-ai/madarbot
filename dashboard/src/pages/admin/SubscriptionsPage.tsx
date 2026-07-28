import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock } from 'lucide-react'

import { Badge, Button, ContentGrid, EmptyState, MetricCard } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
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
  const { t } = useI18n()
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
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
        <MetricCard label={t('subscription.activeSubs')} value={String(stats?.active_subscriptions ?? approvedCount)} hint={t('subscription.approvedAccounts')} icon={<CheckCircle2 size={20} />} />
        <MetricCard label={t('subscription.pendingRequests')} value={String(stats?.pending_requests ?? pendingCount)} hint={t('subscription.awaitingReview')} icon={<Clock size={20} />} />
      </ContentGrid>

      <DataTable
        data={subs || []}
        total={(subs || []).length}
        loading={isLoading}
        title={t('subscription.title')}
        subtitle={t('subscription.desc')}
        searchPlaceholder={t('subscription.searchPlaceholder')}
        filters={[
          { key: 'status', label: t('subscription.filterStatus'), options: [
            { value: '', label: t('subscription.allStatuses') },
            { value: 'pending', label: t('common.pending') },
            { value: 'approved', label: t('common.approved') },
            { value: 'declined', label: t('common.declined') },
          ]},
        ]}
        columns={[
          { key: 'requester', label: t('subscription.requester'), render: (sub: any) => (
            <div>
              <div style={{ fontWeight: 700 }}>{sub.full_name || t('subscription.telegramUser')}</div>
              <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{sub.username || t('common.none')} · {sub.tg_user_id}</div>
            </div>
          )},
          { key: 'message', label: t('subscription.message'), hideOnMobile: true, render: (sub: any) => (
            <div style={{ maxWidth: 240, fontSize: 13, color: 'var(--ui-text-muted)', fontStyle: sub.message ? 'normal' : 'italic' }}>
              {sub.message || t('subscription.noMessage')}
            </div>
          )},
          { key: 'status', label: t('subscription.filterStatus'), render: (sub: any) => (
            <Badge tone={sub.status === 'approved' ? 'success' : sub.status === 'pending' ? 'warning' : sub.status === 'declined' ? 'destructive' : 'neutral'}>
              {sub.status}
            </Badge>
          )},
          { key: 'requested', label: t('subscription.requested'), hideOnMobile: true, render: (sub: any) => (
            <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
              {sub.created_at ? new Date(sub.created_at).toLocaleDateString() : '—'}
            </div>
          )},
          { key: 'actions', label: t('subscription.actions'), render: (sub: any) => (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {sub.status === 'pending' ? (
                <>
                  <div style={{ width: 100 }}>
                    <select
                      value={approvalPlans[sub.id] || 'pro'}
                      onChange={(e) => setApprovalPlans({ ...approvalPlans, [sub.id]: e.target.value as 'pro' | 'business' })}
                      style={{ width: '100%', minHeight: 32, borderRadius: 8, border: '1px solid var(--ui-border)', padding: '0 8px', fontSize: 13, background: 'var(--ui-surface-strong)', color: 'var(--ui-text)' }}
                    >
                      <option value="pro">{t('subscription.planPro')}</option>
                      <option value="business">{t('subscription.planBusiness')}</option>
                    </select>
                  </div>
                  <Button size="sm" variant="default"
                    onClick={() => subMutation.mutate({ id: sub.id, action: 'approve', plan: approvalPlans[sub.id] || 'pro' })}
                    disabled={subMutation.isPending}
                  >
                    {t('subscription.approve')}
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => subMutation.mutate({ id: sub.id, action: 'decline' })}
                    disabled={subMutation.isPending}
                  >
                    {t('subscription.decline')}
                  </Button>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                  {sub.status === 'approved' ? `${t('subscription.approvedAs')}${sub.plan || 'pro'}` : t('subscription.noActions')}
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
