import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, Eye, EyeOff, Loader2, RefreshCw, Zap } from 'lucide-react'

import { fetchAIConfig, fetchAIModels, syncAIModels, updateAIConfig, testAIConfig } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, CardSkeleton, Field, FieldRow, InlineMessage, Input, Select, ToggleRow, EmptyState } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { spacing, radius } from '../../../../shared/ui-system/tokens'

export default function AdminAISettingsPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: fetchAIConfig,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  const [provider, setProvider] = useState('heuristic')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [aiModels, setAIModels] = useState<Record<string, string[]>>({})
  const [syncing, setSyncing] = useState(false)

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
      toast.success('Configuration saved')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Save failed')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => testAIConfig({ provider, api_key: apiKey, model, base_url: baseUrl }),
    onSuccess: (result) => {
      if (result.status === 'ok') {
        toast.success(result.reply || 'Connected')
      } else {
        toast.error(result.error || 'Test failed')
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Connection failed')
    },
  })

  const modelOptions = aiModels[provider] ?? []

  function handleSave() {
    saveMutation.mutate({
      ai_provider: provider,
      ai_provider_api_key: apiKey,
      ai_provider_model: model,
      ai_provider_base_url: baseUrl,
      ai_embedding_model: embedModel,
      ai_pilot_enabled: enabled ? 'true' : 'false',
    })
  }

  async function handleSyncModels() {
    setSyncing(true)
    try {
      const result = await syncAIModels()
      setAIModels(result.models)
      toast.success('Models synced from providers.')
    } catch {
      toast.error('Failed to sync models.')
    } finally {
      setSyncing(false)
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

  const hasApiKey = provider !== 'heuristic'

  return (
    <PageShell
      title="AI Settings"
      description="Configure the AI provider for RAG, knowledge extraction, and AI pilot replies."
      icon={<Brain size={20} />}
    >
      {isLoading ? (
        <CardSkeleton rows={4} />
      ) : (
        <div style={{ display: 'grid', gap: spacing.lg }}>
          <div className="settings-card-grid">
            <Card title="Provider Configuration" subtitle="Choose your AI provider and inference model.">
              <FieldRow>
                <Field label="AI Provider" hint="Which service powers AI features">
                  <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {providers.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Model" hint={provider === 'heuristic' ? 'N/A in heuristic mode' : 'Inference model name'}>
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
                      placeholder={provider === 'heuristic' ? 'N/A' : 'gpt-4.1-mini'}
                      disabled={provider === 'heuristic'}
                    />
                  )}
                </Field>
              </FieldRow>
              {provider === 'heuristic' && (
                <div style={{ marginTop: spacing.md }}>
                  <InlineMessage tone="neutral">
                    <Zap size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Heuristic mode uses rule-based matching. No API key or model required.
                  </InlineMessage>
                </div>
              )}
            </Card>

            <Card title="Authentication" subtitle="API credentials for your chosen provider.">
              <div style={{ display: 'grid', gap: spacing.md }}>
                {hasApiKey && (
                  <Field label="API Key" hint="Your provider API key">
                    <div style={{ position: 'relative' }}>
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={provider === 'gemini' ? 'AIza...' : provider === 'openrouter' ? 'sk-or-...' : 'sk-...'}
                        style={{ paddingRight: 44 }}
                      />
                      <button
                        onClick={() => setShowKey(!showKey)}
                        aria-label={showKey ? 'Hide API key' : 'Show API key'}
                        style={{
                          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', color: 'var(--ui-text-muted)',
                          cursor: 'pointer', padding: 4, display: 'flex',
                        }}
                      >
                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </Field>
                )}
                <FieldRow>
                  <Field label="Base URL" hint="Custom API endpoint (optional)">
                    <Input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                  </Field>
                  <Field label="Embedding Model" hint="Used for vector search">
                    <Input
                      value={embedModel}
                      onChange={(e) => setEmbedModel(e.target.value)}
                      placeholder="text-embedding-3-small"
                    />
                  </Field>
                </FieldRow>
              </div>
            </Card>
          </div>

          <Card title="AI Replies" subtitle="Allow the AI to respond to @mentions in group chats.">
            <ToggleRow
              title="Enable AI Replies"
              subtitle="When enabled, the AI pilot will automatically reply when your bot is @mentioned in managed groups."
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </Card>

          <div style={{
            padding: spacing.lg, borderRadius: radius.lg,
            background: 'var(--ui-surface)', border: '1px solid var(--ui-border)',
          }}>
            <div className="settings-actions">
              <Button variant="outline" onClick={handleSyncModels} disabled={syncing}>
                {syncing ? <><Loader2 size={14} className="spin" /> Syncing...</> : <><RefreshCw size={14} /> Sync models</>}
              </Button>
              <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending || provider === 'heuristic'}>
                {testMutation.isPending ? <><Loader2 size={14} className="spin" /> Testing...</> : 'Test Connection'}
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
