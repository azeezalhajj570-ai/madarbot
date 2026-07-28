import type { ReactNode } from 'react'
import { spacing } from '../../../shared/ui-system/tokens'
import { useI18n } from './i18n'
import { LoadingState, PageFrame, SectionHeader } from '../components/ui/primitives'

export function PageShell({
  titleKey,
  title,
  descriptionKey,
  description,
  actions,
  children,
  loading,
  icon,
}: {
  titleKey?: string
  title?: string
  descriptionKey?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  loading?: boolean
  icon?: ReactNode
}) {
  const { t } = useI18n()
  const resolvedTitle = titleKey ? t(titleKey) : (title || '')
  const resolvedDesc = descriptionKey ? t(descriptionKey) : description

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: spacing.xl }}>
      <PageFrame>
        <SectionHeader title={resolvedTitle} subtitle={resolvedDesc} actions={actions} icon={icon} />
        <div>
          {loading ? (
            <LoadingState />
          ) : (
            children
          )}
        </div>
      </PageFrame>
    </div>
  )
}
