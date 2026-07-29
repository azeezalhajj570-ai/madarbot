import { useState } from 'react'

import { ActionBar, Badge, Button, Card, Field, FieldRow, Input, ListItem, Select, Sheet, Textarea } from '../components/ui/primitives'
import { PageShell } from '../lib/page-shell'
import { useI18n } from '../lib/i18n'

const TASKS = [
  { id: 'task-1', taskType: 'broadcast', executor: 'Agent 7', source: 'Invest Community', status: 'active' },
  { id: 'task-2', taskType: 'auto_reply', executor: 'Bot', source: 'Trading AR', status: 'draft' },
]

export default function AutomationPage() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <PageShell titleKey="page.automation" descriptionKey="page.automation.desc" actions={<Button onClick={() => setOpen(true)}>{t('automation.newTask')}</Button>}>
      <div style={{ display: 'grid', gap: 16 }}>
        {TASKS.map((task) => (
          <Card key={task.id}>
            <ListItem
              title={task.executor}
              subtitle={`${task.source} · ${task.taskType}`}
              meta={<><Badge tone="info">{task.taskType}</Badge><Badge tone={task.status === 'active' ? 'success' : 'warning'}>{task.status}</Badge></>}
              actions={<><Button variant="outline" onClick={() => setOpen(true)}>{t('automation.edit')}</Button><Button variant="destructive">{t('automation.delete')}</Button></>}
            />
          </Card>
        ))}
      </div>
      <Sheet
        open={open}
        title={t('automation.task')}
        description={t('automation.taskSheetDesc')}
        onClose={() => setOpen(false)}
        footer={<ActionBar secondary={<Button variant="outline" onClick={() => setOpen(false)}>{t('automation.cancel')}</Button>} primary={<Button onClick={() => setOpen(false)}>{t('automation.saveTask')}</Button>} />}
      >
        <FieldRow>
          <Field label={t('automation.taskId')}><Input placeholder={t('automation.taskIdPlaceholder')} /></Field>
          <Field label={t('automation.taskType')}>
            <Select defaultValue="broadcast">
              <option value="broadcast">{t('automation.broadcast')}</option>
              <option value="message_forward">{t('automation.messageForward')}</option>
              <option value="auto_reply">{t('automation.autoReply')}</option>
              <option value="lead_notify">{t('automation.leadNotify')}</option>
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label={t('automation.executor')}><Input placeholder={t('automation.executorPlaceholder')} /></Field>
          <Field label={t('automation.sourceGroup')}><Input placeholder={t('automation.sourceGroupPlaceholder')} /></Field>
        </FieldRow>
        <Field label={t('automation.messageTemplate')}><Textarea placeholder={t('automation.messageTemplate')} /></Field>
      </Sheet>
    </PageShell>
  )
}
