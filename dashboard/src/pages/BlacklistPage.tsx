import { useState, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Shield, Plus, Trash2, Phone, User, Loader } from 'lucide-react'

import { Badge, Button, Card, Dialog, Field, Input, Select } from '../components/ui/primitives'
import { DataTable, type ColumnDef } from '../components/ui/data-table'
import { useI18n } from '../lib/i18n'
import { PageShell } from '../lib/page-shell'
import { useToast } from '../components/ui/toast'
import api, { fetchAgents, fetchBlacklist, addBlacklistEntry, deleteBlacklistEntry } from '../lib/api'
import { spacing, uiVars, typeScale } from '../../../shared/ui-system/tokens'
import type { Agent } from '../lib/types'

interface BlacklistEntry {
  id: number
  agent_id: number
  tg_user_id: number | null
  username: string | null
  phone: string | null
  reason: string
  created_by: number | null
  created_at: string | null
}

export default function BlacklistPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['blacklist', selectedAgentId, page],
    queryFn: () => fetchBlacklist(selectedAgentId!, page),
    enabled: !!selectedAgentId,
  })

  const deleteMutation = useMutation({
    mutationFn: (entryId: number) => deleteBlacklistEntry(selectedAgentId!, entryId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blacklist', selectedAgentId] }); toast.success('Entry deleted') },
    onError: (err: any) => toast.error(err?.message || 'Delete failed'),
  })

  useEffect(() => { fetchAgents().then(setAgents).catch(() => {}) }, [])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [addUserId, setAddUserId] = useState('')
  const [addUsername, setAddUsername] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addReason, setAddReason] = useState('admin_blocked')

  const addMutation = useMutation({
    mutationFn: () => addBlacklistEntry(selectedAgentId!, { tg_user_id: addUserId ? Number(addUserId) : undefined, username: addUsername || undefined, phone: addPhone || undefined, reason: addReason || 'admin_blocked' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blacklist', selectedAgentId] }); setDialogOpen(false); setAddUserId(''); setAddUsername(''); setAddPhone(''); setAddReason('admin_blocked'); toast.success('Entry added') },
    onError: (err: any) => toast.error(err?.message || 'Add failed'),
  })

  const columns: ColumnDef<BlacklistEntry>[] = [
    { key: 'id', label: 'ID', hideOnMobile: true, render: (e) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>#{e.id}</span> },
    { key: 'user_id', label: 'User ID', render: (e) => e.tg_user_id ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.tg_user_id}</span> : <span style={{ color: uiVars.textMuted, fontSize: 12 }}>—</span> },
    { key: 'username', label: 'Username', render: (e) => e.username ? <span>@{e.username}</span> : <span style={{ color: uiVars.textMuted, fontSize: 12 }}>—</span> },
    { key: 'phone', label: 'Phone', hideOnMobile: true, render: (e) => e.phone ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={12} />{e.phone}</div> : <span style={{ color: uiVars.textMuted, fontSize: 12 }}>—</span> },
    { key: 'reason', label: 'Reason', hideOnMobile: true, render: (e) => <span style={{ fontSize: 13 }}>{e.reason}</span> },
    { key: 'created_at', label: 'Added', render: (e) => <span style={{ fontSize: 12, color: uiVars.textMuted }}>{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</span> },
    { key: 'actions', label: '', render: (e) => (
      <Button variant="ghost" size="sm" style={{ color: uiVars.danger }} onClick={() => { if (confirm('Remove this entry?')) deleteMutation.mutate(e.id) }} disabled={deleteMutation.isPending}><Trash2 size={14} /></Button>
    )},
  ]

  return (
    <PageShell title="Blacklist" description="Manage blocked users for each agent." loading={false}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.lg }}>
        <div style={{ minWidth: 220, flex: '1 1 220px' }}>
          <Select value={selectedAgentId ?? ''} onChange={(e) => { setSelectedAgentId(e.target.value ? Number(e.target.value) : null); setPage(1) }}>
            <option value="">Select agent...</option>
            {agents.map((a) => (<option key={a.id} value={a.id}>{a.external_account_id || `Agent ${a.id}`}</option>))}
          </Select>
        </div>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setDialogOpen(true)} disabled={!selectedAgentId}><Plus size={14} /> Add Entry</Button>
      </div>

      {!selectedAgentId ? (
        <Card><div style={{ padding: spacing.xl, textAlign: 'center', fontSize: 13, color: uiVars.textMuted }}>Select an agent to view its blacklist.</div></Card>
      ) : (
        <DataTable<BlacklistEntry>
          columns={columns} data={data?.entries || []} keyExtractor={(e) => e.id} loading={isLoading}
          searchPlaceholder="Search entries..." title="Blacklist Entries"
          subtitle={`${data?.total || 0} entries for ${agents.find(a => a.id === selectedAgentId)?.external_account_id || `agent #${selectedAgentId}`}`}
        />
      )}

      <Dialog open={dialogOpen} title="Add Blacklist Entry" onClose={() => setDialogOpen(false)}>
        <Field label="User ID" hint="Telegram user ID">
          <Input type="number" value={addUserId} onChange={(e) => setAddUserId(e.target.value)} placeholder="123456789" />
        </Field>
        <Field label="Username">
          <Input value={addUsername} onChange={(e) => setAddUsername(e.target.value)} placeholder="@username" />
        </Field>
        <Field label="Phone">
          <Input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="+1234567890" />
        </Field>
        <Field label="Reason">
          <Input value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="spam, abuse, etc." />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => addMutation.mutate()} disabled={addMutation.isPending || (!addUserId && !addUsername && !addPhone)}>
            {addMutation.isPending ? 'Adding...' : 'Add Entry'}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
