import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  agentsApi,
  Button,
  Card,
  GroupAutocomplete,
  InputField,
  LinkRow,
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

const SCRAPE_LIMIT_MAX = 1_000_000
const SCRAPE_TASK_KEY = 'scraper_full_group'

function clampScrapeLimit(value: string) {
  return Math.max(1, Math.min(Number(value) || SCRAPE_LIMIT_MAX, SCRAPE_LIMIT_MAX))
}

function _formatKeywords(keywords: string[]): string {
  return keywords.join(',')
}

type LeadsTaskType = 'scrape' | 'lead_capture'

export function LeadsAcquisitionSection({ account, groupId, onSaved }: { account: Agent; groupId: number | null; onSaved: (message: string, kind?: 'error' | 'success' | 'info') => void }) {
  const { t } = useTranslation()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [taskType, setTaskType] = useState<LeadsTaskType>('scrape')
  const [status, setStatus] = useState<string | null>(null)

  function notify(msg: string, kind: 'error' | 'success' | 'info' = 'error') {
    setStatus(msg); onSaved(msg, kind)
  }

  // Scrape state
  const [scrapeGroupQuery, setScrapeGroupQuery] = useState('')
  const [scrapeGroups, setScrapeGroups] = useState<AgentManagedGroup[]>([])
  const [scrapeSelectedGroup, setScrapeSelectedGroup] = useState<AgentManagedGroup | null>(null)
  const [loadingScrapeGroups, setLoadingScrapeGroups] = useState(false)
  const [scrapeMemberLimit, setScrapeMemberLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [scrapeMessageLimit, setScrapeMessageLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [scrapeMaxAgeDays, setScrapeMaxAgeDays] = useState('30')
  const [isSaving, setIsSaving] = useState(false)

  // Lead capture state
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [taskKeywords, setTaskKeywords] = useState<string[]>([])
  const [pendingKeyword, setPendingKeyword] = useState('')
  const [leadAckTemplate, setLeadAckTemplate] = useState('')
  const [leadLabel, setLeadLabel] = useState('')
  const [leadAskContact, setLeadAskContact] = useState(false)
  const [leadAutoRespond, setLeadAutoRespond] = useState(false)
  const [leadRespondMode, setLeadRespondMode] = useState<'public' | 'private' | 'private_with_forward'>('public')
  const [leadRespondDelay, setLeadRespondDelay] = useState('3')
  const [leadMaxNewContacts, setLeadMaxNewContacts] = useState('')
  const [taskGroupsQuery, setTaskGroupsQuery] = useState('')
  const [taskGroups, setTaskGroups] = useState<SelectedGroupChip[]>([])

  const canSubmit = useMemo(() => {
    if (taskType === 'scrape') return !!scrapeSelectedGroup?.tg_group_id
    return taskKeywords.length > 0
  }, [taskType, scrapeSelectedGroup, taskKeywords])

  useEffect(() => {
    if (taskType !== 'scrape') { setScrapeGroups([]); return }
    const normalized = scrapeGroupQuery.trim()
    if (!normalized) { setScrapeGroups([]); setLoadingScrapeGroups(false); return }
    const timer = setTimeout(() => {
      setLoadingScrapeGroups(true)
      void agentsApi.fetchAgentGroups(account.id, normalized)
        .then(setScrapeGroups).catch(() => setScrapeGroups([]))
        .finally(() => setLoadingScrapeGroups(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [account.id, scrapeGroupQuery, taskType])

  const groupQuery = taskGroupsQuery
  useEffect(() => {
    if (taskType !== 'lead_capture' || !groupQuery.trim()) { setGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, groupQuery).then(setGroups).catch(() => setGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, groupQuery, taskType])

  async function handleScrape() {
    if (!scrapeSelectedGroup?.tg_group_id) { notify(t('leadsAcq.chooseGroupFirst')); return }
    setIsSaving(true)
    try {
      await agentsApi.createAgentJob(account.id, SCRAPE_TASK_KEY, {
        tg_group_id: Number(scrapeSelectedGroup.tg_group_id),
        scrape_members: true,
        scrape_messages: true,
        member_limit: clampScrapeLimit(scrapeMemberLimit),
        message_limit: clampScrapeLimit(scrapeMessageLimit),
        max_age_days: Math.max(1, Number(scrapeMaxAgeDays) || 30),
        scan_strategy: 'checkpoint',
      })
      setStatus(null)
      onSaved(t('leadsAcq.scrapeQueued', { title: scrapeSelectedGroup.title || String(scrapeSelectedGroup.tg_group_id) }))
    } catch (error) {
      notify(error instanceof Error ? error.message : t('leadsAcq.failedQueue'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveLeadCapture() {
    if (!taskKeywords.length) { notify(t('leadsAcq.atLeastOneKeyword')); return }
    setIsSaving(true)
    try {
      const config: Record<string, unknown> = {}
      if (leadAckTemplate.trim()) config.ack_template = leadAckTemplate.trim()
      if (leadLabel.trim()) config.lead_label = leadLabel.trim()
      if (leadAskContact) config.ask_contact = true
      if (leadAutoRespond) {
        config.auto_respond = true
        config.respond_mode = leadRespondMode
        config.respond_delay_seconds = Math.max(0, Number(leadRespondDelay) || 3)
        const maxNew = Number(leadMaxNewContacts)
        if (maxNew > 0) config.max_new_contacts_per_day = maxNew
      }
      await agentsApi.createGroupTask(groupId!, {
        task_key: 'lead_capture',
        executor_type: 'agent',
        enabled: true,
        conditions: { text_contains: _formatKeywords(taskKeywords) },
        config,
        agent_id: account.id,
        group_tg_ids: taskGroups.map((g) => g.tg_group_id),
        group_titles: taskGroups.map((g) => g.title),
      })
      setStatus(null)
      onSaved(t('leadsAcq.leadCaptureCreated'))
    } catch (error) {
      notify(error instanceof Error ? error.message : t('leadsAcq.failedSaveLead'))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmit() {
    if (taskType === 'scrape') {
      await handleScrape()
    } else {
      await handleSaveLeadCapture()
    }
    setIsFormOpen(false)
  }

  const isScrape = taskType === 'scrape'

  function resetForm() {
    setTaskType('scrape')
    setScrapeGroupQuery('')
    setScrapeSelectedGroup(null)
    setScrapeGroups([])
    setScrapeMemberLimit(String(SCRAPE_LIMIT_MAX))
    setScrapeMessageLimit(String(SCRAPE_LIMIT_MAX))
    setScrapeMaxAgeDays('30')
    setTaskKeywords([])
    setPendingKeyword('')
    setLeadAckTemplate('')
    setLeadLabel('')
    setLeadAskContact(false)
    setLeadAutoRespond(false)
    setLeadRespondMode('public')
    setLeadRespondDelay('3')
    setLeadMaxNewContacts('')
    setTaskGroupsQuery('')
    setTaskGroups([])
    setStatus(null)
  }

  return (
    <Card title={t('leadsAcq.title')} subtitle={t('leadsAcq.subtitle')}>
      {status ? <div data-form-error><Note>{status}</Note></div> : null}
      {!isFormOpen ? <Button onClick={() => { resetForm(); setIsFormOpen(true) }}>{t('leadsAcq.newAcquisition')}</Button> : null}
      {isFormOpen ? renderForm() : null}
    </Card>
  )

  function renderForm() {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <SelectField label={t('leadsAcq.taskType')} value={taskType} onChange={(v) => { setTaskType(v as LeadsTaskType); setStatus(null) }}>
          <option value="scrape">{t('leadsAcq.scrapeGroup')}</option>
          <option value="lead_capture">{t('leadsAcq.leadCapture')}</option>
        </SelectField>
        {isScrape ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <InputField label={t('leadsAcq.findGroup')} value={scrapeGroupQuery} onChange={setScrapeGroupQuery} placeholder={t('leadsAcq.groupPlaceholder')} />
            {loadingScrapeGroups ? <Note>{t('leadsAcq.searchingDb')}</Note> : null}
            {!loadingScrapeGroups && scrapeGroups.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {scrapeGroups.map((group, index) => (
                  <LinkRow key={`${group.tg_group_id ?? index}-${group.title ?? index}`} active={scrapeSelectedGroup?.tg_group_id === group.tg_group_id}
                    onClick={() => { setScrapeSelectedGroup(group); setScrapeGroupQuery(group.title || '') }}>
                    <strong>{group.title || t('leadsAcq.groupFallback', { tgGroupId: group.tg_group_id ?? index })}</strong>
                    <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id ?? t('leadsAcq.noTgId')} · {t('leadsAcq.membersCount', { count: group.member_count ?? 0 })}</div>
                  </LinkRow>
                ))}
              </div>
            ) : null}
            {scrapeSelectedGroup ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <InputField label={t('leadsAcq.maxMembers')} value={scrapeMemberLimit} onChange={setScrapeMemberLimit} type="number" />
                <InputField label={t('leadsAcq.maxMessages')} value={scrapeMessageLimit} onChange={setScrapeMessageLimit} type="number" />
                <InputField label={t('leadsAcq.maxAgeDays')} value={scrapeMaxAgeDays} onChange={setScrapeMaxAgeDays} type="number" />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button tone="secondary" onClick={() => { resetForm(); setIsFormOpen(false) }}>{t('common.cancel')}</Button>
              <Button onClick={() => void handleSubmit()} disabled={isSaving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{t('leadsAcq.keywordCondition')}</label>
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
                placeholder={t('leadsAcq.keywordPlaceholder')} style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }} />
            </div>
            <TextAreaField label={t('leadsAcq.ackTemplate')} value={leadAckTemplate} onChange={setLeadAckTemplate} rows={4} placeholder={t('leadsAcq.ackPlaceholder')} />
            <InputField label={t('leadsAcq.leadLabel')} value={leadLabel} onChange={setLeadLabel} placeholder={t('leadsAcq.leadLabelPlaceholder')} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-clay)', cursor: 'pointer' }}>
              <input type="checkbox" checked={leadAskContact} onChange={(e) => setLeadAskContact(e.target.checked)} style={{ accentColor: 'var(--miniapp-accent)' }} />
              {t('leadsAcq.askContact')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={leadAutoRespond} onChange={(e) => setLeadAutoRespond(e.target.checked)} />
              {t('leadsAcq.autoRespond')}
            </label>
            {leadAutoRespond && (
              <select
                value={leadRespondMode}
                onChange={(e) => setLeadRespondMode(e.target.value as 'public' | 'private' | 'private_with_forward')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--miniapp-border)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)', fontSize: 14, fontFamily: 'inherit' }}
              >
                <option value="public">{t('leadsAcq.respondPublic')}</option>
                <option value="private">{t('leadsAcq.respondPrivate')}</option>
                <option value="private_with_forward">{t('leadsAcq.respondPrivateWithForward')}</option>
              </select>
            )}
            {leadAutoRespond && (
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
            )}
            {leadAutoRespond && (
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
            )}
            <GroupAutocomplete label={t('leadsAcq.selectGroups')} query={taskGroupsQuery} onQueryChange={setTaskGroupsQuery} groups={groups} t={t}
              mode="multi" selected={taskGroups}
              onToggle={(g) => setTaskGroups((c) => c.some((e) => e.tg_group_id === g.tg_group_id) ? c.filter((e) => e.tg_group_id !== g.tg_group_id) : [...c, g])}
              onRemove={(id) => setTaskGroups((c) => c.filter((g) => g.tg_group_id !== id))} placeholder={t('leadsAcq.groupPlaceholder')} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button tone="secondary" onClick={() => { resetForm(); setIsFormOpen(false) }}>{t('common.cancel')}</Button>
              <Button onClick={() => void handleSaveLeadCapture()} disabled={isSaving || !canSubmit}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }
}
