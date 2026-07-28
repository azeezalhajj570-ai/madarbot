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
import type { AIModel, AIProviderDefaults } from '../lib/types'
import { useDashboardGroups } from '../lib/use-dashboard-groups'
import { useI18n } from '../lib/i18n'

export default function SettingsPage() {
  const { t } = useI18n()

  const PROVIDER_OPTIONS = [
    { value: 'heuristic', label: t('ai.provider.heuristic') },
    { value: 'openai', label: t('ai.provider.openai') },
    { value: 'gemini', label: t('ai.provider.gemini') },
    { value: 'openrouter', label: t('ai.provider.openrouter') },
  ]
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
  const [aiModels, setAIModels] = useState<AIModel[]>([])
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
        if (!cancelled) setError(t('settings.loadError'))
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

  const modelsByProvider = useMemo(() => {
    const grouped: Record<string, string[]> = {}
    for (const m of aiModels) {
      if (!grouped[m.provider]) grouped[m.provider] = []
      grouped[m.provider].push(m.name)
    }
    return grouped
  }, [aiModels])

  const modelOptions = useMemo(() => {
    return modelsByProvider[aiProvider] ?? []
  }, [aiProvider, modelsByProvider])

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
      toast.success(t('settings.requiredGroupsUpdated'))
    } catch {
      toast.error(t('settings.saveRequiredError'))
    } finally {
      setSavingGate(false)
    }
  }

  async function handleSaveScheduledMessage() {
    if (currentGroupId == null) return

    const deleteAfter = Number(messageDeleteAfter)
    if (!messageText.trim()) {
      setError(t('settings.scheduledMessageRequired'))
      return
    }
    if (!messageSchedule.trim()) {
      setError(t('settings.scheduleRequired'))
      return
    }
    if (!Number.isFinite(deleteAfter) || deleteAfter < 0) {
      setError(t('settings.deleteAfterInvalid'))
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
      toast.success(t('settings.scheduledMessagesUpdated'))
    } catch {
      toast.error(t('settings.scheduledMessagesError'))
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
      toast.success(t('settings.scheduledMessageDeleted'))
    } catch {
      toast.error(t('settings.scheduledMessageDeleteError'))
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
      toast.success(t('settings.aiProviderSaved'))
    } catch {
      toast.error(t('settings.aiProviderError'))
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
        toast.success(`${t('common.connected')}! ${t('common.response')}: ${result.reply}`)
      } else {
        toast.error(`${t('common.failed')}: ${result.error}`)
      }
    } catch {
      setAITestResult({ status: 'error', error: t('settings.connectionTestFailed') })
      toast.error(t('settings.connectionTestFailed'))
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
      setFeedback(t('ai.modelsSynced'))
    } catch {
      setError(t('ai.syncFailed'))
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
            placeholder={groups.length === 0 ? t('common.noData') : t('settings.searchGroups')}
            getLabel={(g: any) => g.title}
            getId={(g: any) => g.id}
          />
        </div>
      )}
    >
      {groupsError ? <InlineMessage tone="destructive">{groupsError}</InlineMessage> : null}
      {currentGroup ? <InlineMessage tone="neutral">{t('settings.editingSettingsFor')} {currentGroup.title}.</InlineMessage> : null}
      {error ? <InlineMessage tone="destructive">{error}</InlineMessage> : null}

      <Card title={t('settings.requiredGroups')} subtitle={t('settings.requiredGroupsDesc')}>
        <Field label={t('settings.selectGroups')} hint="">
          <Input
            value={requiredGroupsQuery}
            onChange={(event) => setRequiredGroupsQuery(event.target.value)}
            placeholder={t('settings.searchGroups')}
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
                  textAlign: 'start',
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
        <div style={{ marginTop: 12 }}><Button onClick={() => void handleSaveAccessGate()} disabled={savingGate || currentGroupId == null}>{savingGate ? t('common.saving') : t('settings.saveRequiredGroups')}</Button></div>
      </Card>

      <Card title={t('ai.provider')} subtitle={t('settings.aiProviderDesc')}>
        <Field label={t('ai.provider')}>
          <Select value={aiProvider} onChange={(e) => setAIProvider(e.target.value)}>
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </Field>

        {aiProvider === 'openai' && (
          <FieldRow>
            <Field label={t('ai.apiKey')} hint={t('settings.apiKeyLeaveBlank')}>
              <Input type="password" value={openaiApiKey} onChange={(e) => setOpenaiApiKey(e.target.value)} placeholder={aiDefaults?.openai_has_key ? '•••••••• (env default set)' : 'sk-...'} />
            </Field>
            <Field label={t('ai.generationModel')}>
              <Select value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                {(modelsByProvider.openai ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.openai_model ? ` ${t('common.default')}` : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'gemini' && (
          <FieldRow>
            <Field label={t('ai.apiKey')} hint={t('settings.apiKeyLeaveBlank')}>
              <Input type="password" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} placeholder={aiDefaults?.gemini_has_key ? '•••••••• (env default set)' : 'AIza...'} />
            </Field>
            <Field label={t('ai.generationModel')}>
              <Select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
                {(modelsByProvider.gemini ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.gemini_model ? ` ${t('common.default')}` : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'openrouter' && (
          <FieldRow>
            <Field label={t('ai.apiKey')} hint={t('settings.apiKeyLeaveBlank')}>
              <Input type="password" value={openrouterApiKey} onChange={(e) => setOpenrouterApiKey(e.target.value)} placeholder={aiDefaults?.openrouter_has_key ? '•••••••• (env default set)' : 'sk-or-...'} />
            </Field>
            <Field label={t('ai.generationModel')}>
              <Select value={openrouterModel} onChange={(e) => setOpenrouterModel(e.target.value)}>
                {(modelsByProvider.openrouter ?? []).map((m) => (
                  <option key={m} value={m}>{m}{m === aiDefaults?.openrouter_model ? ` ${t('common.default')}` : ''}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}

        {aiProvider === 'heuristic' && (
          <InlineMessage tone="neutral">{t('settings.heuristicMode')}</InlineMessage>
        )}

        <div style={{ marginTop: 16, marginBottom: 16, borderTop: '1px solid var(--ui-border)', paddingTop: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>{t('settings.aiFeatures')}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <ToggleRow
              title={t('settings.aiSpamDetection')}
              subtitle={t('settings.aiSpamDetectionHint')}
              checked={aiSpamDetection}
              onCheckedChange={setAISpamDetection}
            />
            <ToggleRow
              title={t('settings.aiReceptionist')}
              subtitle={t('settings.aiReceptionistHint')}
              checked={aiReceptionist}
              onCheckedChange={setAIReceptionist}
            />
            <ToggleRow
              title={t('settings.knowledgeExtraction')}
              subtitle={t('settings.knowledgeExtractionHint')}
              checked={knowledgeExtraction}
              onCheckedChange={setKnowledgeExtraction}
            />
            <ToggleRow
              title={t('settings.dailySummary')}
              subtitle={t('settings.dailySummaryHint')}
              checked={dailySummary}
              onCheckedChange={setDailySummary}
            />
            <ToggleRow
              title={t('settings.faqAutoAnswer')}
              subtitle={t('settings.faqAutoAnswerHint')}
              checked={faqAutoAnswer}
              onCheckedChange={setFaqAutoAnswer}
            />
            <ToggleRow
              title={t('settings.aiPilot')}
              subtitle={t('settings.aiPilotHint')}
              checked={aiPilot}
              onCheckedChange={setAIPilot}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={() => void handleSaveAI()} disabled={savingAI || currentGroupId == null}>
            {savingAI ? t('common.saving') : t('settings.saveAISettings')}
          </Button>
          <Button variant="outline" onClick={() => void handleTestAI()} disabled={testingAI || aiProvider === 'heuristic'}>
            {testingAI ? t('common.testing') : t('ai.testConnection')}
          </Button>
          <Button variant="outline" onClick={() => void handleSyncModels()} disabled={syncingModels}>
            {syncingModels ? t('common.syncing') : t('ai.syncModels')}
          </Button>
        </div>
      </Card>

      <Card title={t('settings.scheduledMessages')} subtitle={t('settings.scheduledMessagesDesc')}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Button onClick={openCreateDialog} disabled={currentGroupId == null}>{t('settings.newScheduledMessage')}</Button>
        </div>
        {scheduledMessages.length > 0 ? (
          <div style={{ display: 'grid' }}>
            {scheduledMessages.map((message) => (
              <ListItem
                key={message.id}
                title={message.text}
                subtitle={`${t('settings.schedule')} ${message.schedule} ${t('settings.nextSend')} ${new Date(message.send_at).toLocaleString()}`}
                meta={<Badge tone="info">{message.delete_after_seconds ? `${t('settings.deleteAfter')} ${message.delete_after_seconds}s` : t('settings.keepMessage')}</Badge>}
                actions={(
                  <>
                    <Button variant="outline" onClick={() => openEditDialog(message)}>{t('common.edit')}</Button>
                    <Button variant="destructive" onClick={() => void handleDeleteScheduledMessage(message)}>{t('common.delete')}</Button>
                  </>
                )}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={t('settings.noScheduledMessages')} subtitle={t('settings.noScheduledMessagesDesc')} action={<Button onClick={openCreateDialog} disabled={currentGroupId == null}>{t('settings.createOne')}</Button>} />
        )}
      </Card>

      <Dialog
        open={editorOpen}
        title={editingMessage ? t('settings.editScheduledMessage') : t('settings.createScheduledMessage')}
        description={t('settings.scheduleDialogDesc')}
        onClose={() => setEditorOpen(false)}
      >
        <Field label={t('settings.messageText')}>
          <Textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder={t('settings.messagePlaceholder')} />
        </Field>
        <FieldRow>
          <Field label={t('settings.scheduleLabel')} hint={t('settings.scheduleHint')}>
            <Input value={messageSchedule} onChange={(event) => setMessageSchedule(event.target.value)} />
          </Field>
          <Field label={t('settings.deleteAfterSeconds')} hint={t('settings.deleteAfterHint')}>
            <Input type="number" min={0} value={messageDeleteAfter} onChange={(event) => setMessageDeleteAfter(event.target.value)} />
          </Field>
        </FieldRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={() => setEditorOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => void handleSaveScheduledMessage()} disabled={savingMessage}>{savingMessage ? t('common.saving') : editingMessage ? t('settings.saveChanges') : t('settings.createMessage')}</Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
