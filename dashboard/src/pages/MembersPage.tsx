import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, Shield, Crown } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, Dialog, EmptyState, Field, Input, Select, InlineMessage } from '../components/ui/primitives'
import { DataTable } from '../components/ui/data-table'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/ui/toast'
import { fetchTeamWorkspaces, fetchTeamWorkspaceMembers, inviteTeamWorkspaceMember, removeTeamWorkspaceMember, changeTeamWorkspaceMemberRole } from '../lib/api'
import type { TeamWorkspace, TeamWorkspaceMember, WorkspaceRole } from '../lib/types'

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }
const ROLE_TONES: Record<string, 'success' | 'warning' | 'default' | 'neutral'> = { owner: 'success', admin: 'warning', member: 'default', viewer: 'neutral' }

export default function MembersPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteIdentifier, setInviteIdentifier] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member')
  const [selectedWs, setSelectedWs] = useState<number | null>(null)

  const { data: workspacesData, isLoading: wsLoading } = useQuery({
    queryKey: ['team-workspaces'],
    queryFn: fetchTeamWorkspaces,
  })

  const workspaces = workspacesData?.workspaces || []
  const activeWs = selectedWs || workspaces[0]?.id || null

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members', activeWs],
    queryFn: () => fetchTeamWorkspaceMembers(activeWs!),
    enabled: !!activeWs,
  })

  const members = membersData?.members || []
  const currentWs = workspaces.find(w => w.id === activeWs)

  const inviteMutation = useMutation({
    mutationFn: () => inviteTeamWorkspaceMember(activeWs!, inviteIdentifier, inviteRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWs] })
      setInviteOpen(false)
      setInviteIdentifier('')
      setInviteRole('member')
      toast.success('Member invited')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to invite member')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: number) => removeTeamWorkspaceMember(activeWs!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWs] })
      toast.success('Member removed')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to remove member')
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: WorkspaceRole }) =>
      changeTeamWorkspaceMemberRole(activeWs!, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWs] })
      toast.success('Role updated')
    },
  })

  return (
    <PageShell titleKey="page.members" descriptionKey="page.members.desc" actions={
      <Button onClick={() => setInviteOpen(true)}>
        <UserPlus size={14} />
        {t('members.invite')}
      </Button>
    }>
      {wsLoading ? (
        <CardSkeleton />
      ) : workspaces.length === 0 ? (
        <EmptyState title="No workspace" subtitle="Create a workspace first to manage members." />
      ) : (
        <>
          {workspaces.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Select value={activeWs?.toString() || ''} onChange={e => setSelectedWs(Number(e.target.value))}>
                {workspaces.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </div>
          )}

          <Card title={currentWs?.name || 'Workspace'} subtitle={`${members.length} members`}>
            {membersLoading ? (
              <CardSkeleton />
            ) : members.length === 0 ? (
              <EmptyState title="No members" subtitle="Invite members to collaborate." />
            ) : (
              <DataTable
                data={members}
                total={members.length}
                columns={[
                  { key: 'identity', label: 'User', render: (m: TeamWorkspaceMember) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-bg-muted)', display: 'grid', placeItems: 'center', color: m.role === 'owner' ? 'var(--ui-warning)' : 'var(--ui-primary)' }}>
                        {m.role === 'owner' ? <Crown size={14} /> : <Shield size={14} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.full_name || m.username || `User ${m.user_id}`}</div>
                        <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{m.username ? `@${m.username}` : `ID: ${m.user_id}`}</div>
                      </div>
                    </div>
                  )},
                  { key: 'role', label: 'Role', render: (m: TeamWorkspaceMember) => (
                    m.role === 'owner' ? (
                      <Badge tone="success">{ROLE_LABELS[m.role]}</Badge>
                    ) : (
                      <Select
                        value={m.role}
                        onChange={e => roleMutation.mutate({ userId: m.user_id, role: e.target.value as WorkspaceRole })}
                        style={{ minWidth: 100 }}
                        disabled={roleMutation.isPending}
                      >
                        {(['admin', 'member', 'viewer'] as const).map(r => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </Select>
                    )
                  )},
                  { key: 'joined', label: 'Joined', hideOnMobile: true, render: (m: TeamWorkspaceMember) => (
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                      {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                    </span>
                  )},
                  { key: 'actions', label: '', render: (m: TeamWorkspaceMember) => (
                    m.role !== 'owner' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        style={{ color: 'var(--ui-danger)', padding: 6 }}
                        onClick={() => { if (confirm(`Remove ${m.username || m.full_name || `user ${m.user_id}`}?`)) removeMutation.mutate(m.user_id) }}
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 size={14} />
                      </Button>
                    ) : null
                  )},
                ]}
                keyExtractor={(m: TeamWorkspaceMember) => m.user_id}
              />
            )}
          </Card>

          <Dialog
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            title="Invite Member"
          >
            <Field label="Telegram User ID or Username" hint="Enter the Telegram user ID or @username to invite.">
              <Input
                value={inviteIdentifier}
                onChange={e => setInviteIdentifier(e.target.value)}
                placeholder="@username or 123456789"
              />
            </Field>
            <Field label="Role">
              <Select value={inviteRole} onChange={e => setInviteRole(e.target.value as WorkspaceRole)}>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </Select>
            </Field>
            {inviteMutation.isError && (
              <InlineMessage tone="destructive">{(inviteMutation.error as any)?.response?.data?.detail || 'Failed to invite member'}</InlineMessage>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={() => inviteMutation.mutate()} disabled={!inviteIdentifier.trim() || inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Inviting...' : 'Invite'}
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </PageShell>
  )
}
