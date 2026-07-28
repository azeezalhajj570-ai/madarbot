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
    fetchAIModels().then(setAIModels).catch(() => {})
  }, [])

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
      toast.success(t('ai.configSaved'))
    },
    onError: (err: any) => {
      toast.error(err?.message || t('ai.saveFailed'))
    },
  })

  const testMutation = useMutation({
    mutationFn: () => testAIConfig({ provider, api_key: apiKey, model: genModel, base_url: baseUrl }),
    onSuccess: (result) => {
      if (result.status === 'ok') {
        toast.success(result.reply || t('common.connected'))
      } else {
        toast.error(result.error || t('ai.testFailed'))
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || t('ai.connectionFailed'))
    },
  })

  async function handleSyncModels() {
    setSyncing(true)
    try {
      const result = await syncAIModels()
      setAIModels(result.models)
      toast.success(t('ai.modelsSynced'))
    } catch {
      toast.error(t('ai.syncFailed'))
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
      <PageShell title={t('ai.settings')} description={t('common.accessDenied.desc')} loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
      </PageShell>
    )
  }

  return (
    <PageShell
      title={t('ai.settings')}
      description={t('ai.settings.desc')}
      icon={<Brain size={20} />}
    >
      {configLoading ? (
        <CardSkeleton rows={5} />
      ) : (
        <div style={{ display: 'grid', gap: spacing.lg, maxWidth: 720 }}>
          {/* ── 1. AI Provider ── */}
          <Card title={t('ai.provider')} subtitle={t('ai.providerDesc')}>
            <Select value={provider} onChange={(e) => handleProviderChange(e.target.value)}>
              <option value="openrouter">{t('ai.provider.openrouter')}</option>
              <option value="gemini">{t('ai.provider.gemini')}</option>
            </Select>
          </Card>

          {/* ── 2. Authentication ── */}
          <Card title={t('ai.auth')} subtitle={t('ai.authDesc')}>
            <div style={{ display: 'grid', gap: spacing.md }}>
              <Field label={t('ai.apiKey')} hint={t('ai.apiKeyHint')}>
                <div style={{ position: 'relative' }}>
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('ai.selectModel')}
                    style={{ paddingInlineEnd: 44 }}
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    aria-label={showKey ? t('ai.hideKey') : t('ai.showKey')}
                    style={{
                      position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--ui-text-muted)',
                      cursor: 'pointer', padding: 4, display: 'flex',
                    }}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <Field label={t('ai.apiUrl')} hint={t('ai.apiUrlHint')}>
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
                  {testMutation.isPending ? <><Loader2 size={14} className="spin" /> {t('ai.testing')}</> : t('ai.testConnection')}
                </Button>
              </div>
            </div>
          </Card>

          {/* ── 3. Models ── */}
          <Card title={t('ai.models')} subtitle={t('ai.modelsDesc')}>
            <div style={{ display: 'grid', gap: spacing.md }}>
              {needsSync && (
                <InlineMessage tone="neutral">
                  {t('ai.noModels')} <strong>{t('ai.syncModels')}</strong>
                </InlineMessage>
              )}

              <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240, flex: 1 }}>
                  <Field label={t('ai.generationModel')} hint={t('ai.generationModelHint')}>
                    {chatModels.length > 0 ? (
                      <Select value={genModel} onChange={(e) => setGenModel(e.target.value)}>
                        <option value="">{t('ai.selectModel')}</option>
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
                  {syncing ? <><Loader2 size={14} className="spin" /> {t('ai.syncing')}</> : <><RefreshCw size={14} /> {t('ai.syncModels')}</>}
                </Button>
              </div>

              <Field label={t('ai.embeddingModel')} hint={t('ai.embeddingModelHint')}>
                {embeddingModels.length > 0 ? (
                  <Select value={embedModel} onChange={(e) => setEmbedModel(e.target.value)}>
                    <option value="">{t('ai.selectModel')}</option>
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
          <Card title={t('ai.aiReplies')} subtitle={t('ai.aiRepliesDesc')}>
            <ToggleRow
              title={t('ai.enableAiReplies')}
              subtitle={t('ai.enableAiRepliesHint')}
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
                {saveMutation.isPending ? t('common.saving') : t('ai.saveConfig')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
