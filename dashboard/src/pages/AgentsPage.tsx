import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, User, Shield, Activity, Phone, Mail, Trash2 } from 'lucide-react'

import { Badge, Card, ContentGrid, EmptyState, MetricCard, Table, LoadingState, Button } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { getStoredUser } from '../lib/auth'
import { fetchAgents, fetchOwnerAgents, fetchOwnerUsers, fetchOwnerStats, deleteAgent } from '../lib/api'
import type { Agent } from '../lib/types'
import { useI18n } from '../lib/i18n'

export default function AgentsPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const queryClient = useQueryClient()

  const { data: stats } = useQuery({
    queryKey: ['owner', 'stats'],
    queryFn: fetchOwnerStats,
  })

  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: ['owner', 'agents'],
    queryFn: () => fetchOwnerAgents(),
  })

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['owner', 'users'],
    queryFn: fetchOwnerUsers,
  })

  const deleteMutation = useMutation({
    mutationFn: (agentId: number) => deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'agents'] })
      queryClient.invalidateQueries({ queryKey: ['owner', 'stats'] })
    }
  })

  const { data: myAgents, isLoading: myAgentsLoading } = useQuery({
    queryKey: ['my-agents'],
    queryFn: () => fetchAgents(),
    enabled: user?.role !== 'owner',
  })

  if (user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.agents" descriptionKey="page.agents.desc">
        <Card title="My Agent Accounts" subtitle="Linked Telegram accounts for your automated tasks and scraping.">
          {myAgentsLoading ? (
            <LoadingState />
          ) : (myAgents || []).length > 0 ? (
            <Table<Agent>
              columns={[
                { key: 'identity', label: 'Agent Identity', render: (agent) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: 'var(--ui-primary)' }}>
                      <Bot size={16} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700 }}>{agent.external_account_id}</div>
                      <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>ID: {agent.id}</div>
                    </div>
                  </div>
                )},
                { key: 'phone', label: 'Phone', hideOnMobile: true, render: (agent) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} style={{ color: 'var(--ui-text-muted)' }} />
                    {agent.phone_number || 'N/A'}
                  </div>
                )},
                { key: 'status', label: 'Status', render: (agent) => (
                  <Badge tone={agent.status === 'active' ? 'success' : 'warning'}>{agent.status}</Badge>
                )},
                { key: 'last_active', label: 'Last Active', render: (agent) => (
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                    {agent.updated_at ? new Date(agent.updated_at).toLocaleString() : 'Never'}
                  </div>
                )},
              ]}
              data={myAgents || []}
              keyExtractor={(agent) => agent.id}
            />
          ) : (
            <EmptyState title="No agents linked" subtitle="Link a Telegram account to start using automated features." />
          )}
        </Card>
      </PageShell>
    )
  }

  return (
    <PageShell 
      
      titleKey="page.agents" 
      descriptionKey="page.agents.desc"
    >
      <ContentGrid columns="repeat(auto-fit, minmax(240px, 1fr))">
        <MetricCard 
          label="Total Agents" 
          value={stats?.linked_agents?.toString() || '0'} 
          hint="Linked Telegram accounts" 
          icon={<Bot size={20} />}
        />
        <MetricCard 
          label="Active Jobs" 
          value={stats?.pending_agent_jobs?.toString() || '0'} 
          hint="Currently processing" 
          icon={<Activity size={20} />}
        />
        <MetricCard 
          label="Staff Members" 
          value={(users?.length || 0).toString()} 
          hint="Dashboard login access" 
          icon={<Shield size={20} />}
        />
      </ContentGrid>

      <Card title="Telegram Agent Accounts" subtitle="All bot agents linked by users for automated tasks and scraping.">
        {agentsLoading ? (
          <LoadingState />
        ) : (agents || []).length > 0 ? (
          <Table<Agent>
            columns={[
              { key: 'identity', label: 'Agent Identity', render: (agent) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: 'var(--ui-primary)' }}>
                    <Bot size={16} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{agent.external_account_id}</div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>ID: {agent.id}</div>
                  </div>
                </div>
              )},
              { key: 'phone', label: 'Phone', render: (agent) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  {agent.phone_number || 'N/A'}
                </div>
              )},
              { key: 'status_auth', label: 'Status / Auth', render: (agent) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Badge tone={agent.status === 'active' ? 'success' : 'warning'}>{agent.status}</Badge>
                  <Badge tone={agent.auth_state === 'active' ? 'success' : 'warning'}>{agent.auth_state}</Badge>
                </div>
              )},
              { key: 'workspace', label: 'Workspace', hideOnMobile: true, render: (agent) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{agent.group_title || 'N/A'}</div>
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Workspace ID: {agent.group_id}</div>
                </div>
              )},
              { key: 'last_active', label: 'Last Active', render: (agent) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', flex: 1 }}>
                    {agent.updated_at ? new Date(agent.updated_at).toLocaleString() : 'Never'}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    style={{ color: 'var(--ui-danger)', padding: 6 }}
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete agent ${agent.external_account_id}?`)) {
                        deleteMutation.mutate(agent.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )},
            ]}
            data={agents || []}
            keyExtractor={(agent) => agent.id}
          />
        ) : (
          <EmptyState title="No agents found" subtitle="Linked Telegram accounts will appear here." />
        )}
      </Card>

      <Card title="Dashboard Staff" subtitle="Users with login access to this dashboard (configured in system environment).">
        {usersLoading ? (
          <LoadingState />
        ) : (users || []).length > 0 ? (
          <Table
            columns={[
              { key: 'user', label: 'User', render: (u: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: 'var(--ui-primary)' }}>
                    <User size={16} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{u.username || u.email.split('@')[0]}</div>
                    <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>User ID: {u.user_id}</div>
                  </div>
                </div>
              )},
              { key: 'email', label: 'Email', hideOnMobile: true, render: (u: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  {u.email}
                </div>
              )},
              { key: 'role', label: 'Role', render: (u: any) => (
                <Badge tone={u.role === 'owner' ? 'success' : 'neutral'}>{u.role}</Badge>
              )},
              { key: 'access_control', label: 'Access Control', hideOnMobile: true, render: () => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Shield size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  Login restricted to config
                </div>
              )},
            ]}
            data={users || []}
            keyExtractor={(_: any, i: number) => i}
          />
        ) : (
          <EmptyState title="No users found" subtitle="Dashboard users will appear here." />
        )}
      </Card>
    </PageShell>
  )
}
