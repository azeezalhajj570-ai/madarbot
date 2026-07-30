import { useQuery } from '@tanstack/react-query'

import { Badge, Card } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
import { PageShell } from '../../lib/page-shell'
import { fetchWorkspaceUsage } from '../../lib/api'
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

function ResourceUsageRow({
  label,
  active,
  limit,
}: {
  label: string
  active: number
  limit: number | null
}) {
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
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: barTone(pct),
              transition: 'width 0.2s',
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export default function AdminUsagePage() {
  const { t } = useI18n()

  const { data: usage, isLoading } = useQuery({
    queryKey: ['workspace-usage'],
    queryFn: fetchWorkspaceUsage,
  })

  return (
    <PageShell titleKey="page.admin.usage" descriptionKey="page.admin.usage.desc" loading={isLoading}>
      {usage ? (
        <div style={{ display: 'grid', gap: 20, maxWidth: 560 }}>
          <Card style={{ display: 'grid', gap: spacing.md }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted, fontWeight: 700 }}>
                  {t('usage.currentPlan')}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {usage.plan || t('usage.noPlan')}
                </div>
              </div>
              {usage.status ? (
                <Badge tone={usage.status === 'active' ? 'success' : 'neutral'}>
                  {usage.status}
                </Badge>
              ) : null}
            </div>
            {usage.source === 'none' ? (
              <div style={{ fontSize: typeScale.caption, color: uiVars.textSubtle }}>
                {t('usage.noPlanDesc')}
              </div>
            ) : null}
          </Card>

          <Card style={{ display: 'grid', gap: spacing.lg }}>
            <div style={{ fontWeight: 800, fontSize: typeScale.body }}>{t('usage.resources')}</div>
            <ResourceUsageRow
              label={t('usage.agents')}
              active={usage.resources.agents.active}
              limit={usage.resources.agents.limit}
            />
            <ResourceUsageRow
              label={t('usage.groups')}
              active={usage.resources.groups.active}
              limit={usage.resources.groups.limit}
            />
          </Card>
        </div>
      ) : null}
    </PageShell>
  )
}
