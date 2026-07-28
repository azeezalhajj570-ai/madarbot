import { useState } from 'react'

import { ActionBar, Badge, Button, Card, Field, Input, Select, Sheet } from '../components/ui/primitives'
import { DataTable } from '../components/ui/data-table'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'

const MEMBERS = [
  { name: 'Ali Hassan', username: '@ali_h', role: 'owner', joinedAt: '2026-01-01' },
  { name: 'Mona Saleh', username: '@mona_s', role: 'admin', joinedAt: '2026-01-14' },
  { name: 'Fahad Omar', username: '@fahad_o', role: 'member', joinedAt: '2026-02-03' },
  { name: 'Sara Noor', username: '@sara_n', role: 'banned', joinedAt: '2026-02-19' },
]

export default function MembersPage() {
  const { t } = useI18n()
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <PageShell titleKey="page.members" descriptionKey="page.members.desc" actions={<Button onClick={() => setSheetOpen(true)}>{t('members.bulkActions')}</Button>}>
      <DataTable
        data={MEMBERS}
        total={MEMBERS.length}
        searchPlaceholder={t('members.searchPlaceholder')}
        filters={[
          { key: 'role', label: t('members.role'), options: [
            { value: '', label: t('members.allRoles') },
            { value: 'owner', label: t('members.owner') },
            { value: 'admin', label: t('members.admin') },
            { value: 'member', label: t('members.member') },
            { value: 'banned', label: t('members.banned') },
          ]},
        ]}
        columns={[
          { key: 'name', label: t('members.name'), render: (member: any) => member.name },
          { key: 'username', label: t('members.username'), render: (member: any) => member.username },
          { key: 'role', label: t('members.role'), render: (member: any) => (
            <Badge tone={member.role === 'banned' ? 'destructive' : member.role === 'admin' || member.role === 'owner' ? 'warning' : 'default'}>
              {member.role}
            </Badge>
          )},
          { key: 'joined', label: t('members.joined'), hideOnMobile: true, render: (member: any) => member.joinedAt },
          { key: 'actions', label: t('members.actions'), hideOnMobile: true, render: () => (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline">{t('members.warn')}</Button>
              <Button variant="outline">{t('members.mute')}</Button>
              <Button variant="destructive">{t('members.ban')}</Button>
            </div>
          )},
        ]}
        keyExtractor={(_: any, i: number) => i}
      />
      <Sheet
        open={sheetOpen}
        title={t('members.bulkAction')}
        onClose={() => setSheetOpen(false)}
        footer={<ActionBar secondary={<Button variant="outline" onClick={() => setSheetOpen(false)}>{t('members.bulkCancel')}</Button>} primary={<Button onClick={() => setSheetOpen(false)}>{t('members.bulkApply')}</Button>} />}
      >
        <Field label={t('members.memberIds')} hint={t('members.memberIdsHint')}>
          <Input placeholder={t('members.memberIdsPlaceholder')} />
        </Field>
        <Field label={t('members.actionLabel')}>
          <Select defaultValue="warn">
            <option value="warn">{t('members.warn')}</option>
            <option value="mute">{t('members.mute')}</option>
            <option value="ban">{t('members.ban')}</option>
          </Select>
        </Field>
      </Sheet>
    </PageShell>
  )
}
