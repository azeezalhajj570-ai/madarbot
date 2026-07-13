import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'

import {
  Badge, Button, Card, EmptyState, Table, LoadingState,
  Dialog, Field, Input, FieldRow, Select, ToggleRow,
} from '../../components/ui/primitives'
import { PageShell } from '../../lib/page-shell'
import {
  fetchOwnerPromoCodes, createOwnerPromoCode, updateOwnerPromoCode, deleteOwnerPromoCode,
} from '../../lib/api'
import { getStoredUser } from '../../lib/auth'

export default function AdminPromoCodesPage() {
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell eyebrow="Admin" titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newPromo, setNewPromo] = useState({
    code: '',
    plan: 'pro' as 'pro' | 'business',
    duration_days: 30,
    max_uses: 0,
    is_active: true,
  })

  const { data: promos, isLoading } = useQuery({
    queryKey: ['owner', 'promos'],
    queryFn: () => fetchOwnerPromoCodes(),
  })

  const createMutation = useMutation({
    mutationFn: (payload: any) => createOwnerPromoCode(payload),
    onSuccess: () => {
      setDialogOpen(false)
      setNewPromo({ code: '', plan: 'pro', duration_days: 30, max_uses: 0, is_active: true })
      queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => updateOwnerPromoCode(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteOwnerPromoCode(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] }),
  })

  const promoRows = (promos || []).map((p: any) => [
    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14 }}>{p.code}</span>,
    <Badge tone={p.plan === 'business' ? 'success' : 'neutral'}>{p.plan}</Badge>,
    <span style={{ fontWeight: 600 }}>{p.duration_days} days</span>,
    <span>{p.used_count} / {p.max_uses || '∞'}</span>,
    <ToggleRow
      title=""
      subtitle=""
      checked={p.is_active}
      onCheckedChange={(checked) => updateMutation.mutate({ id: p.id, payload: { is_active: checked } })}
      disabled={updateMutation.isPending}
    />,
    <div style={{ display: 'flex', gap: 8 }}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => { if (confirm('Delete this promo code?')) deleteMutation.mutate(p.id) }}
        disabled={deleteMutation.isPending}
      >
        <Trash2 size={14} />
      </Button>
    </div>,
  ])

  return (
    <PageShell eyebrow="Admin" titleKey="page.admin.promocodes" descriptionKey="page.admin.promocodes.desc" loading={false}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus size={16} style={{ marginRight: 8 }} />
          Create Promo Code
        </Button>
      </div>

      <Card title="Promotion Codes" subtitle="Codes users can redeem for trial or paid periods.">
        {isLoading ? (
          <LoadingState />
        ) : promoRows.length > 0 ? (
          <Table
            columns={['Code', 'Plan', 'Duration', 'Usage', 'Active', 'Actions']}
            rows={promoRows}
          />
        ) : (
          <EmptyState title="No codes" subtitle="Create your first promotion code." />
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Create Promo Code"
        description="This code can be shared with users to grant premium access."
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <FieldRow>
            <Field label="Code Name" hint="Alphanumeric (e.g. TRIAL30)">
              <Input
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                placeholder="SUMMER2026"
              />
            </Field>
            <Field label="Plan" hint="Tier to grant">
              <Select
                value={newPromo.plan}
                onChange={(e) => setNewPromo({ ...newPromo, plan: e.target.value as any })}
              >
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </Select>
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Duration (Days)" hint="Length of access">
              <Input
                type="number"
                value={newPromo.duration_days}
                onChange={(e) => setNewPromo({ ...newPromo, duration_days: parseInt(e.target.value) || 1 })}
              />
            </Field>
            <Field label="Max Uses" hint="0 for unlimited">
              <Input
                type="number"
                value={newPromo.max_uses}
                onChange={(e) => setNewPromo({ ...newPromo, max_uses: parseInt(e.target.value) || 0 })}
              />
            </Field>
          </FieldRow>

          <Button
            onClick={() => createMutation.mutate({
              ...newPromo,
              max_uses: newPromo.max_uses > 0 ? newPromo.max_uses : undefined,
            })}
            disabled={createMutation.isPending || !newPromo.code}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Code'}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
