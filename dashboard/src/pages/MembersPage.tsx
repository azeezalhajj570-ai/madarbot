import { useMemo, useState } from 'react'

import { ActionBar, Badge, Button, Card, Field, Input, Select, Sheet, Table } from '../components/ui/primitives'
import { FilterSelect, SearchInput, Toolbar } from '../components/ui/data-display'
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
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sheetOpen, setSheetOpen] = useState(false)

  const filteredMembers = useMemo(() => {
    return MEMBERS.filter((member) => {
      const matchesQuery =
        !query ||
        member.name.toLowerCase().includes(query.toLowerCase()) ||
        member.username.toLowerCase().includes(query.toLowerCase())
      const matchesFilter = filter === 'all' ? true : member.role === filter
      return matchesQuery && matchesFilter
    })
  }, [filter, query])

  return (
    <PageShell titleKey="page.members" descriptionKey="page.members.desc" actions={<Button onClick={() => setSheetOpen(true)}>Bulk actions</Button>}>
      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search members" style={{ flex: 1 }} />
        <FilterSelect
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'admin', label: 'Admins' },
            { value: 'banned', label: 'Banned' },
          ]}
        />
      </Toolbar>
      <Card>
        <Table
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
          data={filteredMembers}
          keyExtractor={(_: any, i: number) => i}
        />
      </Card>
      <Sheet
        open={sheetOpen}
        title="Bulk member action"
        description="Bulk member flows use the same action order and confirmation-ready structure as the rest of the product."
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
