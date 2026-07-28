import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'

import { fetchAIConfig, fetchAIModels, syncAIModels, updateAIConfig, testAIConfig } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Field, FieldRow, InlineMessage, Input, Select } from '../../components/ui/primitives'

export default function AdminAISettingsPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: fetchAIConfig,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  const [provider, setProvider] = useState('heuristic')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({})
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    if (data) {
      setProvider(data.provider || 'heuristic')
      setApiKey(data.api_key || '')
      setModel(data.model || '')
      setBaseUrl(data.base_url || '')
      setEmbedModel(data.embedding_model || 'text-embedding-3-small')
      setEnabled(data.enabled === true || data.enabled === 'true')
    }
  }, [data])

  useEffect(() => {
    fetchAIModels().then(setAIModels).catch(() => {})
  }, [])

  const saveMutation = useMutation({
    mutationFn: updateAIConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config'] })
    },
  })

  const modelOptions = aiModels[provider] ?? []

  async function handleSave() {
    setTestStatus('idle')
    setTestMsg('')
    saveMutation.mutate({
      ai_provider: provider,
      ai_provider_api_key: apiKey,
      ai_provider_model: model,
      ai_provider_base_url: baseUrl,
      ai_embedding_model: embedModel,
      ai_pilot_enabled: enabled ? 'true' : 'false',
    })
  }

  async function handleTest() {
    setTestStatus('testing')
    setTestMsg('')
    try {
      const result = await testAIConfig({ provider, api_key: apiKey, model, base_url: baseUrl })
      if (result.status === 'ok') {
        setTestStatus('ok')
        setTestMsg(result.reply || 'Connected')
      } else {
        setTestStatus('error')
        setTestMsg(result.error || 'Test failed')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestMsg(err?.message || 'Connection failed')
    }
  }

  async function handleSyncModels() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await syncAIModels()
      setAIModels(result.models)
      setSyncMsg('Models synced from providers.')
    } catch {
      setSyncMsg('Failed to sync models.')
    } finally {
      setSyncing(false)
    }
  }

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell title="AI Settings" description="Admin access required.">
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ui-text-muted)' }}>Access denied.</div>
      </PageShell>
    )
  }

  if (isLoading) {
    return (
      <PageShell title="AI Settings" description="Loading...">
        <div style={{ padding: 24, textAlign: 'center' }}>{t('loading')}</div>
      </PageShell>
    )
  }

  const providers = [
    { value: 'heuristic', label: 'Heuristic (rule-based)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'openrouter', label: 'OpenRouter' },
  ]

  return (
    <PageShell
      title="AI Settings"
      description="Configure the AI provider for RAG, knowledge extraction, and AI pilot replies."
    >
      <Card style={{ maxWidth: 600 }}>
        <FieldRow>
          <Field label="Provider" hint="Select the AI provider to use">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model" hint="">
            {modelOptions.length > 0 ? (
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            ) : (
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4.1-mini"
              />
            )}
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="API Key" hint="Provider API key">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'gemini' ? 'AIza...' : provider === 'openrouter' ? 'sk-or-...' : 'sk-...'}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Base URL" hint="Custom API endpoint (optional)">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Embedding Model" hint="e.g. text-embedding-3-small">
            <Input
              value={embedModel}
              onChange={(e) => setEmbedModel(e.target.value)}
              placeholder="text-embedding-3-small"
            />
          </Field>
          <Field label="Enable AI Replies" hint="Allow AI to auto-reply when @mentioned in groups">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--ui-primary)' }}
              />
              <span>{enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
        </FieldRow>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Config'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Testing...</>
            ) : 'Test Connection'}
          </Button>
          <Button variant="outline" onClick={handleSyncModels} disabled={syncing}>
            {syncing ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Syncing...</> : <><RefreshCw size={14} /> Sync models</>}
          </Button>
        </div>

        {syncMsg ? (
          <div style={{ marginTop: 12 }}>
            <InlineMessage tone={syncMsg.includes('Failed') ? 'destructive' : 'success'}>{syncMsg}</InlineMessage>
          </div>
        ) : null}

        {saveMutation.isSuccess && (
          <div style={{ marginTop: 12 }}>
            <InlineMessage tone="success">Saved successfully.</InlineMessage>
          </div>
        )}
        {saveMutation.isError && (
          <div style={{ marginTop: 12 }}>
            <InlineMessage tone="destructive">Save failed.</InlineMessage>
          </div>
        )}

        {testStatus === 'ok' && (
          <div style={{ marginTop: 12 }}>
            <InlineMessage tone="success">{testMsg}</InlineMessage>
          </div>
        )}
        {testStatus === 'error' && (
          <div style={{ marginTop: 12 }}>
            <InlineMessage tone="destructive">{testMsg}</InlineMessage>
          </div>
        )}
      </Card>
    </PageShell>
  )
}
