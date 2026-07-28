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
    <PageShell titleKey="page.members" descriptionKey="page.members.desc" actions={<Button onClick={() => setSheetOpen(true)}>Bulk actions</Button>}>
      <DataTable
        data={MEMBERS}
        total={MEMBERS.length}
        searchPlaceholder="Search members..."
        filters={[
          { key: 'role', label: 'Role', options: [
            { value: '', label: 'All roles' },
            { value: 'owner', label: 'Owner' },
            { value: 'admin', label: 'Admin' },
            { value: 'member', label: 'Member' },
            { value: 'banned', label: 'Banned' },
          ]},
        ]}
        columns={[
          { key: 'name', label: 'Name', render: (member: any) => member.name },
          { key: 'username', label: 'Username', render: (member: any) => member.username },
          { key: 'role', label: 'Role', render: (member: any) => (
            <Badge tone={member.role === 'banned' ? 'destructive' : member.role === 'admin' || member.role === 'owner' ? 'warning' : 'default'}>
              {member.role}
            </Badge>
          )},
          { key: 'joined', label: 'Joined', hideOnMobile: true, render: (member: any) => member.joinedAt },
          { key: 'actions', label: 'Actions', hideOnMobile: true, render: () => (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline">Warn</Button>
              <Button variant="outline">Mute</Button>
              <Button variant="destructive">Ban</Button>
            </div>
          )},
        ]}
        keyExtractor={(_: any, i: number) => i}
      />
      <Sheet
        open={sheetOpen}
        title="Bulk member action"
        onClose={() => setSheetOpen(false)}
        footer={<ActionBar secondary={<Button variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>} primary={<Button onClick={() => setSheetOpen(false)}>Apply action</Button>} />}
      >
        <Field label="Members" hint="Paste member IDs or usernames.">
          <Input placeholder="@ali_h, @mona_s" />
        </Field>
        <Field label="Action">
          <Select defaultValue="warn">
            <option value="warn">Warn</option>
            <option value="mute">Mute</option>
            <option value="ban">Ban</option>
          </Select>
        </Field>
      </Sheet>
    </PageShell>
  )
}
