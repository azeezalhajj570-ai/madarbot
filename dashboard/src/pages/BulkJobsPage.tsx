import { ActionBar, Badge, Button, Card, Field, FieldRow, Input, Select, Sheet, Table } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'
import { useState } from 'react'

const JOBS = [
  ['job-101', 'Invest Community', 'Trading AR', '120', <Badge tone="success">running</Badge>],
  ['job-102', 'Alpha Signals', 'Owner Lab', '84', <Badge tone="warning">queued</Badge>],
  ['job-103', 'Owner Lab', 'Invest Community', '31', <Badge tone="destructive">failed</Badge>],
]

export default function BulkJobsPage() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <PageShell eyebrow="Jobs" titleKey="page.jobs" descriptionKey="page.jobs.desc" actions={<Button onClick={() => setOpen(true)}>New job</Button>}>
      <Card>
        <Table columns={['ID', 'Source', 'Target', 'Total', 'Status']} rows={JOBS} />
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
