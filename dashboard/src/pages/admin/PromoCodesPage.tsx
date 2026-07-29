import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'

import { Badge, Button, Dialog, Field, FieldRow, Input, Select, ToggleRow } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
import { DataTable } from '../../components/ui/data-table'
import { PageShell } from '../../lib/page-shell'
import {
  fetchOwnerPromoCodes, createOwnerPromoCode, updateOwnerPromoCode, deleteOwnerPromoCode,
} from '../../lib/api'
import { useToast } from '../../components/ui/toast'
import { getStoredUser } from '../../lib/auth'

export default function AdminPromoCodesPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--ui-text-muted)' }}>{t('common.accessDenied')}</div>
      </PageShell>
    )
  }
  const { toast } = useToast()
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
      toast.success(t('promocode.created'))
    },
    onError: () => {
      toast.error(t('promocode.createError'))
    }
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: any }) => updateOwnerPromoCode(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteOwnerPromoCode(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'promos'] })
      toast.success(t('promocode.deleted'))
    },
    onError: () => {
      toast.error(t('promocode.deleteError'))
    }
  })

  return (
    <PageShell titleKey="page.admin.promocodes" descriptionKey="page.admin.promocodes.desc" loading={false}>
      <DataTable
        data={promos || []}
        total={(promos || []).length}
        loading={isLoading}
        title={t('promocode.title')}
        subtitle={t('promocode.desc')}
        searchPlaceholder={t('promocode.searchPlaceholder')}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={16} /> {t('promocode.create')}
          </Button>
        }
        columns={[
          { key: 'code', label: t('promocode.code'), render: (p: any) => <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14 }}>{p.code}</span> },
          { key: 'plan', label: t('promocode.plan'), hideOnMobile: true, render: (p: any) => <Badge tone={p.plan === 'business' ? 'success' : 'neutral'}>{p.plan}</Badge> },
          { key: 'duration', label: t('promocode.duration'), hideOnMobile: true, render: (p: any) => <span style={{ fontWeight: 600 }}>{p.duration_days} {t('promocode.days')}</span> },
          { key: 'usage', label: t('promocode.usage'), render: (p: any) => <span>{p.used_count} / {p.max_uses || '∞'}</span> },
          { key: 'active', label: t('promocode.active'), render: (p: any) => (
            <ToggleRow title="" subtitle="" checked={p.is_active}
              onCheckedChange={(checked) => updateMutation.mutate({ id: p.id, payload: { is_active: checked } })}
              disabled={updateMutation.isPending}
            />
          )},
          { key: 'actions', label: '', hideOnMobile: true, render: (p: any) => (
            <Button size="sm" variant="outline"
              onClick={() => { if (confirm(t('promocode.deleteConfirm'))) deleteMutation.mutate(p.id) }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 size={14} />
            </Button>
          )},
        ]}
        keyExtractor={(p: any) => p.id}
      />

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('promocode.create')}
        description={t('promocode.desc')}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <FieldRow>
            <Field label={t('promocode.codeName')} hint={t('promocode.codeNameHint')}>
              <Input
                value={newPromo.code}
                onChange={(e) => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                placeholder={t('promocode.codePlaceholder')}
              />
            </Field>
            <Field label={t('promocode.plan')} hint={t('promocode.planHint')}>
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
            <Field label={t('promocode.durationDays')} hint={t('promocode.durationHint')}>
              <Input
                type="number"
                value={newPromo.duration_days}
                onChange={(e) => setNewPromo({ ...newPromo, duration_days: parseInt(e.target.value) || 1 })}
              />
            </Field>
            <Field label={t('promocode.maxUses')} hint={t('promocode.maxUsesHint')}>
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
            {createMutation.isPending ? t('promocode.creating') : t('promocode.createCode')}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
