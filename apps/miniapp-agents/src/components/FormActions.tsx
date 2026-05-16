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
    <div style={{ display: 'flex', gap: 8 }}>
      <Button onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
      <Button tone="secondary" onClick={onCancel} disabled={cancelDisabled}>Cancel</Button>
    </div>
  )
}
