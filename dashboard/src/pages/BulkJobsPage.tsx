import { ActionBar, Badge, Button, Card, Field, FieldRow, Input, Select, Sheet, Table } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'
import { useState } from 'react'

const JOBS = [
  { id: 'job-101', source: 'Invest Community', target: 'Trading AR', total: '120', status: <Badge tone="success">running</Badge> },
  { id: 'job-102', source: 'Alpha Signals', target: 'Owner Lab', total: '84', status: <Badge tone="warning">queued</Badge> },
  { id: 'job-103', source: 'Owner Lab', target: 'Invest Community', total: '31', status: <Badge tone="destructive">failed</Badge> },
]

export default function BulkJobsPage() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <PageShell titleKey="page.jobs" descriptionKey="page.jobs.desc" actions={<Button onClick={() => setOpen(true)}>New job</Button>}>
      <Card>
        <Table
          columns={[
            { key: 'id', label: 'ID', hideOnMobile: true, render: (j: any) => j.id },
            { key: 'source', label: 'Source', hideOnMobile: true, render: (j: any) => j.source },
            { key: 'target', label: 'Target', render: (j: any) => j.target },
            { key: 'total', label: 'Total', render: (j: any) => j.total },
            { key: 'status', label: 'Status', render: (j: any) => j.status },
          ]}
          data={JOBS}
          keyExtractor={(j: any) => j.id}
        />
      </Card>
      <Sheet
        open={open}
        title="New member job"
        description="Desktop adds capacity details while staying aligned with the Mini App’s single primary action workflow."
        onClose={() => setOpen(false)}
        footer={<ActionBar secondary={<Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>} primary={<Button onClick={() => setOpen(false)}>Create job</Button>} />}
      >
        <FieldRow>
          <Field label="Source group"><Input placeholder="Invest Community" /></Field>
          <Field label="Target group"><Input placeholder="Trading AR" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Member limit"><Input placeholder="120" type="number" /></Field>
          <Field label="Mode">
            <Select defaultValue="safe">
              <option value="safe">Safe defaults</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </Select>
          </Field>
        </FieldRow>
      </Sheet>
    </PageShell>
  )
}
