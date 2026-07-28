import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

import { fetchAIConfig, updateAIConfig, testAIConfig } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, Field, FieldRow, InlineMessage, Input, Select, EmptyState } from '../../components/ui/primitives'

const OPENAI_MODELS = [
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
]

const GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
]

const OPENROUTER_MODELS = [
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-flash-001',
  'google/gemini-2.5-pro-001',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-haiku-4',
  'meta-llama/llama-4-maverick',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b',
]

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      color: 'var(--ui-text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      paddingTop: 8,
      borderTop: '1px solid var(--ui-border)',
      marginBottom: 12,
    }}>
      {label}
    </div>
  )
}

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

  const modelOptions = provider === 'openai' ? OPENAI_MODELS
    : provider === 'gemini' ? GEMINI_MODELS
    : provider === 'openrouter' ? OPENROUTER_MODELS
    : []

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
      <PageShell title="AI Settings" description="Admin access required." loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
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
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>{t('loading')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 20 }}>
            {/* Provider */}
            <div>
              <SectionLabel label="Provider" />
              <FieldRow>
                <Field label="Provider" hint="Select the AI provider to use">
                  <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {providers.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Model" hint="Select the model to use">
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
            </div>

            {/* Credentials */}
            <div>
              <SectionLabel label="Credentials" />
              <Field label="API Key" hint="Provider API key">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider === 'gemini' ? 'AIza...' : provider === 'openrouter' ? 'sk-or-...' : 'sk-...'}
                />
              </Field>
            </div>

            {/* Advanced */}
            <div>
              <SectionLabel label="Advanced" />
              <FieldRow>
                <Field label="Base URL" hint="Custom API endpoint (optional)">
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </Field>
                <Field label="Embedding Model" hint="e.g. text-embedding-3-small">
                  <Input
                    value={embedModel}
                    onChange={(e) => setEmbedModel(e.target.value)}
                    placeholder="text-embedding-3-small"
                  />
                </Field>
              </FieldRow>
            </div>

            {/* Auto-reply toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--ui-border)',
                background: 'var(--ui-surface-alt)',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: '20px' }}>Enable AI Replies</div>
                <div style={{ fontSize: 13, color: 'var(--ui-text-muted)', marginTop: 2, lineHeight: '18px' }}>
                  Allow AI to auto-reply when @mentioned in groups
                </div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 26, cursor: 'pointer', flexShrink: 0 }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                />
                <span style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 13,
                  background: enabled ? 'var(--ui-primary)' : 'var(--ui-border-strong)',
                  transition: 'background 0.2s',
                  cursor: 'pointer',
                }}>
                  <span style={{
                    position: 'absolute',
                    top: 3,
                    left: enabled ? 22 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    background: '#fff',
                    transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  }} />
                </span>
              </label>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save Config'}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testStatus === 'testing'}>
                {testStatus === 'testing' ? (
                  <><Loader2 size={14} className="spin" /> Testing...</>
                ) : 'Test Connection'}
              </Button>

              {/* Inline results */}
              {saveMutation.isSuccess && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--ui-success)' }}>
                  <CheckCircle2 size={14} /> Saved
                </span>
              )}
              {saveMutation.isError && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--ui-danger)' }}>
                  <XCircle size={14} /> Save failed
                </span>
              )}
              {testStatus === 'ok' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--ui-success)' }}>
                  <CheckCircle2 size={14} /> {testMsg}
                </span>
              )}
              {testStatus === 'error' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--ui-danger)' }}>
                  <XCircle size={14} /> {testMsg}
                </span>
              )}
            </div>
          </div>
        )}
      </Card>
    </PageShell>
  )
}
