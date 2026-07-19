import { useState } from 'react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { getStoredUser } from '../lib/auth'
import { useI18n } from '../lib/i18n'

const GROUPS = [
  { name: 'Invest Community', health: <Badge tone="success">92</Badge>, members: '1842', subscription: <Badge tone="success">active</Badge>, actions: '' },
  { name: 'Trading AR', health: <Badge tone="warning">74</Badge>, members: '934', subscription: <Badge tone="warning">pending</Badge>, actions: <div style={{ display: 'flex', gap: 8 }}><Button>Approve</Button><Button variant="outline">Decline</Button></div> },
  { name: 'Alpha Signals', health: <Badge tone="warning">68</Badge>, members: '2231', subscription: <Badge>none</Badge>, actions: '' },
  { name: 'Owner Lab', health: <Badge tone="success">88</Badge>, members: '1474', subscription: <Badge tone="success">active</Badge>, actions: '' },
]

export default function OwnerPage() {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
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
      <Card>
        <Table
          columns={[
            { key: 'name', label: 'Name', render: (g: any) => g.name },
            { key: 'health', label: 'Health', hideOnMobile: true, render: (g: any) => g.health },
            { key: 'members', label: 'Members', render: (g: any) => g.members },
            { key: 'subscription', label: 'Subscription', hideOnMobile: true, render: (g: any) => g.subscription },
            { key: 'actions', label: 'Actions', render: (g: any) => g.actions },
          ]}
          data={GROUPS.slice((page - 1) * 2, page * 2)}
          keyExtractor={(_: any, i: number) => i + (page - 1) * 2}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</Button>
          <Button variant="outline" disabled={page >= 2} onClick={() => setPage((current) => current + 1)}>Next</Button>
        </div>
      </Card>
    </PageShell>
  )
}
