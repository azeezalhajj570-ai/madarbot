import { useEffect, useMemo, useState } from 'react'

import { Badge, Button, Card, Dialog, EmptyState, Field, FieldRow, InlineMessage, Input, ListItem, Select, Textarea, ToggleRow } from '../components/ui/primitives'
import { useToast } from '../components/ui/toast'
import { GroupAutoComplete } from '../components/ui/data-display'
import { PageShell } from '../lib/page-shell'
import {
  createScheduledMessage,
  deleteScheduledMessage,
  fetchAccessGate,
  fetchAIProviderDefaults,
  fetchAIModels,
  fetchGroupSettings,
  fetchScheduledMessages,
  syncAIModels,
  testAIPilot,
  updateAccessGate,
  updateGroupSettings,
  updateScheduledMessage,
  type ScheduledMessage,
} from '../lib/api'
import type { AIProviderDefaults } from '../lib/types'
import { useDashboardGroups } from '../lib/use-dashboard-groups'
import { useI18n } from '../lib/i18n'

const PROVIDER_OPTIONS = [
  { value: 'heuristic', label: 'Heuristic (rule-based)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
]

export default function SettingsPage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const { groups, currentGroup, currentGroupId, setCurrentGroupId, loading: groupsLoading, error: groupsError } = useDashboardGroups()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [requiredGroupIds, setRequiredGroupIds] = useState<number[]>([])
  const [requiredGroupsQuery, setRequiredGroupsQuery] = useState('')
  const [requiredGroupCandidates, setRequiredGroupCandidates] = useState<Array<{ tg_group_id?: number; title?: string; role?: string }>>([])
  const [savingGate, setSavingGate] = useState(false)
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null)
  const [messageText, setMessageText] = useState('')
  const [messageSchedule, setMessageSchedule] = useState('+1h')
  const [messageDeleteAfter, setMessageDeleteAfter] = useState('0')
  const [savingMessage, setSavingMessage] = useState(false)

  const [aiDefaults, setAIDefaults] = useState<AIProviderDefaults | null>(null)
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({})
  const [aiProvider, setAIProvider] = useState('heuristic')
  const [aiModel, setAIModel] = useState('')
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('gpt-4.1-mini')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-1.5-flash')
  const [openrouterApiKey, setOpenrouterApiKey] = useState('')
  const [openrouterModel, setOpenrouterModel] = useState('google/gemini-2.0-flash-001')
  const [aiSpamDetection, setAISpamDetection] = useState(false)
  const [aiReceptionist, setAIReceptionist] = useState(false)
  const [knowledgeExtraction, setKnowledgeExtraction] = useState(false)
  const [dailySummary, setDailySummary] = useState(false)
  const [faqAutoAnswer, setFaqAutoAnswer] = useState(false)
  const [aiPilot, setAIPilot] = useState(false)
  const [savingAI, setSavingAI] = useState(false)
  const [testingAI, setTestingAI] = useState(false)
  const [aiTestResult, setAITestResult] = useState<{ status: string; reply?: string; error?: string } | null>(null)
  const [syncingModels, setSyncingModels] = useState(false)

  useEffect(() => {
    if (currentGroupId == null) {
      setLoading(groupsLoading)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const [gate, messages, defaults, groupSettings, models] = await Promise.all([
          fetchAccessGate(currentGroupId),
          fetchScheduledMessages(currentGroupId),
          fetchAIProviderDefaults(),
          fetchGroupSettings(currentGroupId),
          fetchAIModels(),
        ])
        if (cancelled) return

        setRequiredGroupIds(gate.required_group_tg_ids)
        setRequiredGroupCandidates(gate.candidates ?? [])
        setScheduledMessages(messages)
        setAIDefaults(defaults)
        setAIModels(models)

        const overrides = groupSettings.settings
        setAIProvider(String(overrides.ai_provider ?? defaults.ai_provider))
        setAIModel(String(overrides.ai_model ?? defaults.ai_model ?? ''))
        setOpenaiApiKey(String(overrides.openai_api_key ?? ''))
        setOpenaiModel(String(overrides.openai_model ?? defaults.openai_model))
        setGeminiApiKey(String(overrides.gemini_api_key ?? ''))
        setGeminiModel(String(overrides.gemini_model ?? defaults.gemini_model))
        setOpenrouterApiKey(String(overrides.openrouter_api_key ?? ''))
        setOpenrouterModel(String(overrides.openrouter_model ?? defaults.openrouter_model))
        setAISpamDetection(overrides.ai_spam_detection_enabled === true || (overrides.ai_spam_detection_enabled === undefined && defaults.ai_spam_detection_enabled))
        setAIReceptionist(overrides.ai_receptionist_enabled === true || (overrides.ai_receptionist_enabled === undefined && defaults.ai_receptionist_enabled))
        setKnowledgeExtraction(overrides.knowledge_extraction_enabled === true || (overrides.knowledge_extraction_enabled === undefined && defaults.knowledge_extraction_enabled))
        setDailySummary(overrides.daily_summary_enabled === true || (overrides.daily_summary_enabled === undefined && defaults.daily_summary_enabled))
        setFaqAutoAnswer(overrides.faq_auto_answer_enabled === true || (overrides.faq_auto_answer_enabled === undefined && defaults.faq_auto_answer_enabled))
        setAIPilot(overrides.ai_pilot_enabled === true || (overrides.ai_pilot_enabled === undefined && defaults.ai_pilot_enabled))
      } catch {
        if (!cancelled) setError('Unable to load group settings right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [currentGroupId, groupsLoading])

  const selectedRequiredGroups = useMemo(() => {
    const selectedIds = new Set(requiredGroupIds)
    return requiredGroupCandidates.filter((candidate) => {
      const tgGroupId = Number(candidate.tg_group_id)
      return tgGroupId && selectedIds.has(tgGroupId)
    })
  }, [requiredGroupCandidates, requiredGroupIds])

  const requiredGroupSuggestions = useMemo(() => {
    const selectedIds = new Set(requiredGroupIds)
    const query = requiredGroupsQuery.trim().toLowerCase()

    return requiredGroupCandidates.filter((candidate) => {
      const tgGroupId = Number(candidate.tg_group_id)
      if (!tgGroupId || selectedIds.has(tgGroupId)) return false
      if (!query) return true

      return [candidate.title || '', candidate.role || '', String(candidate.tg_group_id || '')]
        .some((value) => value.toLowerCase().includes(query))
    })
  }, [requiredGroupCandidates, requiredGroupIds, requiredGroupsQuery])

  const modelOptions = useMemo(() => {
    return aiModels[aiProvider] ?? []
  }, [aiProvider, aiModels])

  const currentModel = useMemo(() => {
    if (aiProvider === 'openai') return openaiModel
    if (aiProvider === 'gemini') return geminiModel
    if (aiProvider === 'openrouter') return openrouterModel
    return aiModel
  }, [aiProvider, openaiModel, geminiModel, openrouterModel, aiModel])

  function openCreateDialog() {
    setEditingMessage(null)
    setMessageText('')
    setMessageSchedule('+1h')
    setMessageDeleteAfter('0')
    setEditorOpen(true)
  }

  function openEditDialog(message: ScheduledMessage) {
    setEditingMessage(message)
    setMessageText(message.text)
    setMessageSchedule(message.schedule)
    setMessageDeleteAfter(String(message.delete_after_seconds ?? 0))
    setEditorOpen(true)
  }

  async function handleSaveAccessGate() {
    if (currentGroupId == null) return

    setSavingGate(true)
    setError('')
    try {
      const updated = await updateAccessGate(currentGroupId, requiredGroupIds)
      setRequiredGroupIds(updated.required_group_tg_ids)
      setRequiredGroupCandidates(updated.candidates ?? [])
      toast.success('Required groups updated.')
    } catch {
      toast.error('Unable to save required groups right now.')
    } finally {
      setSavingGate(false)
    }
  }

  async function handleSaveScheduledMessage() {
    if (currentGroupId == null) return

    const deleteAfter = Number(messageDeleteAfter)
    if (!messageText.trim()) {
      setError('Scheduled message text is required.')
      return
    }
    if (!messageSchedule.trim()) {
      setError('Schedule is required.')
      return
    }
    if (!Number.isFinite(deleteAfter) || deleteAfter < 0) {
      setError('Delete after seconds must be 0 or a positive number.')
      return
    }

    setSavingMessage(true)
    setError('')
    try {
      if (editingMessage) {
        const response = await updateScheduledMessage(currentGroupId, editingMessage.id, {
          text: messageText.trim(),
          schedule: messageSchedule.trim(),
          delete_after_seconds: deleteAfter || undefined,
        })
        setScheduledMessages((current) => current.map((item) => item.id === editingMessage.id ? response.scheduled_message : item))
      } else {
        const response = await createScheduledMessage(currentGroupId, {
          text: messageText.trim(),
          schedule: messageSchedule.trim(),
          delete_after_seconds: deleteAfter || undefined,
        })
        setScheduledMessages((current) => [response.scheduled_message, ...current])
      }
      setEditorOpen(false)
      toast.success('Scheduled messages updated.')
    } catch {
      toast.error('Unable to save the scheduled message.')
    } finally {
      setSavingMessage(false)
    }
  }

  async function handleDeleteScheduledMessage(message: ScheduledMessage) {
    if (currentGroupId == null) return
    setError('')
    try {
      await deleteScheduledMessage(currentGroupId, message.id)
      setScheduledMessages((current) => current.filter((item) => item.id !== message.id))
      toast.success('Scheduled message deleted.')
    } catch {
      toast.error('Unable to delete the scheduled message.')
    }
  }

  function addRequiredGroup(tgGroupId: number) {
    setRequiredGroupIds((current) => current.includes(tgGroupId) ? current : [...current, tgGroupId])
    setRequiredGroupsQuery('')
  }

  function removeRequiredGroup(tgGroupId: number) {
    setRequiredGroupIds((current) => current.filter((id) => id !== tgGroupId))
  }

  async function handleSaveAI() {
    if (currentGroupId == null) return

    setSavingAI(true)
    setError('')
    setAITestResult(null)
    try {
      const settings: Record<string, string | boolean | number> = {
        ai_provider: aiProvider,
        ai_model: aiModel || '',
        openai_api_key: openaiApiKey,
        openai_model: aiProvider === 'openai' ? openaiModel : '',
        gemini_api_key: geminiApiKey,
        gemini_model: aiProvider === 'gemini' ? geminiModel : '',
        openrouter_api_key: openrouterApiKey,
        openrouter_model: aiProvider === 'openrouter' ? openrouterModel : '',
        ai_spam_detection_enabled: aiSpamDetection,
        ai_receptionist_enabled: aiReceptionist,
        knowledge_extraction_enabled: knowledgeExtraction,
        daily_summary_enabled: dailySummary,
        faq_auto_answer_enabled: faqAutoAnswer,
        ai_pilot_enabled: aiPilot,
      }
      await updateGroupSettings(currentGroupId, settings)
      toast.success('AI provider settings saved.')
    } catch {
      toast.error('Unable to save AI provider settings.')
    } finally {
      setSavingAI(false)
    }
  }

  async function handleTestAI() {
    setTestingAI(true)
    setAITestResult(null)
    setError('')
    try {
      const model = aiProvider === 'openai' ? openaiModel
        : aiProvider === 'gemini' ? geminiModel
        : aiProvider === 'openrouter' ? openrouterModel
        : aiModel || undefined

      const payload: { provider?: string; model?: string } = {}
      if (aiProvider !== 'heuristic') {
        payload.provider = aiProvider
        if (model) payload.model = model
      }

      const result = await testAIPilot(payload)
      setAITestResult(result)
      if (result.status === 'ok') {
        toast.success(`Connected! Response: ${result.reply}`)
      } else {
        toast.error(`Failed: ${result.error}`)
      }
    } catch {
      setAITestResult({ status: 'error', error: 'Connection test failed.' })
      toast.error('Connection test failed.')
    } finally {
      setTestingAI(false)
    }
  }

  async function handleSyncModels() {
    setSyncingModels(true)
    setError('')
    setFeedback('')
    try {
      const result = await syncAIModels()
      setAIModels(result.models)
      setFeedback('Models synced from providers.')
    } catch {
      setError('Failed to sync models.')
    } finally {
      setSyncingModels(false)
    }
  }

  return (
    <PageShell
     
      titleKey="page.settings"
      descriptionKey="page.settings.desc"
      loading={loading}
      actions={(
        <div style={{ minWidth: 240 }}>
          <GroupAutoComplete
            items={groups || []}
            value={currentGroupId}
            onChange={setCurrentGroupId}
            placeholder={groups.length === 0 ? 'No managed groups' : 'Search groups...'}
            getLabel={(g: any) => g.title}
            getId={(g: any) => g.id}
          />
        </div>
      )}
    >
      {groupsError ? <InlineMessage tone="destructive">{groupsError}</InlineMessage> : null}
      {currentGroup ? <InlineMessage tone="neutral">Editing settings for {currentGroup.title}.</InlineMessage> : null}
      {error ? <InlineMessage tone="destructive">{error}</InlineMessage> : null}

      <Card title="Required groups" subtitle="Search managed groups by name, role, or Telegram ID and add multiple requirements.">
        <Field label="Select groups" hint="">
          <Input
            value={requiredGroupsQuery}
            onChange={(event) => setRequiredGroupsQuery(event.target.value)}
            placeholder="Search groups"
          />
        </Field>
        {selectedRequiredGroups.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {selectedRequiredGroups.map((candidate) => (
              <button
                key={candidate.tg_group_id}
                onClick={() => removeRequiredGroup(Number(candidate.tg_group_id))}
                style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
              >
                <Badge tone="neutral">
                  {candidate.title ?? candidate.tg_group_id} {candidate.role ? `· ${candidate.role}` : ''} ×
                </Badge>
              </button>
            ))}
          </div>
        ) : null}
        {requiredGroupSuggestions.length > 0 ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {requiredGroupSuggestions.slice(0, 8).map((candidate) => (
              <button
                key={candidate.tg_group_id}
                onClick={() => addRequiredGroup(Number(candidate.tg_group_id))}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid var(--ui-border)',
                  borderRadius: 10,
                  background: 'var(--ui-surface-alt)',
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700 }}>{candidate.title ?? candidate.tg_group_id}</span>
                <span style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>
                  {candidate.role ? `${candidate.role} · ` : ''}{candidate.tg_group_id}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 12 }}><Button onClick={() => void handleSaveAccessGate()} disabled={savingGate || currentGroupId == null}>{savingGate ? 'Saving…' : 'Save required groups'}</Button></div>
      </Card>

      <Card title="AI Provider" subtitle="Configure the AI provider and model for this group. Settings here override environment defaults.">
        <Field label="AI Provider">
          <Select value={aiProvider} onChange={(e) => setAIProvider(e.target.value)}>
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </Field>

        {aiProvider === 'openai' && (
          <FieldRow>
            <Field label="OpenAI API Key" hint="Leave blank to use env default">
              <Input type="password" value={openaiApiKey} onChange={(e) => setOpenaiApiKey(e.target.value)} placeholder={aiDefaults?.openai_has_key ? '•••••••• (env default set)' : 'sk-...'} />
            </Field>
            <Field label="Model">
              <Select value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                {(aiModels.openai ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.openai_model ? ' (default)' : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'gemini' && (
          <FieldRow>
            <Field label="Gemini API Key" hint="Leave blank to use env default">
              <Input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder={aiDefaults?.gemini_has_key ? '•••••••• (env default set)' : 'AIza...'} />
            </Field>
            <Field label="Model">
              <Select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
                {(aiModels.gemini ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.gemini_model ? ' (default)' : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'openrouter' && (
          <FieldRow>
            <Field label="OpenRouter API Key" hint="Leave blank to use env default">
              <Input type="password" value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)} placeholder={aiDefaults?.openrouter_has_key ? '•••••••• (env default set)' : 'sk-or-...'} />
            </Field>
            <Field label="Model">
              <Select value={openrouterModel} onChange={(e) => setOpenrouterModel(e.target.value)}>
                {(aiModels.openrouter ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.openrouter_model ? ' (default)' : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'heuristic' && (
          <InlineMessage tone="neutral">Heuristic mode uses rule-based logic without any AI provider. No API key or model needed.</InlineMessage>
        )}

        <div style={{ marginTop: 16, marginBottom: 16, borderTop: '1px solid var(--ui-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>AI Features</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <ToggleRow
              title="AI Spam Detection"
              subtitle="Use AI to detect and flag spam messages"
              checked={aiSpamDetection}
              onCheckedChange={setAISpamDetection}
            />
            <ToggleRow
              title="AI Receptionist"
              subtitle="Auto-respond to welcome messages using AI"
              checked={aiReceptionist}
              onCheckedChange={setAIReceptionist}
            />
            <ToggleRow
              title="Knowledge Extraction"
              subtitle="Extract structured knowledge from group messages"
              checked={knowledgeExtraction}
              onCheckedChange={setKnowledgeExtraction}
            />
            <ToggleRow
              title="Daily Summary"
              subtitle="Generate AI-powered daily group summaries"
              checked={dailySummary}
              onCheckedChange={setDailySummary}
            />
            <ToggleRow
              title="FAQ Auto-Answer"
              subtitle="Auto-answer frequently asked questions using AI"
              checked={faqAutoAnswer}
              onCheckedChange={setFaqAutoAnswer}
            />
            <ToggleRow
              title="AI Pilot"
              subtitle="Let AI assist with group management tasks"
              checked={aiPilot}
              onCheckedChange={setAIPilot}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => void handleSaveAI()} disabled={savingAI || currentGroupId == null}>
            {savingAI ? 'Saving…' : 'Save AI settings'}
          </Button>
          <Button variant="outline" onClick={() => void handleTestAI()} disabled={testingAI || aiProvider === 'heuristic'}>
            {testingAI ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="outline" onClick={() => void handleSyncModels()} disabled={syncingModels}>
            {syncingModels ? 'Syncing…' : 'Sync models'}
          </Button>
        </div>
      </Card>

      <Card title="Scheduled messages" subtitle="Create recurring or one-off reminders for the selected group.">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Button onClick={openCreateDialog} disabled={currentGroupId == null}>New scheduled message</Button>
        </div>
        {scheduledMessages.length > 0 ? (
          <div style={{ display: 'grid' }}>
            {scheduledMessages.map((message) => (
              <ListItem
                key={message.id}
                title={message.text}
                subtitle={`Schedule: ${message.schedule} · Next send: ${new Date(message.send_at).toLocaleString()}`}
                meta={<Badge tone="info">{message.delete_after_seconds ? `Delete after ${message.delete_after_seconds}s` : 'Keep message'}</Badge>}
                actions={(
                  <>
                    <Button variant="outline" onClick={() => openEditDialog(message)}>Edit</Button>
                    <Button variant="destructive" onClick={() => void handleDeleteScheduledMessage(message)}>Delete</Button>
                  </>
                )}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No scheduled messages" subtitle="Use the group scheduler for recurring reminders, announcements, and cleanup-friendly notices." action={<Button onClick={openCreateDialog} disabled={currentGroupId == null}>Create one</Button>} />
        )}
      </Card>

      <Dialog
        open={editorOpen}
        title={editingMessage ? 'Edit scheduled message' : 'Create scheduled message'}
        description="The scheduler accepts relative times like +10m or cron expressions like */15 * * * *."
        onClose={() => setEditorOpen(false)}
      >
        <Field label="Message text">
          <Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Deploy reminder" />
        </Field>
        <FieldRow>
          <Field label="Schedule" hint="Examples: +10m, +1h, 0 9 * * *">
            <Input value={messageSchedule} onChange={(event) => setMessageSchedule(event.target.value)} />
          </Field>
          <Field label="Delete after seconds" hint="Use 0 to keep the message after sending.">
            <Input type="number" min={0} value={messageDeleteAfter} onChange={(event) => setMessageDeleteAfter(event.target.value)} />
          </Field>
        </FieldRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleSaveScheduledMessage()} disabled={savingMessage}>{savingMessage ? 'Saving…' : editingMessage ? 'Save changes' : 'Create message'}</Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
