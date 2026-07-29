import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Shield, UserCheck, AlertTriangle, Info, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'

import { Badge, Button, Card, EmptyState, LoadingState } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
import { SimplePagination } from '../../components/ui/data-display'
import { PageShell } from '../../lib/page-shell'
import { fetchOwnerAuditLog } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import { spacing } from '../../../../shared/ui-system/tokens'

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ActionIcon({ action }: { action: string }) {
  const iconProps = { size: 14 }
  if (action.includes('approve') || action.includes('added')) return <UserCheck {...iconProps} />
  if (action.includes('delete') || action.includes('ban') || action.includes('remove')) return <XCircle {...iconProps} />
  if (action.includes('warn') || action.includes('mute')) return <AlertTriangle {...iconProps} />
  if (action.includes('login') || action.includes('auth')) return <Shield {...iconProps} />
  return <Info {...iconProps} />
}

function ActionBadge({ action }: { action: string }) {
  const tone = action.includes('delete') || action.includes('ban') || action.includes('remove')
    ? 'destructive'
    : action.includes('approve') || action.includes('added')
    ? 'success'
    : action.includes('warn') || action.includes('mute')
    ? 'warning'
    : 'neutral'
  return <Badge tone={tone}>{action}</Badge>
}

function AuditEntry({ entry, index }: { entry: any; index: number }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const detailText = entry.detail
    ? typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)
    : null
  const isLong = detailText && detailText.length > 120

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 0',
        borderTop: index === 0 ? 'none' : '1px solid var(--ui-border)',
      }}
    >
      {/* Icon */}
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: 'var(--ui-bg-muted)',
        color: 'var(--ui-text-muted)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        marginTop: 2,
      }}>
        <ActionIcon action={entry.action} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
          <ActionBadge action={entry.action} />
          {entry.target_type && (
            <span style={{ fontSize: 13, color: 'var(--ui-text-muted)' }}>
              → {entry.target_type}#{entry.target_id}
            </span>
          )}
        </div>

        {detailText && (
          <div style={{ marginTop: 4 }}>
            <div style={{
              fontSize: 13,
              color: 'var(--ui-text-muted)',
              lineHeight: '18px',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: expanded || !isLong ? undefined : 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}>
              {detailText}
            </div>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ui-primary)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 2,
                }}
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? t('audit.showLess') : t('audit.showMore')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 4,
        fontSize: 12,
        color: 'var(--ui-text-subtle)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        paddingTop: 2,
      }}>
        <Clock size={12} style={{ marginTop: 1 }} />
        {timeAgo(entry.created_at)}
      </div>
    </div>
  )
}

export default function AdminAuditPage() {
  const { t } = useI18n()
  const user = getStoredUser()
  if (user?.role !== 'admin' && user?.role !== 'owner') {
    return (
      <PageShell titleKey="page.admin" descriptionKey="page.admin.desc" loading={false}>
        <EmptyState title={t('common.accessDenied')} subtitle={t('common.accessDenied.desc')} />
      </PageShell>
    )
  }
  const [page, setPage] = useState(0)
  const limit = 50

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: () => fetchOwnerAuditLog(limit, page * limit),
  })

  return (
    <PageShell titleKey="page.admin.audit" descriptionKey="page.admin.audit.desc" loading={false}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <SimplePagination
          page={page + 1}
          hasNext={!!(entries && entries.length >= limit)}
          hasPrev={page > 0}
          onPageChange={(p) => setPage(p - 1)}
        />
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> {t('common.refresh')}
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : entries && entries.length > 0 ? (
          <div>
            {entries.map((entry: any, i: number) => (
              <AuditEntry key={entry.id} entry={entry} index={i} />
            ))}
          </div>
        ) : (
          <EmptyState title={t('audit.noEntries')} subtitle={t('audit.noEntries.desc')} />
        )}
      </Card>
    </PageShell>
  )
}
