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
        <EmptyState title="Access denied" subtitle="This area is available to owner accounts only." />
      </PageShell>
    )
  }

  return (
    <PageShell titleKey="page.owner" descriptionKey="page.owner.desc">
      <ContentGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
        <MetricCard label="Total groups" value="4" hint="Tracked workspaces" />
        <MetricCard label="Total members" value="6481" hint="Across all groups" />
        <MetricCard label="Active subs" value="2" hint="Approved access" />
        <MetricCard label="Pending requests" value="1" hint="Awaiting review" />
      </ContentGrid>

      <DataTable
        data={GROUPS}
        total={GROUPS.length}
        title="Your Groups"
        subtitle="Manage your tracked groups and their subscriptions."
        searchPlaceholder="Search groups..."
        columns={[
          { key: 'name', label: 'Name', render: (g: any) => g.name },
          { key: 'health', label: 'Health', hideOnMobile: true, render: (g: any) => g.health },
          { key: 'members', label: 'Members', render: (g: any) => g.members },
          { key: 'subscription', label: 'Subscription', hideOnMobile: true, render: (g: any) => g.subscription },
        ]}
        keyExtractor={(_: any, i: number) => i}
      />
    </PageShell>
  )
}
