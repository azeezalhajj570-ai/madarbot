import { Button } from '@miniapp/shared'

export function FormActions({
  submitLabel,
  onSubmit,
  onCancel,
  submitDisabled = false,
  cancelDisabled = false,
}: {
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
  submitDisabled?: boolean
  cancelDisabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--miniapp-radius-sm)', border: '1px solid var(--miniapp-border-soft)', overflow: 'hidden' }}>
      <button type="button" onClick={onSubmit} disabled={submitDisabled}
        style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: submitDisabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: submitDisabled ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-coral)', color: submitDisabled ? 'var(--miniapp-text-muted)' : '#fff' }}>
        {submitLabel}
      </button>
      <div style={{ width: 1, background: 'var(--miniapp-border-soft)' }} />
      <button type="button" onClick={onCancel} disabled={cancelDisabled}
        style={{ flex: 1, padding: '11px 12px', border: 'none', cursor: cancelDisabled ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', background: 'var(--miniapp-surface)', color: cancelDisabled ? 'var(--miniapp-text-muted)' : 'var(--miniapp-text-primary)' }}>
        Cancel
      </button>
    </div>
  )
}
