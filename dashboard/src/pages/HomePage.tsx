import { useQuery } from '@tanstack/react-query'
import { Users, Bot, MessageSquare, TrendingUp } from 'lucide-react'

import { Badge, Button, Card, ColumnDef, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { fetchOwnerStats, fetchOwnerGroups } from '../lib/api'

export default function HomePage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['owner', 'stats'],
    queryFn: fetchOwnerStats,
  })

  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ['owner', 'groups'],
    queryFn: fetchOwnerGroups,
  })

  const loading = statsLoading || groupsLoading

  return (
    <PageShell titleKey="nav.workspace" descriptionKey="page.dashboard.desc" loading={loading}>
      <ContentGrid columns="repeat(auto-fit, minmax(220px, 1fr))">
        <MetricCard label="Groups" value={String((stats as any)?.total_groups ?? 0)} hint="Tracked workspaces" icon={<Users size={20} />} />
        <MetricCard label="Members" value={String((stats as any)?.total_members ?? 0)} hint="Across all groups" icon={<TrendingUp size={20} />} />
        <MetricCard label="Active Agents" value={String((stats as any)?.active_agents ?? 0)} hint="Linked accounts" icon={<Bot size={20} />} />
        <MetricCard label="Messages" value={String((stats as any)?.total_messages ?? 0)} hint="Total scraped" icon={<MessageSquare size={20} />} />
      </ContentGrid>

      <Card title="Your Groups">
        {groups && groups.length > 0 ? (
          <Table
            columns={[
              { key: 'group', label: 'Group', render: (g: any) => <div style={{ fontWeight: 700 }}>{g.title || `Group #${g.tg_group_id}`}</div> },
              { key: 'members', label: 'Members', hideOnMobile: true, render: (g: any) => String(g.member_count ?? '—') },
              { key: 'health', label: 'Health', render: (g: any) => (
                <Badge tone={g.health_score >= 80 ? 'success' : g.health_score >= 60 ? 'warning' : 'destructive'}>
                  {g.health_score ?? '—'}
                </Badge>
              )},
              { key: 'status', label: 'Status', render: (g: any) => (
                <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status || 'active'}</Badge>
              )},
            ]}
            data={groups}
            keyExtractor={(g: any) => g.tg_group_id}
          />
        ) : (
          <EmptyState title="No groups yet" subtitle="Groups will appear here once you connect your bot." />
        )}
      </Card>
    </PageShell>
  )
}
