import { useEffect, useState } from 'react'

import { ConfirmModal } from '../../components/ConfirmModal'
import { FormActions } from '../../components/FormActions'
import { GroupAutocompleteField } from '../../components/GroupAutocompleteField'
import { GroupDestinationField } from '../../components/GroupDestinationField'

import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
  SelectField,
  TextAreaField,
} from '@miniapp/shared'
import type {
  Agent,
  AgentManagedGroup,
  AutomationTask,
  TaskCatalogItem,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}
type TaskDestinationMode = 'group' | 'text'

function mapTaskGroups(task: AutomationTask) {
  const tgGroupIds = Array.isArray(task.group_tg_ids) ? task.group_tg_ids : []
  const titles = Array.isArray(task.group_titles) ? task.group_titles : []
  return tgGroupIds.map((tgGroupId, index) => ({
    tg_group_id: Number(tgGroupId),
    title: String(titles[index] || `Group ${tgGroupId}`),
  }))
}

function taskTitle(task: AutomationTask, catalog: TaskCatalogItem[]) {
  return catalog.find((item) => item.key === task.task_key)?.title || task.task_key.replace(/_/g, ' ')
}

function _parseKeywords(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (!raw) return []
  return String(raw).split(',').map((k) => k.trim()).filter(Boolean)
}

function taskConditionLabel(task: AutomationTask) {
  const keywords = _parseKeywords(task.conditions.text_contains)
  return keywords.length ? `When message contains: ${keywords.join(', ')}` : 'No keyword condition'
}

function taskConfigLabel(task: AutomationTask) {
  if (task.task_key === 'notify_destination') {
    const destination = String(task.config.destination || '').trim() || 'No destination'
    const delivery = String(task.config.delivery_mode || 'text')
    return `${destination} · ${delivery}`
  }
  const template = String(task.config.message_template || '').trim()
  const summary = template ? template : 'No message template'
  const mode = task.config.reply_mode === 'private' ? ' · private' : ''
  return `${summary}${mode}`
}

export function AutomationTasksSection({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [catalog, setCatalog] = useState<TaskCatalogItem[]>([])
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationTask | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [taskKey, setTaskKey] = useState('reply_message')
  const [taskKeywords, setTaskKeywords] = useState<string[]>([])
  const [pendingKeyword, setPendingKeyword] = useState('')
  const [taskTemplate, setTaskTemplate] = useState('')
  const [taskReplyMode, setTaskReplyMode] = useState('public')
  const [taskDeliveryMode, setTaskDeliveryMode] = useState('text')
  const [taskDestinationMode, setTaskDestinationMode] = useState<TaskDestinationMode>('group')
  const [taskDestinationText, setTaskDestinationText] = useState('')
  const [taskDestinationGroupQuery, setTaskDestinationGroupQuery] = useState('')
  const [taskDestinationGroup, setTaskDestinationGroup] = useState<SelectedGroupChip | null>(null)
  const [taskGroupsQuery, setTaskGroupsQuery] = useState('')
  const [taskGroups, setTaskGroups] = useState<SelectedGroupChip[]>([])

  async function refresh() {
    setLoading(true)
    try {
      const [nextTasks, nextCatalog] = await Promise.all([
        agentsApi.fetchGroupTasks(account.group_id || 196),
        agentsApi.fetchTaskCatalog(),
      ])
      setTasks(nextTasks)
      setCatalog(nextCatalog)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [account.group_id, account.id])

  const groupQuery = taskGroupsQuery || taskDestinationGroupQuery
  useEffect(() => {
    if (!groupQuery.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, groupQuery).then(setGroups).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, groupQuery])

  useEffect(() => {
    if (!catalog.length) return
    if (!catalog.some((item) => item.key === taskKey)) {
      setTaskKey(catalog[0].key)
    }
  }, [catalog, taskKey])

  function resetForm() {
    setEditingTask(null)
    setTaskKey(catalog[0]?.key || 'reply_message')
    setTaskKeywords([])
    setPendingKeyword('')
    setTaskTemplate('')
    setTaskReplyMode('public')
    setTaskDeliveryMode('text')
    setTaskDestinationMode('group')
    setTaskDestinationText('')
    setTaskDestinationGroupQuery('')
    setTaskDestinationGroup(null)
    setTaskGroupsQuery('')
    setTaskGroups([])
  }

  function openEditForm(task: AutomationTask) {
    const configuredDestination = String(task.config.destination || '')
    const matchingDestinationGroup = groups.find((g) => String(g.tg_group_id || '') === configuredDestination)
    setEditingTask(task)
    setTaskKey(task.task_key)
    setTaskKeywords(_parseKeywords(task.conditions.text_contains))
    setPendingKeyword('')
    setTaskTemplate(String(task.config.message_template || ''))
    setTaskReplyMode(String(task.config.reply_mode || 'public'))
    setTaskDeliveryMode(String(task.config.delivery_mode || 'text'))
    setTaskDestinationMode(matchingDestinationGroup ? 'group' : 'text')
    setTaskDestinationText(matchingDestinationGroup ? '' : configuredDestination)
    setTaskDestinationGroupQuery(matchingDestinationGroup ? String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || '') : '')
    setTaskDestinationGroup(matchingDestinationGroup ? { tg_group_id: Number(matchingDestinationGroup.tg_group_id), title: String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || 'Group') } : null)
    setTaskGroupsQuery('')
    setTaskGroups(mapTaskGroups(task))
    setIsFormOpen(true)
  }

  async function handleSave() {
    if (!taskKeywords.length) { setStatus('At least one keyword is required'); return }
    const config: Record<string, unknown> = {}
    if (taskTemplate.trim()) config.message_template = taskTemplate.trim()
    if (taskKey === 'reply_message') config.reply_mode = taskReplyMode
    if (taskKey === 'notify_destination') {
      const dest = taskDestinationMode === 'group' ? String(taskDestinationGroup?.tg_group_id || '') : taskDestinationText.trim()
      if (!dest) { setStatus('Destination is required'); return }
      config.destination = dest
      config.delivery_mode = taskDeliveryMode
    }
    const payload = {
      task_key: taskKey,
      executor_type: 'agent',
      enabled: true,
      conditions: { text_contains: taskKeywords.join(',') },
      config,
      agent_id: account.id,
      group_tg_ids: taskGroups.map((g) => g.tg_group_id),
      group_titles: taskGroups.map((g) => g.title),
    }
    setIsSaving(true)
    try {
      if (editingTask) {
        await agentsApi.updateGroupTask(account.group_id || 196, editingTask.assignment_id, payload)
        onSaved('Task updated')
      } else {
        await agentsApi.createGroupTask(account.group_id || 196, payload)
        onSaved('Task created')
      }
      setIsFormOpen(false)
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save task')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsSaving(true)
    try {
      await agentsApi.deleteGroupTask(account.group_id, deleteTarget.assignment_id)
      onSaved('Task deleted')
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete task')
    } finally {
      setIsSaving(false)
    }
  }

  const extendedCatalog = catalog
  return (
    <>
      <Card title="Automation Tasks" subtitle="Configure automated actions triggered by group events.">
        {status ? <Note>{status}</Note> : null}
        {!isFormOpen ? <Button onClick={() => { resetForm(); setIsFormOpen(true) }}>New task</Button> : null}
        {isFormOpen ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <SelectField label="Task type" value={taskKey} onChange={setTaskKey}>
              {extendedCatalog.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
            </SelectField>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>Keyword condition</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {taskKeywords.map((kw, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: 'var(--miniapp-coral-dim)', color: 'var(--miniapp-coral)', fontSize: 13, fontWeight: 500 }}>
                    {kw}
                    <button type="button" onClick={() => setTaskKeywords((p) => p.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 15, lineHeight: 1, padding: 0 }}>&times;</button>
                  </span>
                ))}
              </div>
              <input type="text" value={pendingKeyword} onChange={(e) => setPendingKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && pendingKeyword.trim()) { e.preventDefault(); setTaskKeywords((p) => p.includes(pendingKeyword.trim()) ? p : [...p, pendingKeyword.trim()]); setPendingKeyword('') } }}
                onBlur={() => { if (pendingKeyword.trim()) { setTaskKeywords((p) => p.includes(pendingKeyword.trim()) ? p : [...p, pendingKeyword.trim()]); setPendingKeyword('') } }}
                placeholder="support" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }} />
            </div>
            <TextAreaField label="Message template" value={taskTemplate} onChange={setTaskTemplate} rows={5} placeholder={taskKey === 'notify_destination' ? 'Notify: {text}' : 'We will reply shortly.'} />
            {taskKey === 'reply_message' ? (
              <SelectField label="Reply mode" value={taskReplyMode} onChange={setTaskReplyMode}>
                <option value="public">Public (group)</option>
                <option value="private">Private (direct message)</option>
              </SelectField>
            ) : null}
            <GroupAutocompleteField label="Select groups" query={taskGroupsQuery} onQueryChange={setTaskGroupsQuery} groups={groups}
              selectedGroups={taskGroups} onAdd={(g) => setTaskGroups((c) => c.some((e) => e.tg_group_id === g.tg_group_id) ? c : [...c, g])}
              onRemove={(id) => setTaskGroups((c) => c.filter((g) => g.tg_group_id !== id))} />
            {taskKey === 'notify_destination' ? (
              <>
                <SelectField label="Destination type" value={taskDestinationMode} onChange={(v) => setTaskDestinationMode(v as TaskDestinationMode)}>
                  <option value="group">Select visible group</option>
                  <option value="text">Manual ID / username</option>
                </SelectField>
                {taskDestinationMode === 'group' ? (
                  <GroupDestinationField label="Destination group" query={taskDestinationGroupQuery} onQueryChange={setTaskDestinationGroupQuery} groups={groups}
                    selectedGroup={taskDestinationGroup} onSelect={(g) => { setTaskDestinationGroup(g); setTaskDestinationGroupQuery(g.title) }}
                    onClear={() => { setTaskDestinationGroup(null); setTaskDestinationGroupQuery('') }} />
                ) : (
                  <InputField label="Destination" value={taskDestinationText} onChange={setTaskDestinationText} placeholder="-1001234567890 or @channel" />
                )}
                <SelectField label="Delivery mode" value={taskDeliveryMode} onChange={setTaskDeliveryMode}>
                  <option value="text">Text</option>
                  <option value="forward">Forward</option>
                  <option value="copy">Copy</option>
                  <option value="text_and_forward">Text and forward</option>
                  <option value="text_and_copy">Text and copy</option>
                </SelectField>
              </>
            ) : null}
            <FormActions submitLabel={editingTask ? 'Save task' : 'Create task'} onSubmit={() => void handleSave()} onCancel={() => { resetForm(); setIsFormOpen(false) }} />
          </div>
        ) : null}
      </Card>
      {!loading && tasks.length > 0 ? (
        <Card title="Configured Tasks" subtitle="Existing automation rules for this group.">
          <div style={{ display: 'grid', gap: 8 }}>
            {tasks.map((task) => (
              <div key={task.assignment_id} style={{ padding: 14, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-surface)' }}>
                <div>
                  <strong>{taskTitle(task, catalog)}</strong>
                  <div style={{ color: '#655d52', marginTop: 4 }}>{taskConditionLabel(task)}</div>
                  <div style={{ color: '#655d52', marginTop: 4 }}>{taskConfigLabel(task)}</div>
                  {Array.isArray(task.group_titles) && task.group_titles.length ? <div style={{ color: '#655d52', marginTop: 4 }}>Groups: {task.group_titles.join(', ')}</div> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <Button tone="secondary" onClick={() => openEditForm(task)}>Edit</Button>
                  <Button tone="danger" onClick={() => setDeleteTarget(task)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {deleteTarget ? (
        <ConfirmModal title="Delete task" message="Delete this automation task?" confirmLabel="Delete" isBusy={isSaving}
          onConfirm={() => void handleDelete()} onCancel={() => setDeleteTarget(null)} />
      ) : null}
    </>
  )
}
