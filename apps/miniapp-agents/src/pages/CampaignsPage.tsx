import { useEffect, useState } from 'react'

import { MultiGroupSelect } from '../components/MultiGroupSelect'
import { FormActions } from '../components/FormActions'

import {
  agentsApi,
  Button,
  Card,
  InputField,
  Note,
  TextAreaField,
} from '@miniapp/shared'
import type {
  Agent,
  AgentManagedGroup,
  Campaign,
  CampaignSendLogEntry,
} from '@miniapp/shared'

type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

export function CampaignsPage({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignsStatus, setCampaignsStatus] = useState<string | null>(null)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createMessage, setCreateMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Detail view
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null)
  const [showSendPicker, setShowSendPicker] = useState(false)
  const [sendGroupQuery, setSendGroupQuery] = useState('')
  const [sendGroups, setSendGroups] = useState<AgentManagedGroup[]>([])
  const [sendSelectedGroups, setSendSelectedGroups] = useState<SelectedGroupChip[]>([])
  const [sendLoading, setSendLoading] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  // Send logs
  const [sendLogs, setSendLogs] = useState<CampaignSendLogEntry[]>([])
  const [sendLogsTotal, setSendLogsTotal] = useState(0)
  const [sendLogsPage, setSendLogsPage] = useState(1)
  const [loadingSendLogs, setLoadingSendLogs] = useState(false)

  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    loadCampaigns()
  }, [account.id])

  async function loadCampaigns() {
    setLoadingCampaigns(true)
    try {
      const result = await agentsApi.listCampaigns(account.id)
      setCampaigns(result.items)
    } catch {
      setCampaignsStatus('Failed to load campaigns')
    } finally {
      setLoadingCampaigns(false)
    }
  }

  useEffect(() => {
    if (!sendGroupQuery.trim()) { setSendGroups([]); return }
    const timer = setTimeout(() => {
      void agentsApi.fetchAgentGroups(account.id, sendGroupQuery)
        .then(setSendGroups)
        .catch(() => setSendGroups([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [account.id, sendGroupQuery])

  async function loadSendLogs(campaignId: number, page = 1) {
    setLoadingSendLogs(true)
    setSendLogsPage(page)
    try {
      const result = await agentsApi.getCampaignSendLogs(account.id, campaignId, { page, page_size: 50 })
      setSendLogs(result.items)
      setSendLogsTotal(result.total)
    } catch {
      setStatus('Failed to load send logs')
    } finally {
      setLoadingSendLogs(false)
    }
  }

  function resetCreateForm() {
    setCreateName('')
    setCreateDescription('')
    setCreateMessage('')
    setStatus(null)
  }

  async function handleCreate() {
    if (!createName.trim()) { setStatus('Campaign name is required'); return }
    if (!createMessage.trim()) { setStatus('Message template is required'); return }

    setIsSaving(true)
    try {
      await agentsApi.createCampaign(account.id, {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        message_template: createMessage.trim(),
      })
      resetCreateForm()
      setShowCreateForm(false)
      onSaved('Campaign created')
      await loadCampaigns()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create campaign')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSend(campaign: Campaign) {
    if (!sendSelectedGroups.length) { setSendResult('Select at least one group'); return }

    setSendLoading(true)
    setSendResult(null)
    try {
      const result = await agentsApi.sendCampaign(account.id, campaign.id, {
        group_ids: sendSelectedGroups.map((g) => g.tg_group_id),
      })
      setSendResult(`${result.jobs_created} job(s) created`)
      setSendSelectedGroups([])
      setShowSendPicker(false)
      onSaved(`Sent to ${result.jobs_created} group(s)`)
      await loadCampaigns()
      await loadSendLogs(campaign.id)
    } catch (error) {
      setSendResult(error instanceof Error ? error.message : 'Failed to send')
    } finally {
      setSendLoading(false)
    }
  }

  async function viewCampaign(campaign: Campaign) {
    try {
      const c = await agentsApi.getCampaign(account.id, campaign.id)
      setDetailCampaign(c)
      setSendLogs([])
      setSendLogsTotal(0)
      setSendLogsPage(1)
      setShowSendPicker(false)
      setSendResult(null)
      if (c.status !== 'draft') {
        await loadSendLogs(c.id)
      }
    } catch {
      setStatus('Failed to load campaign')
    }
  }

  // Detail view
  if (detailCampaign) {
    return (
      <Card title={detailCampaign.name} subtitle={`Status: ${detailCampaign.status}`}>
        {status ? <Note>{status}</Note> : null}
        <div style={{ display: 'grid', gap: 8, marginBottom: 12, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)', fontSize: 13 }}>
          {detailCampaign.description ? <div>{detailCampaign.description}</div> : null}
          {detailCampaign.message_template ? <div style={{ color: 'var(--miniapp-text-muted)' }}>Template: {detailCampaign.message_template}</div> : null}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span>Sent: <strong>{detailCampaign.sent_count}</strong></span>
            <span>Failed: <strong>{detailCampaign.failed_count}</strong></span>
            <span>Skipped: <strong>{detailCampaign.skipped_count}</strong></span>
          </div>
          {detailCampaign.started_at ? <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>First send: {new Date(detailCampaign.started_at).toLocaleString()}</div> : null}
        </div>

        {!showSendPicker ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={() => { setShowSendPicker(true); setSendResult(null) }}>Send to Groups</Button>
            <Button tone="secondary" onClick={() => { setDetailCampaign(null) }}>Back</Button>
            {detailCampaign.status !== 'draft' ? (
              <Button tone="secondary" onClick={() => loadSendLogs(detailCampaign.id, 1)}>Refresh Logs</Button>
            ) : null}
          </div>
        ) : null}

        {showSendPicker ? (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <MultiGroupSelect query={sendGroupQuery} onQueryChange={setSendGroupQuery} groups={sendGroups} selected={sendSelectedGroups}
              onToggle={(g) => setSendSelectedGroups((c) => c.some((x) => x.tg_group_id === g.tg_group_id) ? c.filter((x) => x.tg_group_id !== g.tg_group_id) : [...c, g])} />
            {sendResult ? <Note>{sendResult}</Note> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => handleSend(detailCampaign)} disabled={sendLoading || !sendSelectedGroups.length}>
                {sendLoading ? 'Sending...' : `Send to ${sendSelectedGroups.length} group(s)`}
              </Button>
              <Button tone="secondary" onClick={() => { setShowSendPicker(false); setSendSelectedGroups([]); setSendResult(null) }}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {loadingSendLogs ? <Note>Loading send logs...</Note> : null}
        {!loadingSendLogs && sendLogs.length > 0 ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>Send Logs ({sendLogsTotal})</strong>
            {sendLogs.map((log) => (
              <div key={log.id} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', fontSize: 12, display: 'grid', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600 }}>User {log.tg_user_id ?? 'N/A'}</span>
                  <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: log.status === 'sent' ? 'var(--miniapp-sage-dim)' : log.status === 'failed' ? 'rgba(161,87,62,0.12)' : 'var(--miniapp-bg-deep)',
                    color: log.status === 'sent' ? 'var(--miniapp-sage)' : log.status === 'failed' ? 'var(--miniapp-clay)' : 'var(--miniapp-text-muted)',
                  }}>{log.status}</span>
                </div>
                <div style={{ color: 'var(--miniapp-text-muted)' }}>{log.message_text.slice(0, 80)}</div>
                {log.sent_at ? <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{new Date(log.sent_at).toLocaleString()}</div> : null}
              </div>
            ))}
            {sendLogsTotal > 50 ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                <Button tone="secondary" disabled={sendLogsPage <= 1} onClick={() => loadSendLogs(detailCampaign.id, sendLogsPage - 1)}>Prev</Button>
                <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', alignSelf: 'center' }}>{sendLogsPage}</span>
                <Button tone="secondary" disabled={sendLogsPage * 50 >= sendLogsTotal} onClick={() => loadSendLogs(detailCampaign.id, sendLogsPage + 1)}>Next</Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loadingSendLogs && detailCampaign.status !== 'draft' && sendLogs.length === 0 ? (
          <Note>No send logs yet.</Note>
        ) : null}
      </Card>
    )
  }

  // List view
  return (
    <>
      <Card title="Campaigns" subtitle="Create a campaign once, send to any group anytime.">
        {status ? <Note>{status}</Note> : null}
        {campaignsStatus ? <Note>{campaignsStatus}</Note> : null}

        {!showCreateForm ? (
          <Button onClick={() => { resetCreateForm(); setShowCreateForm(true) }}>New Campaign</Button>
        ) : null}

        {showCreateForm ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <InputField label="Campaign Name" value={createName} onChange={setCreateName} placeholder="Summer promotion" />
            <InputField label="Description (optional)" value={createDescription} onChange={setCreateDescription} placeholder="Describe the campaign goal" />
            <TextAreaField label="Message Template" value={createMessage} onChange={setCreateMessage} rows={5} placeholder="Hello, this is our latest update." />
            <FormActions submitLabel={isSaving ? 'Creating...' : 'Create Campaign'} submitDisabled={isSaving} onSubmit={() => void handleCreate()} onCancel={() => { resetCreateForm(); setShowCreateForm(false) }} />
          </div>
        ) : null}
      </Card>

      {loadingCampaigns ? <Note>Loading campaigns...</Note> : null}
      {!loadingCampaigns && campaigns.length > 0 ? (
        <Card title="All Campaigns" subtitle="Tap a campaign to send or view logs.">
          <div style={{ display: 'grid', gap: 6 }}>
            {campaigns.map((c) => (
              <div key={c.id} onClick={() => viewCampaign(c)} style={{ cursor: 'pointer', padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)', display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>{c.name}</strong>
                  <span style={{ padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600,
                    background: c.status === 'completed' ? 'var(--miniapp-sage-dim)' : c.status === 'running' ? 'rgba(90,122,90,0.12)' : c.status === 'draft' ? 'var(--miniapp-bg-deep)' : 'rgba(161,87,62,0.12)',
                    color: c.status === 'completed' ? 'var(--miniapp-sage)' : c.status === 'running' ? 'var(--miniapp-sage)' : 'var(--miniapp-text-muted)',
                  }}>{c.status}</span>
                </div>
                {c.description ? <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>{c.description}</div> : null}
                <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', display: 'flex', gap: 12 }}>
                  <span>Sent: {c.sent_count}</span>
                  <span>Failed: {c.failed_count}</span>
                  <span>Skipped: {c.skipped_count}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--miniapp-text-muted)' }}>{new Date(c.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {!loadingCampaigns && campaigns.length === 0 ? <Note>No campaigns yet. Create one above.</Note> : null}
    </>
  )
}
