import { useTranslation } from 'react-i18next'

import { Button } from '@miniapp/shared'

/**
 * Form action row. The primary action (submit) is placed at the logical "end"
 * of the row, which is the platform convention:
 * - LTR (English): [ Cancel ] [ Save ]
 * - RTL (Arabic):  [ Save ] [ Cancel ]
 * The row itself flips automatically via the flex direction.
 */
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
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <Button tone="secondary" onClick={onCancel} disabled={cancelDisabled}>{t('common.cancel')}</Button>
      <Button onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
    </div>
  )
}
