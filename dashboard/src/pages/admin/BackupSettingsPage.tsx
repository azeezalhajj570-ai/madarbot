import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudOff, Database, ExternalLink, HardDrive, Loader2, Settings2 } from 'lucide-react'

import {
  fetchBackupConfig, fetchBackupHistory, getBackupDriveAuthUrl, runBackupNow, updateBackupConfig,
} from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { PageShell } from '../../lib/page-shell'
import { DataTable } from '../../components/ui/data-table'
import {
  Badge, Button, Dialog, Field, FieldRow, InlineMessage, Input, Select, ToggleRow,
} from '../../components/ui/primitives'
import { useToast } from '../../components/ui/toast'
import { spacing } from '../../../../shared/ui-system/tokens'

function formatBytes(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function AdminBackupSettingsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { toast } = useToast()

  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data: config } = useQuery({
    queryKey: ['backup-config'],
    queryFn: fetchBackupConfig,
  })

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['backup-history'],
    queryFn: fetchBackupHistory,
    refetchInterval: 8000,
  })

  const [enabled, setEnabled] = useState(false)
  const [storageType, setStorageType] = useState('local')
  const [intervalHours, setIntervalHours] = useState('24')
  const [keepDays, setKeepDays] = useState('7')
  const [dir, setDir] = useState('backups')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [folderId, setFolderId] = useState('')

  useEffect(() => {
    if (!config) return
    setEnabled(config.db_backup_enabled === 'true' || config.db_backup_enabled === true)
    setStorageType(config.db_backup_storage_type || 'local')
    setIntervalHours(String(config.db_backup_interval_hours ?? 24))
    setKeepDays(String(config.db_backup_keep_days ?? 7))
    setDir(config.db_backup_dir || 'backups')
    setClientId(config.db_backup_gdrive_client_id || '')
    setFolderId(config.db_backup_gdrive_folder_id || '')
    setClientSecret('')
    setRefreshToken('')
  }, [config, settingsOpen])

  const saveMutation = useMutation({
    mutationFn: updateBackupConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-config'] })
      setSettingsOpen(false)
      toast.success(t('backup.saved'))
    },
    onError: (err: any) => toast.error(err?.message || t('backup.saveFailed')),
  })

  const runMutation = useMutation({
    mutationFn: runBackupNow,
    onSuccess: () => {
      toast.success(t('backup.started'))
      setTimeout(() => { qc.invalidateQueries({ queryKey: ['backup-history'] }) }, 2000)
    },
    onError: (err: any) => toast.error(err?.message || t('backup.runFailed')),
  })

  const connected = Boolean(config?.config_gdrive_connected)

  function handleSave() {
    const payload: Record<string, string> = {
      db_backup_enabled: enabled ? 'true' : 'false',
      db_backup_storage_type: storageType,
      db_backup_interval_hours: String(Math.max(0.5, parseFloat(intervalHours) || 24)),
      db_backup_keep_days: String(Math.max(0, parseInt(keepDays, 10) || 0)),
      db_backup_dir: dir,
      db_backup_gdrive_client_id: clientId,
      db_backup_gdrive_folder_id: folderId,
    }
    if (clientSecret) payload.db_backup_gdrive_client_secret = clientSecret
    if (refreshToken) payload.db_backup_gdrive_refresh_token = refreshToken
    saveMutation.mutate(payload)
  }

  async function handleConnect() {
    try {
      const { url } = await getBackupDriveAuthUrl()
      window.open(url, '_blank', 'noopener')
    } catch (err: any) {
      toast.error(err?.message || t('backup.connectFailed'))
    }
  }

  return (
    <PageShell title={t('page.admin.backup')} description={t('page.admin.backup.desc')} icon={<Database size={20} />}>
      <DataTable
        data={history || []}
        total={(history || []).length}
        loading={historyLoading}
        title={t('backup.history')}
        subtitle={t('backup.historyDesc')}
        searchPlaceholder={t('backup.searchPlaceholder')}
        actions={
          <>
            <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
              {runMutation.isPending
                ? <><Loader2 size={14} className="spin" /> {t('common.saving')}</>
                : <><HardDrive size={14} /> {t('backup.runNow')}</>}
            </Button>
            <Button onClick={() => setSettingsOpen(true)}>
              <Settings2 size={16} /> {t('backup.settings')}
            </Button>
          </>
        }
        columns={[
          {
            key: 'time',
            label: t('backup.colTime'),
            render: (h: any) => new Date(h.time).toLocaleString(),
          },
          {
            key: 'file',
            label: t('backup.colFile'),
            render: (h: any) => h.filename || '—',
          },
          {
            key: 'size',
            label: t('backup.colSize'),
            hideOnMobile: true,
            render: (h: any) => formatBytes(h.size),
          },
          {
            key: 'status',
            label: t('backup.colStatus'),
            render: (h: any) => (
              h.error ? (
                <span title={String(h.error)} style={{ cursor: 'help' }}>
                  <Badge tone="destructive">{t('backup.statusFailed')}</Badge>
                </span>
              ) : h.uploaded ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone="success">{t('backup.statusUploaded')}</Badge>
                  {h.gdrive_id ? (
                    <a
                      href={`https://drive.google.com/file/d/${h.gdrive_id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t('backup.viewDrive')}
                      style={{ color: 'var(--ui-primary)', display: 'inline-flex' }}
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </span>
              ) : (
                <Badge tone="neutral">{t('backup.statusLocal')}</Badge>
              )
            ),
          },
        ]}
        keyExtractor={(h: any, i: number) => h.time ?? i}
      />

      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('backup.schedule')}
        description={t('backup.scheduleDesc')}
      >
        <ToggleRow
          title={t('backup.enabled')}
          subtitle={t('backup.enabledHint')}
          checked={enabled}
          onCheckedChange={setEnabled}
        />

        <Field label={t('backup.storageType')} hint={t('backup.storageTypeHint')}>
          <Select value={storageType} onChange={(e) => setStorageType(e.target.value)}>
            <option value="local">{t('backup.storageLocal')}</option>
            <option value="gdrive">{t('backup.storageGdrive')}</option>
          </Select>
        </Field>

        <FieldRow>
          <Field label={t('backup.interval')} hint={t('backup.intervalHint')}>
            <Input type="number" min={0.5} step={0.5} value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
          </Field>
          <Field label={t('backup.keepDays')} hint={t('backup.keepDaysHint')}>
            <Input type="number" min={0} value={keepDays} onChange={(e) => setKeepDays(e.target.value)} />
          </Field>
        </FieldRow>

        {storageType === 'local' && (
          <Field label={t('backup.dir')} hint={t('backup.dirHint')}>
            <Input value={dir} onChange={(e) => setDir(e.target.value)} />
          </Field>
        )}

        {storageType === 'gdrive' && (
          <>
            {connected ? (
              <InlineMessage tone="success"><Cloud size={14} /> {t('backup.gdriveConnected')}</InlineMessage>
            ) : (
              <InlineMessage tone="neutral"><CloudOff size={14} /> {t('backup.gdriveNotConnected')}</InlineMessage>
            )}
            <Field label={t('backup.clientId')} hint={t('backup.clientIdHint')}>
              <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </Field>
            <Field label={t('backup.clientSecret')} hint={t('backup.clientSecretHint')}>
              <Input
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={config?.db_backup_gdrive_client_secret ? '••••••••' : ''}
              />
            </Field>
            <Field label={t('backup.refreshToken')} hint={config ? t('backup.refreshTokenKeep') : ''}>
              <Input
                type="password"
                autoComplete="off"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                placeholder={config?.config_gdrive_connected ? '••••••••' : ''}
              />
            </Field>
            <Field label={t('backup.folderId')} hint={t('backup.folderIdHint')}>
              <Input value={folderId} onChange={(e) => setFolderId(e.target.value)} />
            </Field>
            <div>
              <Button variant="outline" onClick={handleConnect}>
                <ExternalLink size={14} /> {t('backup.connectGdrive')}
              </Button>
            </div>
            <InlineMessage tone="neutral">{t('backup.oauthHint')}</InlineMessage>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
          <Button variant="ghost" onClick={() => setSettingsOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending
              ? <><Loader2 size={14} className="spin" /> {t('common.saving')}</>
              : t('backup.saveConfig')}
          </Button>
        </div>
      </Dialog>
    </PageShell>
  )
}
