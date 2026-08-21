import { useTranslation } from 'react-i18next'

import { Button, Note } from '@miniapp/shared'

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  isBusy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  isBusy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(32, 25, 16, 0.55)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 1000 }}>
      <div style={{ width: 'min(420px, 100%)', background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)', borderRadius: 20, padding: 20, display: 'grid', gap: 12, boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)' }}>
        <div style={{ fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>{title}</div>
        <Note>{message}</Note>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button tone="secondary" onClick={onCancel} disabled={isBusy}>{t('common.cancel')}</Button>
          <Button tone="danger" onClick={onConfirm} disabled={isBusy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
