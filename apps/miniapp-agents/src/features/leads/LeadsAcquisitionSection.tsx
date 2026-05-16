import { useEffect, useState } from 'react'

import { GroupAutocompleteField } from '../../components/GroupAutocompleteField'

import {
  agentsApi,
  Button,
  Card,
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

const SCRAPE_LIMIT_MAX = 50000
const SCRAPE_TASK_KEY = 'scraper_full_group'

function clampScrapeLimit(value: string) {
  return Math.max(1, Math.min(Number(value) || SCRAPE_LIMIT_MAX, SCRAPE_LIMIT_MAX))
}

function _formatKeywords(keywords: string[]): string {
  return keywords.join(',')
}

type LeadsTaskType = 'scrape' | 'lead_capture'

export function LeadsAcquisitionSection({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [taskType, setTaskType] = useState<LeadsTaskType>('scrape')
  const [status, setStatus] = useState<string | null>(null)

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
  const [taskGroupsQuery, setTaskGroupsQuery] = useState('')
  const [taskGroups, setTaskGroups] = useState<SelectedGroupChip[]>([])

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
    if (!scrapeSelectedGroup?.tg_group_id) { setStatus('Choose a group first'); return }
    setIsSaving(true)
    try {
      await agentsApi.createAgentJob(account.id, SCRAPE_TASK_KEY, {
        tg_group_id: Number(scrapeSelectedGroup.tg_group_id),
        scrape_members: true,
        scrape_messages: true,
        member_limit: clampScrapeLimit(scrapeMemberLimit),
        message_limit: clampScrapeLimit(scrapeMessageLimit),
        max_age_days: Math.max(1, Number(scrapeMaxAgeDays) || 30),
      })
      setStatus(null)
      onSaved(`Scraping job queued for ${scrapeSelectedGroup.title || scrapeSelectedGroup.tg_group_id}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to queue scrape job')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSaveLeadCapture() {
    if (!taskKeywords.length) { setStatus('At least one keyword is required'); return }
    setIsSaving(true)
    try {
      const config: Record<string, unknown> = {}
      if (leadAckTemplate.trim()) config.ack_template = leadAckTemplate.trim()
      if (leadLabel.trim()) config.lead_label = leadLabel.trim()
      if (leadAskContact) config.ask_contact = true
      await agentsApi.createGroupTask(account.group_id || 196, {
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
      onSaved('Lead capture task created')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save lead capture')
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
    setTaskGroupsQuery('')
    setTaskGroups([])
    setStatus(null)
  }

  return (
    <Card title="Lead Acquisition" subtitle="Collect member data and configure lead capture rules.">
      {status ? <Note>{status}</Note> : null}
      {!isFormOpen ? <Button onClick={() => setIsFormOpen(true)}>New Acquisition</Button> : null}
      {isFormOpen ? renderForm() : null}
    </Card>
  )

  function renderForm() {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <SelectField label="Task type" value={taskType} onChange={(v) => { setTaskType(v as LeadsTaskType); setStatus(null) }}>
          <option value="scrape">Scrape Group</option>
          <option value="lead_capture">Lead Capture</option>
        </SelectField>
        {isScrape ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <InputField label="Find group to scrape" value={scrapeGroupQuery} onChange={setScrapeGroupQuery} placeholder="Type group title or ID" />
            {loadingScrapeGroups ? <Note>Searching database...</Note> : null}
            {!loadingScrapeGroups && scrapeGroups.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {scrapeGroups.map((group, index) => (
                  <LinkRow key={`${group.tg_group_id ?? index}-${group.title ?? index}`} active={scrapeSelectedGroup?.tg_group_id === group.tg_group_id}
                    onClick={() => { setScrapeSelectedGroup(group); setScrapeGroupQuery(group.title || '') }}>
                    <strong>{group.title || `Group ${group.tg_group_id ?? index}`}</strong>
                    <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id ?? 'no tg id'} · members {group.member_count ?? 0}</div>
                  </LinkRow>
                ))}
              </div>
            ) : null}
            {scrapeSelectedGroup ? (
              <div style={{ display: 'grid', gap: 12 }}>
                <InputField label="Max members to scrape" value={scrapeMemberLimit} onChange={setScrapeMemberLimit} type="number" />
                <InputField label="Max messages to scrape" value={scrapeMessageLimit} onChange={setScrapeMessageLimit} type="number" />
                <InputField label="Max message age in days" value={scrapeMaxAgeDays} onChange={setScrapeMaxAgeDays} type="number" />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--miniapp-radius-sm)', border: '1px solid var(--miniapp-border-soft)', overflow: 'hidden' }}>
              <button type="button" onClick={() => void handleSubmit()} disabled={isSaving || !scrapeSelectedGroup}
                style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: (isSaving || !scrapeSelectedGroup) ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: (isSaving || !scrapeSelectedGroup) ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-coral)', color: (isSaving || !scrapeSelectedGroup) ? 'var(--miniapp-text-muted)' : '#fff' }}>
                {isSaving ? 'Queuing...' : 'Queue scrape job'}
              </button>
              <div style={{ width: 1, background: 'var(--miniapp-border-soft)' }} />
              <button type="button" onClick={() => { resetForm(); setIsFormOpen(false) }} style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
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
            <TextAreaField label="Acknowledgment template (optional)" value={leadAckTemplate} onChange={setLeadAckTemplate} rows={4} placeholder="We will get back to you shortly." />
            <InputField label="Lead label (optional)" value={leadLabel} onChange={setLeadLabel} placeholder="general" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-clay)', cursor: 'pointer' }}>
              <input type="checkbox" checked={leadAskContact} onChange={(e) => setLeadAskContact(e.target.checked)} style={{ accentColor: 'var(--miniapp-accent)' }} />
              Ask for contact details
            </label>
            <GroupAutocompleteField label="Select groups" query={taskGroupsQuery} onQueryChange={setTaskGroupsQuery} groups={groups}
              selectedGroups={taskGroups} onAdd={(g) => setTaskGroups((c) => c.some((e) => e.tg_group_id === g.tg_group_id) ? c : [...c, g])}
              onRemove={(id) => setTaskGroups((c) => c.filter((g) => g.tg_group_id !== id))} />
            <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--miniapp-radius-sm)', border: '1px solid var(--miniapp-border-soft)', overflow: 'hidden' }}>
              <button type="button" onClick={() => void handleSaveLeadCapture()} disabled={isSaving || !taskKeywords.length}
                style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: (isSaving || !taskKeywords.length) ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: (isSaving || !taskKeywords.length) ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-coral)', color: (isSaving || !taskKeywords.length) ? 'var(--miniapp-text-muted)' : '#fff' }}>
                {isSaving ? 'Working...' : 'Save'}
              </button>
              <div style={{ width: 1, background: 'var(--miniapp-border-soft)' }} />
              <button type="button" onClick={() => { resetForm(); setIsFormOpen(false) }} style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }
}
