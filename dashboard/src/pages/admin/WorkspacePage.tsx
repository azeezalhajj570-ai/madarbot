import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, UserPlus } from 'lucide-react'

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
  createWorkspaceInvitation,
  removeTeamWorkspaceMember,
  changeTeamWorkspaceMemberRole,
} from '../../lib/api'
import type { TeamWorkspaceMember, WorkspaceRole } from '../../lib/types'

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
        data={members}
        total={members.length}
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
            render: (m: TeamWorkspaceMember) => (
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
            render: (m: TeamWorkspaceMember) =>
              isOwner && m.role !== 'owner' ? (
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
                <Badge tone={m.role === 'owner' ? 'success' : 'neutral'}>{t(`workspace.role.${m.role}`)}</Badge>
              ),
          },
          {
            key: 'joined_at',
            label: t('workspace.joinedAt'),
            hideOnMobile: true,
            render: (m: TeamWorkspaceMember) => (
              <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
                {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : ''}
              </span>
            ),
          },
          {
            key: 'actions',
            label: '',
            hideOnMobile: true,
            render: (m: TeamWorkspaceMember) =>
              canManageMembers && m.role !== 'owner' && m.tg_user_id !== user?.id ? (
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
              ) : null,
          },
        ]}
        keyExtractor={(m: TeamWorkspaceMember) => m.user_id}
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
