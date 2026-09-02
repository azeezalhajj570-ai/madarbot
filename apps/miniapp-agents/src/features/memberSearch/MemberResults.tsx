import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { MemberSearchResult } from '@miniapp/shared'
import { Note } from '@miniapp/shared'

export interface MemberResultsProps {
  results: MemberSearchResult | null
  searching: boolean
  error: string | null
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onRetry: () => void
  emptyState: ReactNode
}

export function MemberResults({
  results,
  searching,
  error,
  page,
  pageSize,
  onPageChange,
  onRetry,
  emptyState,
}: MemberResultsProps) {
  const { t } = useTranslation()

  if (searching) {
    return <Note>{t('memberSearch.searching')}</Note>
  }

  if (error) {
    return (
      <Note tone="warning">
        <div style={{ display: 'grid', gap: 6 }}>
          <span>{t('memberSearch.searchError', { error })}</span>
          <button
            type="button"
            onClick={onRetry}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: '1px solid var(--miniapp-border)',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12.5,
              color: 'var(--miniapp-coral)',
              cursor: 'pointer',
              fontFamily: 'var(--miniapp-sans)',
              fontWeight: 600,
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      </Note>
    )
  }

  if (!results) return null

  if (results.items.length === 0) {
    return <div>{emptyState}</div>
  }

  const totalLabel =
    typeof results.total === 'number'
      ? t('memberSearch.matchingCount', { count: results.total })
      : t('memberSearch.matchingCountPlus', { count: results.items.length })

  const totalPages = results.total ? Math.max(1, Math.ceil(results.total / pageSize)) : null

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>{totalLabel}</span>
        {results.has_more && typeof results.total !== 'number' ? (
          <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>
            {t('memberSearch.showingFirst', { count: results.items.length })}
          </span>
        ) : null}
      </div>

      <div style={{ border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, overflow: 'hidden' }}>
        {results.items.map((m) => (
          <div
            key={`${m.tg_group_id}-${m.tg_user_id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderBottom: '1px solid var(--miniapp-border-soft)',
              fontSize: 13,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, color: 'var(--miniapp-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.display_name || `User ${m.tg_user_id}`}
              </div>
              {m.username ? (
                <div style={{ fontSize: 11.5, color: 'var(--miniapp-text-muted)' }}>@{m.username}</div>
              ) : null}
            </div>
            {m.role === 'admin' || m.role === 'creator' ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--miniapp-clay)', background: 'var(--miniapp-clay-dim)', borderRadius: 999, padding: '2px 8px' }}>
                {m.role}
              </span>
            ) : null}
            {m.is_bot ? (
              <span style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', background: 'var(--miniapp-bg)', borderRadius: 999, padding: '2px 8px' }}>
                {t('campaigns.bot')}
              </span>
            ) : null}
            <span style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', whiteSpace: 'nowrap' }}>
              {typeof m.message_count === 'number' ? `${m.message_count} msgs` : ''}
            </span>
          </div>
        ))}
      </div>

      {totalPages && totalPages > 1 ? (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 12, alignItems: 'center' }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            style={{ background: 'none', border: 'none', color: page <= 1 ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', cursor: page <= 1 ? 'default' : 'pointer', fontSize: 12 }}
          >
            {t('common.prev')}
          </button>
          <span style={{ color: 'var(--miniapp-text-muted)' }}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={!results.has_more && page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={{ background: 'none', border: 'none', color: !results.has_more && page >= totalPages ? 'var(--miniapp-text-muted)' : 'var(--miniapp-coral)', cursor: !results.has_more && page >= totalPages ? 'default' : 'pointer', fontSize: 12 }}
          >
            {t('common.next')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
