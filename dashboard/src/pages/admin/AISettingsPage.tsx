import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Brain, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'

import { fetchAIConfig, fetchAIModels, syncAIModels, updateAIConfig, testAIConfig } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { getStoredUser } from '../../lib/auth'
import { PageShell } from '../../lib/page-shell'
import { Button, Card, CardSkeleton, Field, InlineMessage, Input, Select, ToggleRow, EmptyState } from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { spacing, radius } from '../../../../shared/ui-system/tokens'
import type { AIModel } from '../../lib/types'

const PROVIDERS = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'gemini', label: 'Google Gemini' },
] as const

export default function AdminAISettingsPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: fetchAIConfig,
    enabled: user?.role === 'admin' || user?.role === 'owner',
  })

  const [provider, setProvider] = useState<string>('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [genModel, setGenModel] = useState('')
  const [embedModel, setEmbedModel] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [aiModels, setAIModels] = useState<AIModel[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (config) {
      setProvider(config.provider || 'openrouter')
      setApiKey(config.api_key || '')
      setGenModel(config.model || '')
      setBaseUrl(config.base_url || (
        config.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
        config.provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models' :
        ''
      ))
      setEmbedModel(config.embedding_model || 'text-embedding-3-small')
      setEnabled(config.enabled === true || config.enabled === 'true')
    }
  }, [config])

  useEffect(() => {
    fetchAIModels().then((models) => {
      setAIModels(models)
      const chat = models.filter(m => m.provider === provider && m.type === 'chat')
      const embed = models.filter(m => m.provider === provider && m.type === 'embedding')
      if (chat.length === 0 && provider !== 'heuristic') {
        syncAIModels().then((r) => setAIModels(r.models)).catch(() => {})
      }
    }).catch(() => {})
  }, [provider])

  const chatModels = useMemo(
    () => aiModels.filter(m => m.provider === provider && m.type === 'chat').sort((a, b) => a.name.localeCompare(b.name)),
    [aiModels, provider]
  )

  const embeddingModels = useMemo(
    () => aiModels.filter(m => m.provider === provider && m.type === 'embedding').sort((a, b) => a.name.localeCompare(b.name)),
    [aiModels, provider]
  )

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
    mutationFn: () => testAIConfig({ provider, api_key: apiKey, model: genModel, base_url: baseUrl }),
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

  function handleSave() {
    saveMutation.mutate({
      ai_provider: provider,
      ai_provider_api_key: apiKey,
      ai_provider_model: genModel,
      ai_provider_base_url: baseUrl,
      ai_embedding_model: embedModel,
      ai_pilot_enabled: enabled ? 'true' : 'false',
    })
  }

  function handleProviderChange(value: string) {
    setProvider(value)
    setGenModel('')
    setEmbedModel('')
    if (value === 'openrouter') {
      setBaseUrl('https://openrouter.ai/api/v1')
    } else if (value === 'gemini') {
      setBaseUrl('https://generativelanguage.googleapis.com/v1beta/models')
    }
  }

  const needsSync = chatModels.length === 0 && provider !== 'heuristic'

  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell title="AI Settings" description="Admin access required." loading={false}>
        <EmptyState title="Access denied" subtitle="This area is available to admin accounts only." />
      </PageShell>
    )
  }

  return (
    <PageShell
      title="AI Settings"
      description="Configure AI provider, models, and reply behavior."
      icon={<Brain size={20} />}
    >
      {configLoading ? (
        <CardSkeleton rows={5} />
      ) : (
        <div style={{ display: 'grid', gap: spacing.lg, maxWidth: 720 }}>
          {/* ── 1. AI Provider ── */}
          <Card title="AI Provider" subtitle="Select the service that powers AI features.">
            <Select value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </Card>

          {/* ── 2. Authentication ── */}
          <Card title="Authentication" subtitle="API credentials for the selected provider.">
            <div style={{ display: 'grid', gap: spacing.md }}>
              <Field label="API Key" hint="Required. Provider API key for authentication.">
                <div style={{ position: 'relative' }}>
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={provider === 'gemini' ? 'AIza...' : 'sk-or-...'}
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

              <Field label="API URL" hint="API endpoint for this provider.">
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models' : 'https://openrouter.ai/api/v1'}
                />
              </Field>

              <div>
                <Button
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending || !apiKey}
                >
                  {testMutation.isPending ? <><Loader2 size={14} className="spin" /> Testing...</> : 'Test Connection'}
                </Button>
              </div>
            </div>
          </Card>

          {/* ── 3. Models ── */}
          <Card title="Models" subtitle="Configure generation and embedding models.">
            <div style={{ display: 'grid', gap: spacing.md }}>
              {needsSync && (
                <InlineMessage tone="neutral">
                  No models loaded. Click <strong>Sync Models</strong> to fetch available models for {PROVIDERS.find(p => p.value === provider)?.label}.
                </InlineMessage>
              )}

              <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240, flex: 1 }}>
                  <Field label="Generation Model" hint="Used for chat and AI replies.">
                    {chatModels.length > 0 ? (
                      <Select value={genModel} onChange={(e) => setGenModel(e.target.value)}>
                        <option value="">Select a model...</option>
                        {chatModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={genModel}
                        onChange={(e) => setGenModel(e.target.value)}
                        placeholder="e.g. gpt-4o"
                      />
                    )}
                  </Field>
                </div>
                <Button variant="outline" onClick={handleSyncModels} disabled={syncing}>
                  {syncing ? <><Loader2 size={14} className="spin" /> Syncing...</> : <><RefreshCw size={14} /> Sync Models</>}
                </Button>
              </div>

              <Field label="Embedding Model" hint="Used for vector search and RAG.">
                {embeddingModels.length > 0 ? (
                  <Select value={embedModel} onChange={(e) => setEmbedModel(e.target.value)}>
                    <option value="">Select a model...</option>
                    {embeddingModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={embedModel}
                    onChange={(e) => setEmbedModel(e.target.value)}
                    placeholder="text-embedding-3-small"
                  />
                )}
              </Field>
            </div>
          </Card>

          {/* ── 4. AI Replies ── */}
          <Card title="AI Replies" subtitle="Allow the AI to respond to @mentions in group chats.">
            <ToggleRow
              title="Enable AI Replies"
              subtitle="When enabled, the AI pilot will automatically reply when your bot is @mentioned in managed groups."
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </Card>

          {/* ── 5. Actions ── */}
          <div style={{
            padding: spacing.lg, borderRadius: radius.lg,
            background: 'var(--ui-surface)', border: '1px solid var(--ui-border)',
          }}>
            <div className="settings-actions" style={{ justifyContent: 'flex-end' }}>
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
