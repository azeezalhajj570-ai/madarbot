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
  AgentGroupMember,
  AgentManagedGroup,
  AutomationTask,
  TaskCatalogItem,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}
type TaskDestinationMode = 'group' | 'text'

const BULK_ADD_ITEM: TaskCatalogItem = {
  key: 'bulk_add_members',
  title: 'Bulk Add Members',
  description: 'Add members from a source group to a target group',
  executor_types: ['agent'],
}

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
    const interCooldown = task.config.inter_contact_cooldown_minutes ? ` · gap: ${task.config.inter_contact_cooldown_minutes}m` : ''
    const maxAge = task.config.respond_max_age_minutes ? ` · stale: ${task.config.respond_max_age_minutes}m` : ''
    return `${summary}${mode}${limit}${cooldown}${interCooldown}${maxAge}`
  }
  const template = String(task.config.message_template || '').trim()
  const summary = template ? template : t('automation.noTemplate')
  const mode = task.config.reply_mode === 'private' ? t('automation.privateSuffix') : ''
  return `${summary}${mode}`
}

export function AutomationTasksSection({ account, groupId, onSaved }: { account: Agent; groupId: number | null; onSaved: (message: string, kind?: 'error' | 'success' | 'info') => void }) {
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
  const [leadCooldownMinutes, setLeadCooldownMinutes] = useState('43200')
  const [leadInterContactCooldown, setLeadInterContactCooldown] = useState('12')
  const [leadRespondMaxAge, setLeadRespondMaxAge] = useState('30')

  const isBulkAdd = taskKey === 'bulk_add_members'
  const [bulkSourceGroups, setBulkSourceGroups] = useState<AgentManagedGroup[]>([])
  const [bulkTargetGroups, setBulkTargetGroups] = useState<AgentManagedGroup[]>([])
  const [bulkSourceGroup, setBulkSourceGroup] = useState<AgentManagedGroup | null>(null)
  const [bulkTargetGroup, setBulkTargetGroup] = useState<AgentManagedGroup | null>(null)
  const [bulkMemberQuery, setBulkMemberQuery] = useState('')
  const [bulkMembers, setBulkMembers] = useState<AgentGroupMember[]>([])
  const [bulkMemberTotal, setBulkMemberTotal] = useState(0)
  const [bulkMemberPage, setBulkMemberPage] = useState(1)
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<number[]>([])
  const [bulkTargetMemberIds, setBulkTargetMemberIds] = useState<Set<number>>(new Set())
  const [bulkInterval, setBulkInterval] = useState('20')
  const [bulkSendInvite, setBulkSendInvite] = useState(false)
  const [bulkExcludeAdminsBots, setBulkExcludeAdminsBots] = useState(true)
  const [bulkSearching, setBulkSearching] = useState(false)
  const [bulkLoadingTarget, setBulkLoadingTarget] = useState(false)

  const canSave = useMemo(() => {
    if (isBulkAdd) {
      return !!bulkSourceGroup && !!bulkTargetGroup && bulkSelectedMembers.length > 0
    }
    if (!taskKeywords.length) return false
    if (taskKey === 'notify_destination') {
      const dest = taskDestinationMode === 'group' ? taskDestinationGroup?.tg_group_id : taskDestinationText.trim()
      return !!dest
    }
    return true
  }, [isBulkAdd, bulkSourceGroup, bulkTargetGroup, bulkSelectedMembers.length, taskKeywords, taskKey, taskDestinationMode, taskDestinationGroup, taskDestinationText])

  async function refresh() {
    setLoading(true)
    try {
      const [nextTasks, nextCatalog] = await Promise.all([
        agentsApi.fetchGroupTasks(groupId!),
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

  useEffect(() => { void refresh() }, [groupId, account.id])

  useEffect(() => {
    if (!isBulkAdd) return
    void agentsApi.fetchAgentGroups(account.id).then((allGroups) => {
      const seen = new Set<number>()
      const deduped: AgentManagedGroup[] = []
      for (const g of allGroups) {
        if (g.tg_group_id == null || seen.has(g.tg_group_id)) continue
        seen.add(g.tg_group_id)
        deduped.push(g)
      }
      setBulkSourceGroups(deduped)
      setBulkTargetGroups(deduped.filter((g) => g.can_add_members !== false))
    }).catch(() => { setBulkSourceGroups([]); setBulkTargetGroups([]) })
  }, [isBulkAdd, account.id])

  useEffect(() => {
    if (!isBulkAdd || !bulkSourceGroup?.tg_group_id) { setBulkMembers([]); setBulkMemberTotal(0); return }
    setBulkSearching(true)
    const params: Record<string, unknown> = { tg_group_id: bulkSourceGroup.tg_group_id, limit: 50, page: bulkMemberPage }
    if (bulkMemberQuery.trim()) params.q = bulkMemberQuery.trim()
    void agentsApi.searchAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id, bulkMemberQuery || undefined, 50, false, bulkMemberPage, 'message_count', false, false)
      .then((res) => { setBulkMembers(res.members || []); setBulkMemberTotal(res.total || 0) })
      .catch(() => { setBulkMembers([]); setBulkMemberTotal(0) })
      .finally(() => setBulkSearching(false))
  }, [isBulkAdd, account.id, bulkSourceGroup?.tg_group_id, bulkMemberQuery, bulkMemberPage])

  useEffect(() => { setBulkMemberPage(1); setBulkSelectedMembers([]) }, [bulkSourceGroup?.tg_group_id, bulkMemberQuery])

  useEffect(() => {
    if (!isBulkAdd || !bulkTargetGroup?.tg_group_id) { setBulkTargetMemberIds(new Set()); return }
    setBulkLoadingTarget(true)
    void agentsApi.fetchTargetGroupMembers(account.id, bulkTargetGroup.tg_group_id)
      .then((res) => {
        const ids = new Set(res.user_ids || [])
        setBulkTargetMemberIds(ids)
        setBulkSelectedMembers((prev) => prev.filter((id) => !ids.has(id)))
      })
      .catch(() => setBulkTargetMemberIds(new Set()))
      .finally(() => setBulkLoadingTarget(false))
  }, [isBulkAdd, account.id, bulkTargetGroup?.tg_group_id])

  const groupQuery = taskGroupsQuery || taskDestinationGroupQuery
  useEffect(() => {
    if (!groupQuery.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, groupQuery).then(setGroups).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, groupQuery])

  const extendedCatalog = useMemo(() => [...catalog, BULK_ADD_ITEM], [catalog])

  useEffect(() => {
    if (!catalog.length) return
    if (!extendedCatalog.some((item) => item.key === taskKey)) {
      setTaskKey(extendedCatalog[0].key)
    }
  }, [catalog, taskKey, extendedCatalog])

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
    setLeadCooldownMinutes('43200')
    setLeadInterContactCooldown('12')
    setLeadRespondMaxAge('30')
    setBulkSourceGroup(null)
    setBulkTargetGroup(null)
    setBulkMemberQuery('')
    setBulkMembers([])
    setBulkMemberTotal(0)
    setBulkMemberPage(1)
    setBulkSelectedMembers([])
    setBulkTargetMemberIds(new Set())
    setBulkInterval('20')
    setBulkSendInvite(false)
    setBulkExcludeAdminsBots(true)
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
    setLeadCooldownMinutes(task.config.cooldown_minutes != null ? String(task.config.cooldown_minutes) : '43200')
    setLeadInterContactCooldown(task.config.inter_contact_cooldown_minutes != null ? String(task.config.inter_contact_cooldown_minutes) : '12')
    setLeadRespondMaxAge(task.config.respond_max_age_minutes != null ? String(task.config.respond_max_age_minutes) : '30')
    setIsFormOpen(true)
  }

  async function handleSave() {
    const errors: string[] = []
    if (!isBulkAdd && !taskKeywords.length) errors.push(t('automation.atLeastOneKeyword'))
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
      const interCooldown = Number(leadInterContactCooldown)
      if (interCooldown > 0) config.inter_contact_cooldown_minutes = interCooldown
      const maxAge = Number(leadRespondMaxAge)
      if (maxAge > 0) config.respond_max_age_minutes = maxAge
    }
    if (errors.length) { notify(errors.join(' · ')); return }

    if (isBulkAdd) {
      if (!bulkSourceGroup?.tg_group_id || !bulkTargetGroup?.tg_group_id || !bulkSelectedMembers.length) {
        notify(t('automation.bulkAddRequired')); return
      }
      setIsSaving(true)
      try {
        await agentsApi.bulkAddMembers(account.id, {
          target_tg_group_id: bulkTargetGroup.tg_group_id,
          source_tg_group_id: bulkSourceGroup.tg_group_id,
          interval_seconds: Math.max(1, Number(bulkInterval) || 20),
          user_ids: bulkSelectedMembers,
          send_invite_link_on_privacy_restricted: bulkSendInvite,
        })
        onSaved(t('automation.bulkAddCreated'))
        setIsFormOpen(false)
        resetForm()
      } catch (error) {
        notify(error instanceof Error ? error.message : t('automation.failedSave'))
      } finally {
        setIsSaving(false)
      }
      return
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
        await agentsApi.updateGroupTask(groupId!, editingTask.assignment_id, payload)
        onSaved(t('automation.updated'))
      } else {
        await agentsApi.createGroupTask(groupId!, payload)
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
            {isBulkAdd ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('automation.bulkSourceGroup')}</label>
                  <select
                    value={bulkSourceGroup?.tg_group_id || ''}
                    onChange={(e) => {
                      const gid = Number(e.target.value)
                      const found = bulkSourceGroups.find((g) => g.tg_group_id === gid) || null
                      setBulkSourceGroup(found)
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                  >
                    <option value="">{t('automation.selectSourceGroup')}</option>
                    {bulkSourceGroups.map((g) => <option key={g.tg_group_id} value={g.tg_group_id}>{g.title || `#${g.tg_group_id}`}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('automation.bulkTargetGroup')}</label>
                  <select
                    value={bulkTargetGroup?.tg_group_id || ''}
                    onChange={(e) => {
                      const gid = Number(e.target.value)
                      const found = bulkTargetGroups.find((g) => g.tg_group_id === gid) || null
                      setBulkTargetGroup(found)
                    }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                  >
                    <option value="">{t('automation.selectTargetGroup')}</option>
                    {bulkTargetGroups.map((g) => <option key={g.tg_group_id} value={g.tg_group_id}>{g.title || `#${g.tg_group_id}`}</option>)}
                  </select>
                </div>
                {bulkSourceGroup?.tg_group_id ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('automation.bulkSelectMembers')} ({bulkSelectedMembers.length})</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => setBulkSelectedMembers(bulkMembers.filter((m) => !bulkTargetMemberIds.has(m.user_id) && !(bulkExcludeAdminsBots && (m.is_bot || m.role === 'creator' || m.role === 'admin'))).map((m) => m.user_id))} style={{ fontSize: 11, color: 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{t('automation.selectAll')}</button>
                        <button type="button" onClick={() => setBulkSelectedMembers([])} style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{t('automation.unselectAll')}</button>
                      </div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--miniapp-text-muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={bulkExcludeAdminsBots} onChange={(e) => setBulkExcludeAdminsBots(e.target.checked)} />
                      {t('automation.excludeAdminsBots')}
                    </label>
                    <input
                      type="text"
                      value={bulkMemberQuery}
                      onChange={(e) => setBulkMemberQuery(e.target.value)}
                      placeholder={t('automation.searchMembers')}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 13, fontFamily: 'inherit' }}
                    />
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--miniapp-border-soft)', borderRadius: 8 }}>
                      {bulkSearching ? <div style={{ padding: 12, textAlign: 'center', color: 'var(--miniapp-text-muted)', fontSize: 13 }}>{t('automation.searching')}</div> : null}
                      {!bulkSearching && bulkMembers.length === 0 ? <div style={{ padding: 12, textAlign: 'center', color: 'var(--miniapp-text-muted)', fontSize: 13 }}>{t('automation.noMembersFound')}</div> : null}
                      {bulkMembers.filter((m) => !bulkExcludeAdminsBots || (!m.is_bot && m.role !== 'creator' && m.role !== 'admin')).map((m) => {
                        const inTarget = bulkTargetMemberIds.has(m.user_id)
                        const selected = bulkSelectedMembers.includes(m.user_id)
                        const claim = m.claim
                        const heldByOther = !!(claim && !claim.is_own)
                        const heldBySelf = !!(claim && claim.is_own)
                        const isDisabled = inTarget || heldByOther
                        return (
                          <label key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: isDisabled ? 'default' : 'pointer', opacity: isDisabled ? 0.5 : 1, borderBottom: '1px solid var(--miniapp-border-soft)' }}>
                            <input type="checkbox" checked={selected || !!heldBySelf} disabled={isDisabled} onChange={() => setBulkSelectedMembers((prev) => prev.includes(m.user_id) ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id])} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--miniapp-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name || `User ${m.user_id}`}</div>
                              {m.username ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>@{m.username}</div> : null}
                            </div>
                            {inTarget ? <span style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', fontWeight: 600 }}>{t('automation.alreadyInGroup')}</span> : null}
                            {heldByOther ? <span style={{ fontSize: 10, color: '#e67e22', fontWeight: 600 }}>{t('automation.heldByOther')}</span> : null}
                            {heldBySelf ? <span style={{ fontSize: 10, color: 'var(--miniapp-coral)', fontWeight: 600 }}>{t('automation.selectedByYou')}</span> : null}
                            {m.role === 'admin' || m.role === 'creator' ? <span style={{ fontSize: 10, color: 'var(--miniapp-clay)', fontWeight: 600 }}>{m.role}</span> : null}
                            {m.is_bot ? <span style={{ fontSize: 10, color: 'var(--miniapp-text-muted)', fontWeight: 600 }}>bot</span> : null}
                          </label>
                        )
                      })}
                    </div>
                    {bulkMemberTotal > 50 ? (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 12 }}>
                        <button type="button" disabled={bulkMemberPage <= 1} onClick={() => setBulkMemberPage((p) => p - 1)} style={{ fontSize: 12, color: bulkMemberPage <= 1 ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: bulkMemberPage <= 1 ? 'default' : 'pointer' }}>{t('automation.prev')}</button>
                        <span style={{ color: 'var(--miniapp-text-muted)' }}>{bulkMemberPage} / {Math.ceil(bulkMemberTotal / 50)}</span>
                        <button type="button" disabled={bulkMemberPage * 50 >= bulkMemberTotal} onClick={() => setBulkMemberPage((p) => p + 1)} style={{ fontSize: 12, color: bulkMemberPage * 50 >= bulkMemberTotal ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', background: 'none', border: 'none', cursor: bulkMemberPage * 50 >= bulkMemberTotal ? 'default' : 'pointer' }}>{t('automation.next')}</button>
                      </div>
                    ) : null}
                    {bulkLoadingTarget ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{t('automation.loadingTarget')}</div> : null}
                  </div>
                ) : null}
                <InputField label={t('automation.bulkInterval')} value={bulkInterval} onChange={setBulkInterval} placeholder="20" />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-text-primary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={bulkSendInvite} onChange={(e) => setBulkSendInvite(e.target.checked)} />
                  {t('automation.bulkSendInvite')}
                </label>
              </div>
            ) : (
              <>
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
              </>
            )}
            {isBulkAdd ? null : (
              <>
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
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.interContactCooldown')}</span>
                      <input
                        type="number"
                        min="0"
                        value={leadInterContactCooldown}
                        onChange={(e) => setLeadInterContactCooldown(e.target.value)}
                        placeholder={t('leadsAcq.interContactCooldownPlaceholder')}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.respondMaxAge')}</span>
                      <input
                        type="number"
                        min="0"
                        value={leadRespondMaxAge}
                        onChange={(e) => setLeadRespondMaxAge(e.target.value)}
                        placeholder={t('leadsAcq.respondMaxAgePlaceholder')}
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
              </>
            )}
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
