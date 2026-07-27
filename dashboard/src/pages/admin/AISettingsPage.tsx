import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, CheckCircle, XCircle, Loader2 } from 'lucide-react'

import { fetchAIConfig, updateAIConfig, testAIConfig } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Field, FieldRow, Input, Select, ToggleRow } from '../../components/ui/primitives'

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

  const saveMutation = useMutation({
    mutationFn: updateAIConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config'] })
    },
  })

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

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell title="AI Settings" description="Admin access required.">
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Access denied.</div>
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
    { value: 'heuristic', label: 'Heuristic (fallback)' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'openrouter', label: 'OpenRouter' },
  ]

  return (
    <PageShell
      title="AI Settings"
      description="Configure the AI provider for RAG, knowledge extraction, and AI pilot replies."
      icon={<Brain size={20} />}
    >
      <Card style={{ maxWidth: 600 }}>
        <FieldRow>
          <Field label="Provider" hint="openai, gemini, or openrouter">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model" hint="Leave empty for default">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4.1-mini"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="API Key" hint="Provider API key" grow>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
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
        </FieldRow>

        <FieldRow>
          <ToggleRow
            label="Enable AI Replies"
            hint="Allow AI to auto-reply when @mentioned in groups"
            checked={enabled}
            onChange={setEnabled}
          />
        </FieldRow>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Config'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Testing...</>
            ) : 'Test Connection'}
          </Button>
        </div>

        {saveMutation.isSuccess && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}>
            <CheckCircle size={16} /> Saved successfully.
          </div>
        )}
        {saveMutation.isError && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}>
            <XCircle size={16} /> Save failed.
          </div>
        )}

        {testStatus === 'ok' && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}>
            <CheckCircle size={16} /> {testMsg}
          </div>
        )}
        {testStatus === 'error' && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}>
            <XCircle size={16} /> {testMsg}
          </div>
        )}
      </Card>
    </PageShell>
  )
}
