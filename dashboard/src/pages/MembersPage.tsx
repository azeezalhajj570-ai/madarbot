import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, Shield, Crown, Mail, Check, X, RotateCcw, Ban } from 'lucide-react'

import { Badge, Button, Card, CardSkeleton, Dialog, EmptyState, Field, Input, Select, InlineMessage } from '../components/ui/primitives'
import { DataTable } from '../components/ui/data-table'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'
import { useToast } from '../components/ui/toast'
import {
  fetchTeamWorkspaces,
  fetchTeamWorkspaceMembers,
  createWorkspaceInvitation,
  fetchWorkspaceInvitations,
  fetchPendingInvitations,
  acceptInvitation,
  declineInvitation,
  revokeWorkspaceInvitation,
  resendWorkspaceInvitation,
  removeTeamWorkspaceMember,
  changeTeamWorkspaceMemberRole,
} from '../lib/api'
import type { TeamWorkspace, TeamWorkspaceMember, WorkspaceRole, WorkspaceInvitation, PendingInvitation } from '../lib/types'

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }
const ROLE_TONES: Record<string, 'success' | 'warning' | 'default' | 'neutral'> = { owner: 'success', admin: 'warning', member: 'default', viewer: 'neutral' }

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', revoked: 'Revoked',
}
const STATUS_TONES: Record<string, 'success' | 'warning' | 'default' | 'neutral' | 'destructive'> = {
  pending: 'warning', accepted: 'success', declined: 'neutral', expired: 'neutral', revoked: 'destructive',
}

interface MemberRow {
  user_id: number
  tg_user_id: number | null
  username: string | null
  full_name: string | null
  role: WorkspaceRole
  joined_at: string | null
  invite_status?: string | null
  invite_token?: string | null
}

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
  const currentWs = workspaces.find(w => w.id === activeWs)
  const canManageInvitations = currentWs?.role === 'owner' || currentWs?.role === 'admin'

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members', activeWs],
    queryFn: () => fetchTeamWorkspaceMembers(activeWs!),
    enabled: !!activeWs,
  })

  const { data: sentInvitationsData, isLoading: sentLoading } = useQuery({
    queryKey: ['workspace-invitations', activeWs],
    queryFn: () => fetchWorkspaceInvitations(activeWs!),
    enabled: !!activeWs,
  })

  const { data: pendingInvitationsData } = useQuery({
    queryKey: ['pending-invitations'],
    queryFn: fetchPendingInvitations,
  })

  const members = membersData?.members || []
  const sentInvitations = sentInvitationsData?.invitations || []
  const pendingInvitations = pendingInvitationsData?.invitations || []

  const memberUserIds = new Set(members.map((m: TeamWorkspaceMember) => m.user_id))
  const activeInvitations = sentInvitations.filter(
    (inv: WorkspaceInvitation) => inv.status === 'pending' && !memberUserIds.has(inv.invited_user_id)
  )

  const displayRows: MemberRow[] = [
    ...members.map((m: TeamWorkspaceMember) => ({ ...m, invite_status: null, invite_token: null })),
    ...activeInvitations.map((inv: WorkspaceInvitation) => ({
      user_id: inv.invited_user_id,
      tg_user_id: null,
      username: inv.invited_username,
      full_name: inv.invited_full_name,
      role: inv.role,
      joined_at: null,
      invite_status: 'pending',
      invite_token: inv.token,
    })),
  ]

  const inviteMutation = useMutation({
    mutationFn: () => createWorkspaceInvitation(activeWs!, inviteIdentifier, inviteRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations', activeWs] })
      setInviteOpen(false)
      setInviteIdentifier('')
      setInviteRole('member')
      toast.success('Invitation sent')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to send invitation')
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

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokeWorkspaceInvitation(activeWs!, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations', activeWs] })
      toast.success('Invitation revoked')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to revoke invitation')
    },
  })

  const resendMutation = useMutation({
    mutationFn: (token: string) => resendWorkspaceInvitation(activeWs!, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations', activeWs] })
      toast.success('Invitation resent')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to resend invitation')
    },
  })

  const acceptMutation = useMutation({
    mutationFn: (token: string) => acceptInvitation(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-invitations'] })
      queryClient.invalidateQueries({ queryKey: ['team-workspaces'] })
      toast.success('Invitation accepted')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to accept invitation')
    },
  })

  const declineMutation = useMutation({
    mutationFn: (token: string) => declineInvitation(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-invitations'] })
      toast.success('Invitation declined')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || 'Failed to decline invitation')
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

          <Card title={currentWs?.name || 'Workspace'} subtitle={`${displayRows.length} members`}>
            {membersLoading ? (
              <CardSkeleton />
            ) : displayRows.length === 0 ? (
              <EmptyState title="No members" subtitle="Invite members to collaborate." />
            ) : (
              <DataTable
                data={displayRows}
                total={displayRows.length}
                columns={[
                  { key: 'identity', label: 'User', render: (m: MemberRow) => (
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
                  { key: 'role', label: 'Role', render: (m: MemberRow) => (
                    m.role === 'owner' ? (
                      <Badge tone="success">{ROLE_LABELS[m.role]}</Badge>
                    ) : m.invite_status ? (
                      <Badge tone={ROLE_TONES[m.role] || 'default'}>{ROLE_LABELS[m.role] || m.role}</Badge>
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
                  { key: 'status', label: 'Status', hideOnMobile: true, render: (m: MemberRow) => (
                    m.invite_status ? (
                      <Badge tone="warning">{STATUS_LABELS[m.invite_status] || m.invite_status}</Badge>
                    ) : (
                      <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>Active</span>
                    )
                  )},
                  { key: 'joined', label: 'Joined', hideOnMobile: true, render: (m: MemberRow) => (
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                      {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                    </span>
                  )},
                  { key: 'actions', label: '', render: (m: MemberRow) => (
                    m.role !== 'owner' && canManageInvitations ? (
                      m.invite_token ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          style={{ color: 'var(--ui-danger)', padding: 6 }}
                          onClick={() => { if (confirm(`Revoke invitation for ${m.username || m.full_name || `user ${m.user_id}`}?`)) revokeMutation.mutate(m.invite_token!) }}
                          disabled={revokeMutation.isPending}
                          title="Revoke"
                        >
                          <Ban size={14} />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          style={{ color: 'var(--ui-danger)', padding: 6 }}
                          onClick={() => { if (confirm(`Remove ${m.username || m.full_name || `user ${m.user_id}`}?`)) removeMutation.mutate(m.user_id) }}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )
                    ) : null
                  )},
                ]}
                keyExtractor={(m: MemberRow) => m.user_id}
              />
            )}
          </Card>

          <Card
              title="Sent Invitations"
              subtitle={`${sentInvitations.length} invitations`}
            >
              {sentLoading ? (
                <CardSkeleton />
              ) : sentInvitations.length === 0 ? (
                <EmptyState title="No invitations" subtitle="Invitations you've sent will appear here." />
              ) : (
                <DataTable
                  data={sentInvitations}
                  total={sentInvitations.length}
                  columns={[
                    { key: 'user', label: 'Invited User', render: (inv: WorkspaceInvitation) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>{inv.invited_full_name || inv.invited_username || `User ${inv.invited_user_id}`}</div>
                        <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{inv.invited_username ? `@${inv.invited_username}` : `ID: ${inv.invited_user_id}`}</div>
                      </div>
                    )},
                    { key: 'role', label: 'Role', render: (inv: WorkspaceInvitation) => (
                      <Badge tone={ROLE_TONES[inv.role] || 'default'}>{ROLE_LABELS[inv.role] || inv.role}</Badge>
                    )},
                    { key: 'status', label: 'Status', render: (inv: WorkspaceInvitation) => (
                      <Badge tone={STATUS_TONES[inv.status] || 'default'}>{STATUS_LABELS[inv.status] || inv.status}</Badge>
                    )},
                    { key: 'created', label: 'Sent', hideOnMobile: true, render: (inv: WorkspaceInvitation) => (
                      <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                        {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : '—'}
                      </span>
                    )},
                    { key: 'expires', label: 'Expires', hideOnMobile: true, render: (inv: WorkspaceInvitation) => (
                      <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                        {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}
                      </span>
                    )},
                    { key: 'actions', label: '', render: (inv: WorkspaceInvitation) => (
                      inv.status === 'pending' && canManageInvitations ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            style={{ padding: 6 }}
                            onClick={() => resendMutation.mutate(inv.token)}
                            disabled={resendMutation.isPending}
                            title="Resend"
                          >
                            <RotateCcw size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            style={{ color: 'var(--ui-danger)', padding: 6 }}
                            onClick={() => { if (confirm('Revoke this invitation?')) revokeMutation.mutate(inv.token) }}
                            disabled={revokeMutation.isPending}
                            title="Revoke"
                          >
                            <Ban size={14} />
                          </Button>
                        </div>
                      ) : null
                    )},
                  ]}
                  keyExtractor={(inv: WorkspaceInvitation) => inv.id}
                />
              )}
            </Card>

          {pendingInvitations.length > 0 && (
            <Card
              title="My Pending Invitations"
              subtitle={`${pendingInvitations.length} invitation(s) awaiting your response`}
            >
              <DataTable
                data={pendingInvitations}
                total={pendingInvitations.length}
                columns={[
                  { key: 'workspace', label: 'Workspace', render: (inv: PendingInvitation) => (
                    <div style={{ fontWeight: 600 }}>{inv.workspace_name}</div>
                  )},
                  { key: 'inviter', label: 'Invited By', render: (inv: PendingInvitation) => (
                    <span style={{ fontSize: 13 }}>
                      {inv.inviter_full_name || inv.inviter_username || 'Unknown'}
                    </span>
                  )},
                  { key: 'role', label: 'Role', render: (inv: PendingInvitation) => (
                    <Badge tone={ROLE_TONES[inv.role] || 'default'}>{ROLE_LABELS[inv.role] || inv.role}</Badge>
                  )},
                  { key: 'expires', label: 'Expires', hideOnMobile: true, render: (inv: PendingInvitation) => (
                    <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                      {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}
                    </span>
                  )},
                  { key: 'actions', label: '', render: (inv: PendingInvitation) => (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        onClick={() => acceptMutation.mutate(inv.token)}
                        disabled={acceptMutation.isPending}
                        style={{ background: 'var(--ui-success)', color: '#fff' }}
                      >
                        <Check size={14} /> Accept
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => declineMutation.mutate(inv.token)}
                        disabled={declineMutation.isPending}
                      >
                        <X size={14} /> Decline
                      </Button>
                    </div>
                  )},
                ]}
                keyExtractor={(inv: PendingInvitation) => inv.id}
              />
            </Card>
          )}

          <Dialog
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            title="Invite Member"
          >
            <Field label="Telegram Username or Phone" hint="Enter @username, username, or +phone number to invite.">
              <Input
                value={inviteIdentifier}
                onChange={e => setInviteIdentifier(e.target.value)}
                placeholder="@username or +1234567890"
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
              <InlineMessage tone="destructive">{(inviteMutation.error as any)?.response?.data?.detail || 'Failed to send invitation'}</InlineMessage>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button onClick={() => inviteMutation.mutate()} disabled={!inviteIdentifier.trim() || inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Sending...' : 'Send Invitation'}
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </PageShell>
  )
}
