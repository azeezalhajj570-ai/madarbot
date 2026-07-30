import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CreditCard, Gift, Info } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, Field, Input, InlineMessage } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
import { useToast } from '../../components/ui/toast'
import { PageShell } from '../../lib/page-shell'
import { fetchWorkspaceUsage, redeemPromoCode } from '../../lib/api'
import { radius, spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'

function usagePct(active: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0
  return Math.min(100, Math.round((active / limit) * 100))
}

function barTone(pct: number): string {
  if (pct >= 100) return uiVars.danger
  if (pct >= 80) return uiVars.warning
  return uiVars.primary
}

function ResourceUsageRow({ label, active, limit }: { label: string; active: number; limit: number | null }) {
  const pct = usagePct(active, limit)
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: typeScale.body }}>{label}</div>
        <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>
          {limit === null ? `${active}` : `${active} / ${limit}`}
        </div>
      </div>
      <div style={{ height: 8, borderRadius: radius.xs, background: uiVars.bgMuted, overflow: 'hidden' }}>
        {limit !== null ? (
          <div style={{ height: '100%', width: `${pct}%`, background: barTone(pct), transition: 'width 0.2s' }} />
        ) : null}
      </div>
    </div>
  )
}

export default function AdminUsagePage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')

  const { data: usage, isLoading } = useQuery({
    queryKey: ['workspace-usage'],
    queryFn: fetchWorkspaceUsage,
  })

  const redeemMutation = useMutation({
    mutationFn: () => redeemPromoCode(code),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-usage'] })
      setCode('')
      toast.success(result.message || 'Code redeemed!')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to redeem code')
    },
  })

  return (
    <PageShell titleKey="page.admin.usage" descriptionKey="page.admin.usage.desc" loading={isLoading}>
      {usage ? (
        <div style={{
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
        }}>
          {/* Plan card */}
          <Card style={{ display: 'grid', gap: spacing.md, alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: radius.md, background: uiVars.primarySoft, color: uiVars.primary, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <CreditCard size={18} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted, fontWeight: 700 }}>
                    {t('usage.currentPlan')}
                  </div>
                  {usage.status ? (
                    <Badge tone={usage.status === 'active' ? 'success' : 'warning'}>
                      {usage.status}
                    </Badge>
                  ) : null}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>
                  {usage.plan || t('usage.noPlan')}
                </div>
                <div style={{ fontSize: typeScale.caption, color: uiVars.textSubtle, marginTop: 2 }}>
                  {usage.source === 'none'
                    ? t('usage.noPlanDesc')
                    : usage.source === 'legacy'
                      ? 'Legacy subscription'
                      : 'Workspace subscription'}
                </div>
              </div>
            </div>

            {usage.expires_at ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: typeScale.caption, color: uiVars.textMuted, padding: '8px 0', borderTop: `1px solid ${uiVars.border}` }}>
                <CalendarDays size={14} />
                <span style={{ fontWeight: 600 }}>Expires: {new Date(usage.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
            ) : null}
          </Card>

          {/* Resources card */}
          <Card style={{ display: 'grid', gap: spacing.lg, alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Info size={16} />
              <span style={{ fontWeight: 800, fontSize: typeScale.body }}>{t('usage.resources')}</span>
            </div>
            <ResourceUsageRow label={t('usage.agents')} active={usage.resources.agents.active} limit={usage.resources.agents.limit} />
            <ResourceUsageRow label={t('usage.groups')} active={usage.resources.groups.active} limit={usage.resources.groups.limit} />
          </Card>

          {/* Promo code card */}
          <Card style={{ display: 'grid', gap: spacing.md, alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Gift size={16} />
              <span style={{ fontWeight: 800, fontSize: typeScale.body }}>{t('usage.redeemCode')}</span>
            </div>
            <Field label={t('usage.code')} hint={t('usage.codeHint')}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX" style={{ flex: 1 }} />
                <Button onClick={() => redeemMutation.mutate()} disabled={!code.trim() || redeemMutation.isPending}>
                  {redeemMutation.isPending ? t('common.redeeming') : t('common.redeem')}
                </Button>
              </div>
            </Field>
            {redeemMutation.isError && (
              <InlineMessage tone="destructive">
                {(redeemMutation.error as any)?.response?.data?.detail || 'Failed to redeem code'}
              </InlineMessage>
            )}
          </Card>
        </div>
      ) : null}
    </PageShell>
  )
}
