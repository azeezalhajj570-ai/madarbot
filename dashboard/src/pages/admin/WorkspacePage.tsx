import { useEffect, useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, UserPlus, Ban } from 'lucide-react'

import { Badge, Button, Dialog, Field, Select, Input } from '../../components/ui/primitives'
import { DataTable } from '../../components/ui/data-table'
import { useI18n } from '../../lib/i18n'
import { PageShell } from '../../lib/page-shell'
import { useToast } from '../../components/ui/toast'
import { getStoredUser } from '../../lib/auth'
import {
  fetchTeamWorkspaces,
  createTeamWorkspace,
  fetchTeamWorkspaceMembers,
  fetchWorkspaceInvitations,
  createWorkspaceInvitation,
  revokeWorkspaceInvitation,
  acceptInvitation,
  removeTeamWorkspaceMember,
  changeTeamWorkspaceMemberRole,
} from '../../lib/api'
import type { TeamWorkspaceMember, WorkspaceInvitation, WorkspaceRole } from '../../lib/types'

function errorDetail(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

const ROLE_OPTIONS: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer']

export default function AdminWorkspacePage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const user = getStoredUser()

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteIdentifier, setInviteIdentifier] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member')
  const [accepting, setAccepting] = useState(false)
  const [acceptResult, setAcceptResult] = useState<{ ok: boolean; message: string } | null>(null)
  const acceptHandled = useRef(false)

  useEffect(() => {
    if (acceptHandled.current) return
    const hash = window.location.hash
    const match = hash.match(/accept=([a-f0-9]+)/)
    if (match) {
      const token = match[1]
      acceptHandled.current = true
      setAccepting(true)
      acceptInvitation(token)
        .then((res) => {
          setAcceptResult({ ok: true, message: `Joined "${res.workspace_name}" as ${res.role}` })
          queryClient.invalidateQueries({ queryKey: ['workspaces'] })
        })
        .catch((err) => {
          const msg = err?.response?.data?.detail || 'Failed to accept invitation'
          setAcceptResult({ ok: false, message: msg })
        })
        .finally(() => {
          setAccepting(false)
          window.history.replaceState(null, '', window.location.pathname + '#/workspace')
        })
    }
  }, [])

  const { data: workspacesData, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: fetchTeamWorkspaces,
  })
  const workspaces = workspacesData?.workspaces || []

  useEffect(() => {
    if (activeWorkspaceId === null && workspaces.length > 0) {
      const owned = workspaces.find((w) => w.role === 'owner')
      setActiveWorkspaceId((owned || workspaces[0]).id)
    }
  }, [workspaces, activeWorkspaceId])

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members', activeWorkspaceId],
    queryFn: () => fetchTeamWorkspaceMembers(activeWorkspaceId as number),
    enabled: activeWorkspaceId !== null,
  })
  const members = membersData?.members || []

  const { data: invitationsData } = useQuery({
    queryKey: ['workspace-invitations', activeWorkspaceId],
    queryFn: () => fetchWorkspaceInvitations(activeWorkspaceId as number),
    enabled: activeWorkspaceId !== null,
  })
  const sentInvitations = invitationsData?.invitations || []

  const canManageMembers = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin'
  const isOwner = activeWorkspace?.role === 'owner'

  const createMutation = useMutation({
    mutationFn: (name: string) => createTeamWorkspace(name),
    onSuccess: (workspace) => {
      setCreateOpen(false)
      setNewWorkspaceName('')
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setActiveWorkspaceId(workspace.id)
      toast.success(t('workspace.created'))
    },
    onError: (error) => toast.error(errorDetail(error, t('workspace.createError'))),
  })

  const inviteMutation = useMutation({
    mutationFn: () =>
      createWorkspaceInvitation(activeWorkspaceId as number, inviteIdentifier.trim(), inviteRole),
    onSuccess: () => {
      setInviteOpen(false)
      setInviteIdentifier('')
      setInviteRole('member')
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWorkspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations', activeWorkspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success(t('workspace.invited'))
    },
    onError: (error) => toast.error(errorDetail(error, t('workspace.inviteError'))),
  })

  const removeMutation = useMutation({
    mutationFn: (memberUserId: number) =>
      removeTeamWorkspaceMember(activeWorkspaceId as number, memberUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWorkspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast.success(t('workspace.removed'))
    },
    onError: (error) => toast.error(errorDetail(error, t('workspace.removeError'))),
  })

  const roleMutation = useMutation({
    mutationFn: ({ memberUserId, role }: { memberUserId: number; role: WorkspaceRole }) =>
      changeTeamWorkspaceMemberRole(activeWorkspaceId as number, memberUserId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', activeWorkspaceId] })
      toast.success(t('workspace.roleChanged'))
    },
    onError: (error) => toast.error(errorDetail(error, t('workspace.roleChangeError'))),
  })

  const revokeMutation = useMutation({
    mutationFn: (token: string) => revokeWorkspaceInvitation(activeWorkspaceId as number, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-invitations', activeWorkspaceId] })
      toast.success('Invitation revoked')
    },
    onError: (error) => toast.error(errorDetail(error, 'Failed to revoke invitation')),
  })

  const memberUserIds = new Set(members.map((m) => m.user_id))
  const activeInvitations = sentInvitations.filter(
    (inv) => inv.status === 'pending' && !memberUserIds.has(inv.invited_user_id)
  )

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

  const displayRows: MemberRow[] = [
    ...members.map((m) => ({ ...m, invite_status: null, invite_token: null })),
    ...activeInvitations.map((inv) => ({
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

  return (
    <PageShell
      titleKey="page.admin.workspace"
      descriptionKey="page.admin.workspace.desc"
      loading={workspacesLoading}
      actions={
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> {t('workspace.createWorkspace')}
        </Button>
      }
    >
      {accepting && (
        <div style={{ padding: '16px 20px', marginBottom: 16, borderRadius: 8, background: 'var(--ui-bg-muted)', color: 'var(--ui-text-muted)', fontSize: 14 }}>
          Joining workspace...
        </div>
      )}
      {acceptResult && (
        <div style={{
          padding: '16px 20px', marginBottom: 16, borderRadius: 8, fontSize: 14,
          background: acceptResult.ok ? 'var(--ui-success-bg, #e6f9e6)' : 'var(--ui-danger-bg, #fde8e8)',
          color: acceptResult.ok ? 'var(--ui-success, #16a34a)' : 'var(--ui-danger, #dc2626)',
        }}>
          {acceptResult.ok ? '✓ ' : '✕ '}{acceptResult.message}
        </div>
      )}
      {workspaces.length > 1 && (
        <div style={{ marginBottom: 20, maxWidth: 320 }}>
          <Field label={t('workspace.switchWorkspace')}>
            <Select
              value={String(activeWorkspaceId ?? '')}
              onChange={(e) => setActiveWorkspaceId(Number(e.target.value))}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({t(`workspace.role.${w.role}`)})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {activeWorkspace && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
          <Badge tone="neutral">{activeWorkspace.name}</Badge>
          <Badge tone={isOwner ? 'success' : 'neutral'}>{t(`workspace.role.${activeWorkspace.role}`)}</Badge>
          <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
            {activeWorkspace.member_count} {t('workspace.memberCount')}
          </span>
          <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
            {t('workspace.subscriptionPlan')}:{' '}
            {activeWorkspace.subscription?.plan || t('workspace.subscriptionNone')}
          </span>
        </div>
      )}

      <DataTable
        data={displayRows}
        total={displayRows.length}
        loading={membersLoading}
        title={t('workspace.members')}
        subtitle={t('workspace.membersDesc')}
        actions={
          canManageMembers ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus size={16} /> {t('workspace.inviteMember')}
            </Button>
          ) : null
        }
        columns={[
          {
            key: 'member',
            label: t('workspace.members'),
            render: (m: MemberRow) => (
              <div>
                <div style={{ fontWeight: 700 }}>
                  {m.full_name || m.username || m.tg_user_id}
                  {m.tg_user_id === user?.id ? ` (${t('workspace.you')})` : ''}
                </div>
                {m.username ? (
                  <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>@{m.username}</div>
                ) : null}
              </div>
            ),
          },
          {
            key: 'role',
            label: t('workspace.inviteRole'),
            render: (m: MemberRow) =>
              isOwner && m.role !== 'owner' && !m.invite_status ? (
                <Select
                  value={m.role}
                  onChange={(e) =>
                    roleMutation.mutate({ memberUserId: m.user_id, role: e.target.value as WorkspaceRole })
                  }
                  disabled={roleMutation.isPending}
                >
                  {ROLE_OPTIONS.filter((r) => r !== 'owner').map((role) => (
                    <option key={role} value={role}>
                      {t(`workspace.role.${role}`)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone={m.role === 'owner' ? 'success' : m.invite_status ? 'warning' : 'neutral'}>{t(`workspace.role.${m.role}`)}</Badge>
              ),
          },
          {
            key: 'status',
            label: 'Status',
            hideOnMobile: true,
            render: (m: MemberRow) => (
              m.invite_status ? (
                <Badge tone="warning">Pending</Badge>
              ) : (
                <Badge tone="success">Active</Badge>
              )
            ),
          },
          {
            key: 'joined_at',
            label: t('workspace.joinedAt'),
            hideOnMobile: true,
            render: (m: MemberRow) => (
              <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ''}
              </span>
            ),
          },
          {
            key: 'actions',
            label: '',
            hideOnMobile: true,
            render: (m: MemberRow) =>
              canManageMembers && m.role !== 'owner' && m.tg_user_id !== user?.id ? (
                m.invite_token ? (
                  <Button
                    size="sm"
                    variant="outline"
                    style={{ color: 'var(--ui-danger)' }}
                    onClick={() => {
                      if (confirm('Revoke this invitation?')) revokeMutation.mutate(m.invite_token!)
                    }}
                    disabled={revokeMutation.isPending}
                    title="Revoke"
                  >
                    <Ban size={14} />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm(t('workspace.removeMemberConfirm'))) removeMutation.mutate(m.user_id)
                    }}
                    disabled={removeMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </Button>
                )
              ) : null,
          },
        ]}
        keyExtractor={(m: MemberRow) => m.user_id}
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('workspace.createWorkspace')}
        description={t('workspace.createWorkspaceDesc')}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('workspace.newWorkspaceName')}>
            <Input
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder={t('workspace.newWorkspaceNamePlaceholder')}
            />
          </Field>
          <Button
            onClick={() => createMutation.mutate(newWorkspaceName.trim())}
            disabled={createMutation.isPending || !newWorkspaceName.trim()}
          >
            {createMutation.isPending ? t('workspace.creating') : t('workspace.createWorkspace')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('workspace.inviteMember')}
        description={t('workspace.inviteMemberDesc')}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('workspace.inviteIdentifier')}>
            <Input
              value={inviteIdentifier}
              onChange={(e) => setInviteIdentifier(e.target.value)}
              placeholder={t('workspace.inviteIdentifierPlaceholder')}
            />
          </Field>
          <Field label={t('workspace.inviteRole')}>
            <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}>
              {ROLE_OPTIONS.filter((r) => r !== 'owner').map((role) => (
                <option key={role} value={role}>
                  {t(`workspace.role.${role}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            onClick={() => inviteMutation.mutate()}
            disabled={inviteMutation.isPending || !inviteIdentifier.trim()}
          >
            {inviteMutation.isPending ? t('workspace.inviting') : t('workspace.invite')}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
