import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, User, Shield, Activity, Phone, Mail, Trash2 } from 'lucide-react'

import { Badge, Card, CardSkeleton, ContentGrid, EmptyState, MetricCard, Table, Button } from '../components/ui/primitives'
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
        <Card title={t('agents.myAccounts')} subtitle={t('agents.myAccounts.desc')}>
          {myAgentsLoading ? (
            <CardSkeleton />
          ) : (myAgents || []).length > 0 ? (
            <Table<Agent>
              columns={[
                { key: 'identity', label: t('agent.agentIdentity'), render: (agent) => (
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
                { key: 'phone', label: t('agent.phone'), hideOnMobile: true, render: (agent) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} style={{ color: 'var(--ui-text-muted)' }} />
                    {agent.phone_number || t('common.none')}
                  </div>
                )},
                { key: 'status', label: t('agent.status'), render: (agent) => (
                  <Badge tone={agent.status === 'active' ? 'success' : 'warning'}>{agent.status}</Badge>
                )},
                { key: 'last_active', label: t('agent.lastActivity'), render: (agent) => (
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                    {agent.updated_at ? new Date(agent.updated_at).toLocaleString() : t('common.never')}
                  </div>
                )},
              ]}
              data={myAgents || []}
              keyExtractor={(agent) => agent.id}
            />
          ) : (
            <EmptyState title={t('agents.noLinked')} subtitle={t('agents.noLinked.desc')} />
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
          label={t('agents.totalAgents')} 
          value={stats?.linked_agents?.toString() || '0'} 
          hint={t('agents.totalAgents.desc')} 
          icon={<Bot size={20} />}
        />
        <MetricCard 
          label={t('agents.activeJobs')} 
          value={stats?.pending_agent_jobs?.toString() || '0'} 
          hint={t('agents.activeJobs.desc')} 
          icon={<Activity size={20} />}
        />
        <MetricCard 
          label={t('agents.staffMembers')} 
          value={(users?.length || 0).toString()} 
          hint={t('agents.staffMembers.desc')} 
          icon={<Shield size={20} />}
        />
      </ContentGrid>

      <Card title={t('agents.telegramAccounts')} subtitle={t('agents.telegramAccounts.desc')}>
        {agentsLoading ? (
          <CardSkeleton />
        ) : (agents || []).length > 0 ? (
          <Table<Agent>
            columns={[
              { key: 'identity', label: t('agent.agentIdentity'), render: (agent) => (
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
              { key: 'phone', label: t('agent.phone'), render: (agent) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  {agent.phone_number || t('common.none')}
                </div>
              )},
              { key: 'status_auth', label: t('agents.statusAuth'), render: (agent) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Badge tone={agent.status === 'active' ? 'success' : 'warning'}>{agent.status}</Badge>
                  <Badge tone={agent.auth_state === 'active' ? 'success' : 'warning'}>{agent.auth_state}</Badge>
                </div>
              )},
              { key: 'workspace', label: t('agents.workspace'), hideOnMobile: true, render: (agent) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{agent.group_title || t('common.none')}</div>
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>Workspace ID: {agent.group_id}</div>
                </div>
              )},
              { key: 'last_active', label: t('agent.lastActivity'), render: (agent) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)', flex: 1 }}>
                    {agent.updated_at ? new Date(agent.updated_at).toLocaleString() : t('common.never')}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    style={{ color: 'var(--ui-danger)', padding: 6 }}
                    onClick={() => {
                      if (confirm(`${t('agents.deleteConfirm')} ${agent.external_account_id}?`)) {
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
          <EmptyState title={t('agents.noFound')} subtitle={t('agents.noFound.desc')} />
        )}
      </Card>

      <Card title={t('agents.dashboardStaff')} subtitle={t('agents.dashboardStaff.desc')}>
        {usersLoading ? (
          <CardSkeleton />
        ) : (users || []).length > 0 ? (
          <Table
            columns={[
              { key: 'user', label: t('agents.user'), render: (u: any) => (
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
              { key: 'email', label: t('agents.email'), hideOnMobile: true, render: (u: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  {u.email}
                </div>
              )},
              { key: 'role', label: t('agents.role'), render: (u: any) => (
                <Badge tone={u.role === 'owner' ? 'success' : 'neutral'}>{u.role}</Badge>
              )},
              { key: 'access_control', label: t('agents.accessControl'), hideOnMobile: true, render: () => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Shield size={14} style={{ color: 'var(--ui-text-muted)' }} />
                  {t('agents.loginRestricted')}
                </div>
              )},
            ]}
            data={users || []}
            keyExtractor={(_: any, i: number) => i}
          />
        ) : (
          <EmptyState title={t('agents.noUsers')} subtitle={t('agents.noUsers.desc')} />
        )}
      </Card>
    </PageShell>
  )
}
