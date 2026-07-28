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
    <PageShell titleKey="page.jobs" descriptionKey="page.jobs.desc" actions={<Button onClick={() => setOpen(true)}>{t('bulkjobs.newJob')}</Button>}>
      <Card>
        <Table
          columns={[
            { key: 'id', label: t('bulkjobs.id'), hideOnMobile: true, render: (j: any) => j.id },
            { key: 'source', label: t('bulkjobs.source'), hideOnMobile: true, render: (j: any) => j.source },
            { key: 'target', label: t('bulkjobs.target'), render: (j: any) => j.target },
            { key: 'total', label: t('bulkjobs.total'), render: (j: any) => j.total },
            { key: 'status', label: t('bulkjobs.status'), render: (j: any) => j.status },
          ]}
          data={JOBS}
          keyExtractor={(j: any) => j.id}
        />
      </Card>
      <Sheet
        open={open}
        title={t('bulkjobs.newJobTitle')}
        description={t("bulkjobs.sheetDesc")}
        onClose={() => setOpen(false)}
        footer={<ActionBar secondary={<Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>} primary={<Button onClick={() => setOpen(false)}>{t('bulkjobs.createJob')}</Button>} />}
      >
        <FieldRow>
          <Field label={t('bulkjobs.sourceGroup')}><Input placeholder="Invest Community" /></Field>
          <Field label={t('bulkjobs.targetGroup')}><Input placeholder="Trading AR" /></Field>
        </FieldRow>
        <FieldRow>
          <Field label={t('bulkjobs.memberLimit')}><Input placeholder="120" type="number" /></Field>
          <Field label={t('bulkjobs.mode')}>
            <Select defaultValue="safe">
              <option value="safe">{t('bulkjobs.safeDefaults')}</option>
              <option value="balanced">{t('bulkjobs.balanced')}</option>
              <option value="aggressive">{t('bulkjobs.aggressive')}</option>
            </Select>
          </Field>
        </FieldRow>
      </Sheet>
    </PageShell>
  )
}
