import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

const DELIVERY_LABELS: Record<string, string> = {
  text: 'deliveryText',
  forward: 'deliveryForward',
  copy: 'deliveryCopy',
  text_and_forward: 'deliveryTextForward',
  text_and_copy: 'deliveryTextCopy',
}

function mapTaskGroups(t: (key: string, options?: Record<string, unknown>) => string, task: AutomationTask) {
  const tgGroupIds = Array.isArray(task.group_tg_ids) ? task.group_tg_ids : []
  const titles = Array.isArray(task.group_titles) ? task.group_titles : []
  return tgGroupIds.map((tgGroupId, index) => ({
    tg_group_id: Number(tgGroupId),
    title: String(titles[index] || t('automation.groupFallback', { tgGroupId })),
  }))
}

function taskTitle(task: AutomationTask, catalog: TaskCatalogItem[]) {
  return catalog.find((item) => item.key === task.task_key)?.title || task.task_key.replace(/_/g, ' ')
}

function _parseKeywords(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (!raw) return []
  return String(raw).split(',').map((k) => k.trim()).filter(Boolean)
}

function taskConditionLabel(t: (key: string, options?: Record<string, unknown>) => string, task: AutomationTask) {
  const keywords = _parseKeywords(task.conditions.text_contains)
  return keywords.length
    ? t('automation.conditionLabel', { keyword: keywords.join(', ') })
    : t('automation.noKeyword')
}

function taskConfigLabel(t: (key: string, options?: Record<string, unknown>) => string, task: AutomationTask) {
  if (task.task_key === 'notify_destination') {
    const destination = String(task.config.destination || '').trim() || t('automation.noDest')
    const mode = String(task.config.delivery_mode || 'text')
    const delivery = t(`automation.${DELIVERY_LABELS[mode] || 'deliveryText'}`)
    return `${destination} · ${delivery}`
  }
  if (task.task_key === 'lead_capture') {
    const template = String(task.config.ack_template || '').trim()
    const summary = template ? template : t('automation.noTemplate')
    const mode = task.config.auto_respond ? ` · auto: ${String(task.config.respond_mode || 'public')}` : ''
    const limit = task.config.max_new_contacts_per_day ? ` · limit: ${task.config.max_new_contacts_per_day}/day` : ''
    const cooldown = task.config.cooldown_minutes ? ` · cooldown: ${task.config.cooldown_minutes}m` : ''
    return `${summary}${mode}${limit}${cooldown}`
  }
  const template = String(task.config.message_template || '').trim()
  const summary = template ? template : t('automation.noTemplate')
  const mode = task.config.reply_mode === 'private' ? t('automation.privateSuffix') : ''
  return `${summary}${mode}`
}

export function AutomationTasksSection({ account, onSaved }: { account: Agent; onSaved: (message: string, kind?: 'error' | 'success' | 'info') => void }) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<TaskCatalogItem[]>([])
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  function notify(msg: string, kind: 'error' | 'success' | 'info' = 'error') {
    setStatus(msg); onSaved(msg, kind)
  }
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

  const [leadAutoRespond, setLeadAutoRespond] = useState(false)
  const [leadRespondMode, setLeadRespondMode] = useState<'public' | 'private' | 'private_with_forward'>('public')
  const [leadRespondDelay, setLeadRespondDelay] = useState('3')
  const [leadMaxNewContacts, setLeadMaxNewContacts] = useState('')
  const [leadCooldownMinutes, setLeadCooldownMinutes] = useState('1440')

  const canSave = useMemo(() => {
    if (!taskKeywords.length) return false
    if (taskKey === 'notify_destination') {
      const dest = taskDestinationMode === 'group' ? taskDestinationGroup?.tg_group_id : taskDestinationText.trim()
      return !!dest
    }
    return true
  }, [taskKeywords, taskKey, taskDestinationMode, taskDestinationGroup, taskDestinationText])

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
      notify(error instanceof Error ? error.message : t('automation.failedLoad'))
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
    setLeadAutoRespond(false)
    setLeadRespondMode('public')
    setLeadRespondDelay('3')
    setLeadMaxNewContacts('')
    setLeadCooldownMinutes('1440')
    setStatus(null)
  }

  function openEditForm(task: AutomationTask) {
    const configuredDestination = String(task.config.destination || '')
    const matchingDestinationGroup = groups.find((g) => String(g.tg_group_id || '') === configuredDestination)
    setEditingTask(task)
    setTaskKey(task.task_key)
    setTaskKeywords(_parseKeywords(task.conditions.text_contains))
    setPendingKeyword('')
    setTaskTemplate(String(task.config.ack_template || task.config.message_template || ''))
    setTaskReplyMode(String(task.config.reply_mode || 'public'))
    setTaskDeliveryMode(String(task.config.delivery_mode || 'text'))
    setTaskDestinationMode(matchingDestinationGroup ? 'group' : 'text')
    setTaskDestinationText(matchingDestinationGroup ? '' : configuredDestination)
    setTaskDestinationGroupQuery(matchingDestinationGroup ? String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || '') : '')
    setTaskDestinationGroup(matchingDestinationGroup ? { tg_group_id: Number(matchingDestinationGroup.tg_group_id), title: String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || t('automation.groupFallback', { tgGroupId: matchingDestinationGroup.tg_group_id })) } : null)
    setTaskGroupsQuery('')
    setTaskGroups(mapTaskGroups(t, task))
    setLeadAutoRespond(Boolean(task.config.auto_respond))
    setLeadRespondMode(String(task.config.respond_mode || 'public') as 'public' | 'private' | 'private_with_forward')
    setLeadRespondDelay(String(task.config.respond_delay_seconds ?? 3))
    setLeadMaxNewContacts(task.config.max_new_contacts_per_day != null ? String(task.config.max_new_contacts_per_day) : '')
    setLeadCooldownMinutes(task.config.cooldown_minutes != null ? String(task.config.cooldown_minutes) : '1440')
    setIsFormOpen(true)
  }

  async function handleSave() {
    const errors: string[] = []
    if (!taskKeywords.length) errors.push(t('automation.atLeastOneKeyword'))
    const config: Record<string, unknown> = {}
    if (taskTemplate.trim()) {
      if (taskKey === 'lead_capture') {
        config.ack_template = taskTemplate.trim()
      } else {
        config.message_template = taskTemplate.trim()
      }
    }
    if (taskKey === 'reply_message') config.reply_mode = taskReplyMode
    if (taskKey === 'notify_destination') {
      const dest = taskDestinationMode === 'group' ? String(taskDestinationGroup?.tg_group_id || '') : taskDestinationText.trim()
      if (!dest) errors.push(t('automation.destRequired'))
      else config.destination = dest
      config.delivery_mode = taskDeliveryMode
    }
    if (taskKey === 'lead_capture' && leadAutoRespond) {
      config.auto_respond = true
      config.respond_mode = leadRespondMode
      config.respond_delay_seconds = Math.max(0, Number(leadRespondDelay) || 3)
      const maxNew = Number(leadMaxNewContacts)
      if (maxNew > 0) config.max_new_contacts_per_day = maxNew
      const cooldown = Number(leadCooldownMinutes)
      if (cooldown > 0) config.cooldown_minutes = cooldown
    }
    if (errors.length) { notify(errors.join(' · ')); return }
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
        onSaved(t('automation.updated'))
      } else {
        await agentsApi.createGroupTask(account.group_id || 196, payload)
        onSaved(t('automation.created'))
      }
      setIsFormOpen(false)
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('automation.failedSave'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsSaving(true)
    try {
      await agentsApi.deleteGroupTask(account.group_id, deleteTarget.assignment_id)
      onSaved(t('automation.deleted'))
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      notify(error instanceof Error ? error.message : t('automation.failedDelete'))
    } finally {
      setIsSaving(false)
    }
  }

  const extendedCatalog = catalog
  return (
    <>
      <Card title={t('automation.title')} subtitle={t('automation.subtitle')}>
        {status ? <div data-form-error><Note>{status}</Note></div> : null}
        {!isFormOpen ? <Button onClick={() => { resetForm(); setIsFormOpen(true) }}>{t('automation.newTask')}</Button> : null}
        {isFormOpen ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <SelectField label={t('automation.taskType')} value={taskKey} onChange={setTaskKey}>
              {extendedCatalog.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}
            </SelectField>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('automation.keywordCondition')}</label>
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
                placeholder={t('automation.keywordPlaceholder')} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }} />
            </div>
            <TextAreaField label={t('automation.messageTemplate')} value={taskTemplate} onChange={setTaskTemplate} rows={5} placeholder={taskKey === 'notify_destination' ? t('automation.templateNotifyPlaceholder') : t('automation.templateReplyPlaceholder')} />
            {taskKey === 'reply_message' ? (
              <SelectField label={t('automation.replyMode')} value={taskReplyMode} onChange={setTaskReplyMode}>
                <option value="public">{t('automation.replyPublic')}</option>
                <option value="private">{t('automation.replyPrivate')}</option>
              </SelectField>
            ) : null}
            {taskKey === 'lead_capture' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={leadAutoRespond} onChange={(e) => setLeadAutoRespond(e.target.checked)} />
                  {t('leadsAcq.autoRespond')}
                </label>
                {leadAutoRespond && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <select
                      value={leadRespondMode}
                      onChange={(e) => setLeadRespondMode(e.target.value as 'public' | 'private' | 'private_with_forward')}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                    >
                      <option value="public">{t('leadsAcq.respondPublic')}</option>
                      <option value="private">{t('leadsAcq.respondPrivate')}</option>
                      <option value="private_with_forward">{t('leadsAcq.respondPrivateWithForward')}</option>
                    </select>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.respondDelay')}</span>
                      <input
                        type="number"
                        min="0"
                        max="3600"
                        value={leadRespondDelay}
                        onChange={(e) => setLeadRespondDelay(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.maxNewContactsPerDay')}</span>
                      <input
                        type="number"
                        min="0"
                        value={leadMaxNewContacts}
                        onChange={(e) => setLeadMaxNewContacts(e.target.value)}
                        placeholder={t('leadsAcq.maxNewContactsPerDayPlaceholder')}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.cooldownMinutes')}</span>
                      <input
                        type="number"
                        min="0"
                        value={leadCooldownMinutes}
                        onChange={(e) => setLeadCooldownMinutes(e.target.value)}
                        placeholder={t('leadsAcq.cooldownMinutesPlaceholder')}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : null}
            <GroupAutocompleteField label={t('automation.selectGroups')} query={taskGroupsQuery} onQueryChange={setTaskGroupsQuery} groups={groups}
              selectedGroups={taskGroups} onAdd={(g) => setTaskGroups((c) => c.some((e) => e.tg_group_id === g.tg_group_id) ? c : [...c, g])}
              onRemove={(id) => setTaskGroups((c) => c.filter((g) => g.tg_group_id !== id))} placeholder={t('automation.destGroupPlaceholder')} />
            {taskKey === 'notify_destination' ? (
              <>
                <SelectField label={t('automation.destType')} value={taskDestinationMode} onChange={(v) => setTaskDestinationMode(v as TaskDestinationMode)}>
                  <option value="group">{t('automation.destVisible')}</option>
                  <option value="text">{t('automation.destManual')}</option>
                </SelectField>
                {taskDestinationMode === 'group' ? (
                  <GroupDestinationField label={t('automation.destGroup')} query={taskDestinationGroupQuery} onQueryChange={setTaskDestinationGroupQuery} groups={groups}
                    selectedGroup={taskDestinationGroup} onSelect={(g) => { setTaskDestinationGroup(g); setTaskDestinationGroupQuery(g.title) }}
                    onClear={() => { setTaskDestinationGroup(null); setTaskDestinationGroupQuery('') }} />
                ) : (
                  <InputField label={t('automation.destination')} value={taskDestinationText} onChange={setTaskDestinationText} placeholder={t('automation.destPlaceholder')} />
                )}
                <SelectField label={t('automation.deliveryMode')} value={taskDeliveryMode} onChange={setTaskDeliveryMode}>
                  <option value="text">{t('automation.deliveryText')}</option>
                  <option value="forward">{t('automation.deliveryForward')}</option>
                  <option value="copy">{t('automation.deliveryCopy')}</option>
                  <option value="text_and_forward">{t('automation.deliveryTextForward')}</option>
                  <option value="text_and_copy">{t('automation.deliveryTextCopy')}</option>
                </SelectField>
              </>
            ) : null}
            <FormActions submitLabel="Save" submitDisabled={!canSave || isSaving} onSubmit={() => void handleSave()} onCancel={() => { resetForm(); setIsFormOpen(false) }} />
          </div>
        ) : null}
      </Card>
      {!loading && tasks.length > 0 ? (
        <Card title={t('automation.configuredTitle')} subtitle={t('automation.configuredSubtitle')}>
          <div style={{ display: 'grid', gap: 8 }}>
            {tasks.map((task) => (
              <div key={task.assignment_id} style={{ padding: 14, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-surface)' }}>
                <div>
                  <strong>{taskTitle(task, catalog)}</strong>
                  <div style={{ color: '#655d52', marginTop: 4 }}>{taskConditionLabel(t, task)}</div>
                  <div style={{ color: '#655d52', marginTop: 4 }}>{taskConfigLabel(t, task)}</div>
                  {Array.isArray(task.group_titles) && task.group_titles.length ? <div style={{ color: '#655d52', marginTop: 4 }}>{t('automation.groupsLabel', { titles: task.group_titles.join(', ') })}</div> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <Button tone="secondary" onClick={() => openEditForm(task)}>{t('automation.edit')}</Button>
                  <Button tone="danger" onClick={() => setDeleteTarget(task)}>{t('automation.delete')}</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {deleteTarget ? (
        <ConfirmModal title={t('automation.deleteModalTitle')} message={t('automation.deleteModalMsg')} confirmLabel={t('automation.deleteConfirm')} isBusy={isSaving}
          onConfirm={() => void handleDelete()} onCancel={() => setDeleteTarget(null)} />
      ) : null}
    </>
  )
}
