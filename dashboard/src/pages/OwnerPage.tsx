import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
import { DataTable } from '../components/ui/data-table'
import { PageShell } from '../lib/page-shell'
import { getStoredUser } from '../lib/auth'
import { useI18n } from '../lib/i18n'

const GROUPS = [
  { name: 'Invest Community', health: <Badge tone="success">92</Badge>, members: '1842', subscription: <Badge tone="success">active</Badge> },
  { name: 'Trading AR', health: <Badge tone="warning">74</Badge>, members: '934', subscription: <Badge tone="warning">pending</Badge> },
  { name: 'Alpha Signals', health: <Badge tone="warning">68</Badge>, members: '2231', subscription: <Badge>none</Badge> },
  { name: 'Owner Lab', health: <Badge tone="success">88</Badge>, members: '1474', subscription: <Badge tone="success">active</Badge> },
]

export default function OwnerPage() {
  const { t } = useI18n()
  const user = getStoredUser()

  if (user?.role !== 'owner' && user?.role !== 'admin') {
    return (
      <PageShell titleKey="page.owner" descriptionKey="page.owner.desc">
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.ownerOnly')} />
      </PageShell>
    )
  }

  return (
    <PageShell titleKey="page.owner" descriptionKey="page.owner.desc">
      <ContentGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
        <MetricCard label={t('owner.totalGroups')} value="4" hint={t('owner.trackedWorkspaces')} />
        <MetricCard label={t('owner.totalMembers')} value="6481" hint={t('owner.acrossAllGroups')} />
        <MetricCard label={t('owner.activeSubs')} value="2" hint={t('owner.approvedAccess')} />
        <MetricCard label={t('owner.pendingRequests')} value="1" hint={t('owner.awaitingReview')} />
      </ContentGrid>

      <DataTable
        data={GROUPS}
        total={GROUPS.length}
        title={t('owner.yourGroups')}
        subtitle={t('owner.yourGroupsDesc')}
        searchPlaceholder={t('owner.searchGroups')}
        columns={[
          { key: 'name', label: t('owner.name'), render: (g: any) => g.name },
          { key: 'health', label: t('owner.health'), hideOnMobile: true, render: (g: any) => g.health },
          { key: 'members', label: t('owner.members'), render: (g: any) => g.members },
          { key: 'subscription', label: t('owner.subscription'), hideOnMobile: true, render: (g: any) => g.subscription },
        ]}
        keyExtractor={(_: any, i: number) => i}
      />
    </PageShell>
  )
}
