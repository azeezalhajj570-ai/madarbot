import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ticket, Users, CheckCircle2, XCircle, Plus, Calendar, Clock, RefreshCw, Trash2 } from 'lucide-react'

import { 
  Badge, 
  Button, 
  Card, 
  ContentGrid, 
  EmptyState, 
  MetricCard, 
  Table, 
  LoadingState,
  Dialog,
  Field,
  Input,
  FieldRow,
  Select,
  ToggleRow
} from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { getStoredUser } from '../lib/auth'
import { 
  fetchOwnerSubscriptions, 
  updateOwnerSubscription, 
  fetchOwnerPromoCodes, 
  createOwnerPromoCode, 
  updateOwnerPromoCode,
  deleteOwnerPromoCode,
  fetchOwnerStats 
} from '../lib/api'
import { useToast } from '../components/ui/toast'
import { useI18n } from '../lib/i18n'

export default function SubscriptionsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const user = getStoredUser()
  const [promoDialogOpen, setPromoDialogOpen] = useState(false)
  const [approvalPlans, setApprovalPlans] = useState<Record<number, 'pro' | 'business'>>({})
  
  // Form state for new promo code
  const [newPromo, setNewPromo] = useState({
    code: '',
    plan: 'pro' as 'pro' | 'business',
    duration_days: 30,
    max_uses: 0,
    is_active: true
  })

  const { data: stats } = useQuery({
    queryKey: ['owner', 'stats'],
    queryFn: fetchOwnerStats,
  })

  const { data: subs, isLoading: subsLoading } = useQuery({
    queryKey: ['owner', 'subscriptions'],
    queryFn: fetchOwnerSubscriptions,
  })

  const { data: promos, isLoading: promosLoading } = useQuery({
    queryKey: ['owner', 'promos'],
    queryFn: () => fetchOwnerPromoCodes(),
  })

  const subMutation = useMutation({
    mutationFn: ({ id, action, plan }: { id: number, action: 'approve' | 'decline', plan?: 'pro' | 'business' }) => 
      updateOwnerSubscription(id, action, plan),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'subscriptions'] })
      queryClient.invalidateQueries({ queryKey: ['owner', 'stats'] })
      if (variables.action === 'approve') {
        toast.success(t('subscription.approved'))
      } else {
        toast.success(t('subscription.declined'))
      }
    },
    onError: () => {
      toast.error(t('subscription.updateError'))
    }
  })

  const createPromoMutation = useMutation({
    mutationFn: (payload: any) => createOwnerPromoCode(payload),
    onSuccess: () => {
      setPromoDialogOpen(false)
      setNewPromo({ code: '', plan: 'pro', duration_days: 30, max_uses: 0, is_active: true })
      queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] })
      toast.success(t('promocode.created'))
    },
    onError: () => {
      toast.error(t('promocode.createError'))
    }
  })

  const updatePromoMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number, payload: any }) => 
      updateOwnerPromoCode(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] })
    }
  })

  const deletePromoMutation = useMutation({
    mutationFn: (id: number) => deleteOwnerPromoCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] })
      toast.success(t('promocode.deleted'))
    },
    onError: () => {
      toast.error(t('promocode.deleteError'))
    }
  })

  if (user?.role !== 'owner' && user?.role !== 'admin') {
    return (
      <PageShell titleKey="page.subscriptions" descriptionKey="page.subscriptions.desc">
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.ownerOnly')} />
      </PageShell>
    )
  }

  return (
    <PageShell 
      
      titleKey="page.subscriptions" 
      descriptionKey="page.subscriptions.desc"
    >
      <ContentGrid columns="repeat(auto-fit, minmax(240px, 1fr))">
        <MetricCard 
          label={t('subscription.activeSubs')} 
          value={stats?.active_subscriptions?.toString() || '0'} 
          hint={t('subscription.approvedAccounts')} 
          icon={<CheckCircle2 size={20} />}
        />
        <MetricCard 
          label={t('subscription.pendingRequests')} 
          value={stats?.pending_requests?.toString() || '0'} 
          hint={t('subscription.awaitingReview')} 
          icon={<Clock size={20} />}
        />
        <MetricCard 
          label={t('promocode.title')} 
          value={(promos?.length || 0).toString()} 
          hint={t('subscription.activeCampaigns')} 
          icon={<Ticket size={20} />}
        />
      </ContentGrid>

      <div style={{ display: 'grid', gap: 24 }}>
        <Card title={t('subscription.title')} subtitle={t('subscription.desc')}>
          {subsLoading ? (
            <LoadingState />
          ) : (subs || []).length > 0 ? (
            <Table
              columns={[
                { key: 'requester', label: 'Requester', render: (sub: any) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: 'var(--ui-primary)' }}>
                      <Users size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{sub.full_name || t('subscription.telegramUser')}</div>
                      <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{sub.username || t('common.unknown')} · {sub.tg_user_id}</div>
                    </div>
                  </div>
                )},
                { key: 'message', label: 'Message', hideOnMobile: true, render: (sub: any) => (
                  <div style={{ maxWidth: 240, fontSize: 13, color: 'var(--ui-text-muted)', fontStyle: sub.message ? 'normal' : 'italic' }}>
                    {sub.message || t('subscription.noMessage')}
                  </div>
                )},
                { key: 'status', label: 'Status', render: (sub: any) => (
                  <Badge tone={
                    sub.status === 'approved' ? 'success' : 
                    sub.status === 'pending' ? 'warning' : 
                    sub.status === 'declined' ? 'destructive' : 'neutral'
                  }>
                    {sub.status}
                  </Badge>
                )},
                { key: 'requested', label: 'Requested', hideOnMobile: true, render: (sub: any) => (
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                    {new Date(sub.created_at).toLocaleDateString()}
                  </div>
                )},
                { key: 'actions', label: 'Actions', render: (sub: any) => (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {sub.status === 'pending' ? (
                      <>
                        <div style={{ width: 100 }}>
                          <select
                            value={approvalPlans[sub.id] || 'pro'} 
                            onChange={(e) => setApprovalPlans({ ...approvalPlans, [sub.id]: e.target.value as any })}
                            style={{
                              width: '100%',
                              minHeight: 32,
                              borderRadius: '6px',
                              border: '1px solid var(--ui-border)',
                              padding: '0 8px',
                              fontSize: 13,
                              background: 'var(--ui-surface-strong)',
                              color: 'var(--ui-text)',
                            }}
                          >
                            <option value="pro">{t('subscription.planPro')}</option>
                            <option value="business">{t('subscription.planBusiness')}</option>
                          </select>
                        </div>
                        <Button 
                          size="sm" 
                          variant="default" 
                          onClick={() => subMutation.mutate({ 
                            id: sub.id, 
                            action: 'approve', 
                            plan: approvalPlans[sub.id] || 'pro' 
                          })}
                          disabled={subMutation.isPending}
                        >
                          {t('subscription.approve')}
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => subMutation.mutate({ id: sub.id, action: 'decline' })}
                          disabled={subMutation.isPending}
                        >
                          {t('subscription.decline')}
                        </Button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                        {sub.status === 'approved' ? <>{t('subscription.approvedAs')}{sub.plan || t('subscription.planPro')}</> : t('subscription.noActions')}
                      </span>
                    )}
                  </div>
                )},
              ]}
              data={subs || []}
              keyExtractor={(sub: any) => sub.id}
            />
          ) : (
            <EmptyState title={t('subscription.noRequests')} subtitle={t('subscription.noRequests.desc')} />
          )}
        </Card>

        <Card 
          title={t('promocode.title')} 
          subtitle={t('promocode.desc')}
        >
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setPromoDialogOpen(true)}>
              <Plus size={16} style={{ marginInlineEnd: 8 }} />
              {t('promocode.create')}
            </Button>
          </div>
          
          {promosLoading ? (
            <LoadingState />
          ) : (promos || []).length > 0 ? (
            <Table
              columns={[
                { key: 'code', label: 'Code', render: (p: any) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: 'var(--ui-primary)' }}>
                      <Ticket size={16} />
                    </div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14 }}>{p.code}</div>
                  </div>
                )},
                { key: 'plan', label: t('promocode.plan'), hideOnMobile: true, render: (p: any) => (
                  <Badge tone={p.plan === 'business' ? 'success' : 'neutral'}>{p.plan}</Badge>
                )},
                { key: 'duration', label: 'Duration', hideOnMobile: true, render: (p: any) => (
                  <div style={{ fontWeight: 600 }}>{p.duration_days} {t('promocode.days')}</div>
                )},
                { key: 'usage', label: t('promocode.usage'), render: (p: any) => (
                  <div style={{ fontSize: 13 }}>
                    {p.used_count} / {p.max_uses || '∞'}
                  </div>
                )},
                { key: 'active', label: t('promocode.active'), render: (p: any) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ToggleRow
                      title=""
                      subtitle=""
                      checked={p.is_active}
                      onCheckedChange={(checked) => updatePromoMutation.mutate({ id: p.id, payload: { is_active: checked } })}
                      disabled={updatePromoMutation.isPending}
                    />
                  </div>
                )},
                { key: 'actions', label: t('subscription.actions'), render: (p: any) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => { if(confirm(t('promocode.deleteConfirm'))) deletePromoMutation.mutate(p.id) }}
                      disabled={deletePromoMutation.isPending}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )},
              ]}
              data={promos || []}
              keyExtractor={(p: any) => p.id}
            />
          ) : (
            <EmptyState title={t('promocode.noCodes')} subtitle={t('promocode.noCodes.desc')} />
          )}
        </Card>
      </div>

      <Dialog 
        open={promoDialogOpen} 
        onClose={() => setPromoDialogOpen(false)}
        title={t('promocode.create')}
        description={t('promocode.desc')}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <FieldRow>
            <Field label={t('promocode.codeName')} hint={t('promocode.codeNameHint')}>
              <Input 
                value={newPromo.code} 
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} 
                placeholder={t('promocode.codePlaceholder')}
              />
            </Field>
            <Field label={t('promocode.plan')} hint={t('promocode.planHint')}>
              <Select 
                value={newPromo.plan} 
                onChange={(e) => setNewPromo({ ...newPromo, plan: e.target.value as any })}
              >
                <option value="pro">{t('subscription.planPro')}</option>
                <option value="business">{t('subscription.planBusiness')}</option>
              </Select>
            </Field>
          </FieldRow>
          
          <FieldRow>
            <Field label={t('promocode.durationDays')} hint={t('promocode.durationHint')}>
              <Input 
                type="number" 
                value={newPromo.duration_days} 
                onChange={(e) => setNewPromo({ ...newPromo, duration_days: parseInt(e.target.value) || 1 })} 
              />
            </Field>
            <Field label={t('promocode.maxUses')} hint={t('promocode.maxUsesHint')}>
              <Input 
                type="number" 
                value={newPromo.max_uses} 
                onChange={(e) => setNewPromo({ ...newPromo, max_uses: parseInt(e.target.value) || 0 })} 
              />
            </Field>
          </FieldRow>

          <Button 
            onClick={() => createPromoMutation.mutate({
              ...newPromo,
              max_uses: newPromo.max_uses > 0 ? newPromo.max_uses : undefined
            })}
            disabled={createPromoMutation.isPending || !newPromo.code}
          >
            {createPromoMutation.isPending ? t('promocode.creating') : t('promocode.createCode')}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
