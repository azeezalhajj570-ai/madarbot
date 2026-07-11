import { useQuery } from '@tanstack/react-query'
import { Users, Bot, MessageSquare, TrendingUp } from 'lucide-react'

import { Badge, Button, Card, ContentGrid, EmptyState, MetricCard, Table } from '../components/ui/primitives'
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
        <MetricCard label="Groups" value={String(stats?.total_groups ?? 0)} hint="Tracked workspaces" icon={<Users size={20} />} />
        <MetricCard label="Members" value={String(stats?.total_members ?? 0)} hint="Across all groups" icon={<TrendingUp size={20} />} />
        <MetricCard label="Active Agents" value={String(stats?.active_agents ?? 0)} hint="Linked accounts" icon={<Bot size={20} />} />
        <MetricCard label="Messages" value={String(stats?.total_messages ?? 0)} hint="Total scraped" icon={<MessageSquare size={20} />} />
      </ContentGrid>

      <Card title="Your Groups">
        {groups && groups.length > 0 ? (
          <Table
            columns={['Group', 'Members', 'Health', 'Status']}
            rows={groups.map((g: any) => [
              <div style={{ fontWeight: 700 }}>{g.title || `Group #${g.tg_group_id}`}</div>,
              String(g.member_count ?? '—'),
              <Badge tone={g.health_score >= 80 ? 'success' : g.health_score >= 60 ? 'warning' : 'destructive'}>
                {g.health_score ?? '—'}
              </Badge>,
              <Badge tone={g.status === 'active' ? 'success' : 'neutral'}>{g.status || 'active'}</Badge>,
            ])}
          />
        ) : (
          <EmptyState title="No groups yet" subtitle="Groups will appear here once you connect your bot." />
        )}
      </Card>
    </PageShell>
  )
}
