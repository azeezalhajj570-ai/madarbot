import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemberAddProgressResult, SendLogEntry } from '@miniapp/shared'
import { formatDateTime } from '../i18n/format'

interface LogsReportModalProps {
  open: boolean
  onClose: () => void
  title: string
  jobLabel?: string
  jobTypeLabel?: string
  statusLabel?: string
  messagePreview?: string
  summary?: { total: number; sent: number; failed: number; skipped: number }
  progressRows?: MemberAddProgressResult[]
  logs: SendLogEntry[]
  loading?: boolean
  emptyMessage?: string
  memberAdd?: boolean
}

const PAGE_SIZE = 25

const SAGE = 'var(--miniapp-sage)'
const CLAY = 'var(--miniapp-clay)'
const MUTED = 'var(--miniapp-text-muted)'
const SLATE = '#475977'

type LogRow = SendLogEntry & {
  method?: string | null
  agent_name?: string | null
  agent_phone?: string | null
  source_group_title?: string | null
}

function attemptPresentation(
  r: MemberAddProgressResult,
  t: (key: string) => string,
): { label: string; color: string; detail: string } {
  if (r.status === 'success') return { label: t('tasks.added'), color: SAGE, detail: '' }
  if (r.status === 'skipped') {
    return { label: t('tasks.skipped'), color: MUTED, detail: r.reason || '' }
  }
  if (r.status === 'failed' && r.method === 'invite_link') {
    return { label: t('tasks.inviteLinkSent'), color: SLATE, detail: r.error_code || '' }
  }
  if (r.method === 'invite_link_dm_failed') {
    return { label: t('tasks.inviteDmFailed'), color: CLAY, detail: r.error_code || r.reason || '' }
  }
  return { label: t('tasks.failed'), color: CLAY, detail: r.error_code || r.reason || '' }
}

export function LogsReportModal({
  open, onClose, title,
  jobLabel, jobTypeLabel, statusLabel, messagePreview,
  summary, progressRows, logs, loading, emptyMessage, memberAdd,
}: LogsReportModalProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [expandedKey, setExpandedKey] = useState<string | number | null>(null)

  useEffect(() => {
    if (!open) {
      setSearch('')
      setPage(1)
      setExpandedKey(null)
    }
  }, [open])

  // Lock the page behind the modal so scrolling only moves the log list.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    setPage(1)
    setExpandedKey(null)
  }, [search])

  const filtered = useMemo(() => {
    if (!search.trim()) return logs
    const q = search.trim().toLowerCase()
    return logs.filter((log) =>
      `${log.username || ''} ${log.phone_number || ''} ${log.tg_user_id || ''} ${log.tg_group_id || ''} ${log.message_preview || ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [logs, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  if (!open) return null

  const hasSummary = summary && (summary.total > 0 || summary.sent > 0 || summary.failed > 0 || summary.skipped > 0)
  const summaryCells = summary
    ? [
        { label: t('tasks.total'), value: summary.total, color: 'var(--miniapp-text-primary)' },
        { label: t('tasks.sent'), value: summary.sent, color: SAGE },
        { label: t('tasks.failed'), value: summary.failed, color: summary.failed > 0 ? CLAY : MUTED },
        ...(summary.skipped > 0 ? [{ label: t('tasks.skipped'), value: summary.skipped, color: MUTED }] : []),
      ]
    : []

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(32,25,16,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: '16px 16px 0 0',
          boxShadow: '0 -12px 48px rgba(32,25,16,0.28)', overflow: 'hidden',
        }}
      >
        {/* Masthead */}
        <div style={{ padding: '14px 16px 12px', borderBottom: '2px solid var(--miniapp-text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '2.5px',
                textTransform: 'uppercase', color: 'var(--miniapp-clay)',
              }}>
                {t('tasks.reportKicker')}
              </div>
              <h3 style={{
                margin: '4px 0 0', fontFamily: 'var(--miniapp-serif)',
                fontSize: 17, lineHeight: 1.3, overflowWrap: 'anywhere',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {title}
              </h3>
              {(jobLabel || jobTypeLabel || statusLabel) ? (
                <div style={{
                  marginTop: 3, fontSize: 11, color: 'var(--miniapp-text-secondary)',
                  display: 'flex', flexWrap: 'wrap', gap: '2px 8px',
                }}>
                  {[jobLabel, jobTypeLabel, statusLabel].filter(Boolean).map((part, i) => (
                    <span key={i}>{part}</span>
                  ))}
                </div>
              ) : null}
              {(() => {
                const first = logs[0] as LogRow | undefined
                const sourceTitle = (first?.source_group_title || '').trim()
                const destTitle = first?.group_title || ''
                if (!sourceTitle && !destTitle) return null
                return (
                  <div style={{
                    marginTop: 6, fontSize: 10.5,
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                    gap: '2px 6px', color: 'var(--miniapp-text-secondary)',
                  }}>
                    {sourceTitle ? (
                      <span style={{
                        background: 'rgba(71,89,119,0.08)', border: '1px solid rgba(71,89,119,0.18)',
                        borderRadius: 6, padding: '2px 8px', overflowWrap: 'anywhere',
                        maxWidth: '100%',
                      }}>
                        {t('tasks.logSource')}: <b style={{ color: 'var(--miniapp-ink)' }}>{sourceTitle}</b>
                      </span>
                    ) : null}
                    {destTitle ? (
                      memberAdd ? (
                        <span style={{
                          background: 'rgba(74,103,65,0.10)', border: '1px solid rgba(74,103,65,0.22)',
                          borderRadius: 6, padding: '2px 8px', overflowWrap: 'anywhere',
                          maxWidth: '100%',
                        }}>
                          {t('tasks.logDest')}: <b style={{ color: 'var(--miniapp-ink)' }}>{destTitle}</b>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--miniapp-muted)', fontSize: 9.5 }}>→ {t('tasks.perGroupDest')}</span>
                      )
                    ) : null}
                  </div>
                )
              })()}
            </div>
            <button
              type="button"
              aria-label="close"
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
                color: 'var(--miniapp-clay)', fontSize: 22, lineHeight: 1,
                padding: '0 2px', marginInlineStart: 8,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', padding: '14px 16px 20px', display: 'grid', gap: 14 }}>
          {/* Summary band */}
          {hasSummary ? (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))',
              border: '1px solid var(--miniapp-border)',
            }}>
              {summaryCells.map((cell, i) => (
                <div key={cell.label} style={{
                  padding: '9px 12px',
                  borderInlineStart: i % 2 === 1 ? '1px solid var(--miniapp-border-soft)' : 'none',
                  borderTop: i >= 2 ? '1px solid var(--miniapp-border-soft)' : 'none',
                }}>
                  <div style={{
                    fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px',
                    textTransform: 'uppercase', color: MUTED,
                  }}>{cell.label}</div>
                  <div style={{
                    marginTop: 2, fontFamily: 'var(--miniapp-serif)',
                    fontSize: 19, lineHeight: 1.15, color: cell.color,
                  }}>{cell.value}</div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Broadcast message */}
          {messagePreview ? (
            <div style={{
              background: 'var(--miniapp-bg-warm)', border: '1px solid var(--miniapp-border-soft)',
              padding: '10px 12px',
            }}>
              <div style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px',
                textTransform: 'uppercase', color: MUTED,
              }}>{t('tasks.messagePreview')}</div>
              <div style={{
                marginTop: 5, fontFamily: 'var(--miniapp-serif)', fontStyle: 'italic',
                fontSize: 12.5, lineHeight: 1.55, color: 'var(--miniapp-text-secondary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>“{messagePreview}”</div>
            </div>
          ) : null}

          {/* Delivery attempts */}
          {progressRows && progressRows.length > 0 ? (
            <div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                borderBottom: '1px solid var(--miniapp-border)', paddingBottom: 4,
              }}>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px',
                  textTransform: 'uppercase', color: 'var(--miniapp-text-secondary)',
                }}>{t('tasks.attemptsSection')}</span>
                {progressRows.length > 8 ? (
                  <span style={{ fontSize: 10, color: MUTED }}>
                    {t('tasks.attemptsMore', { count: progressRows.length - 8 })}
                  </span>
                ) : null}
              </div>
              {progressRows.slice(0, 8).map((r, idx) => {
                const pres = attemptPresentation(r, t)
                return (
                  <div key={idx} style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'baseline',
                    gap: '2px 8px', padding: '7px 0',
                    borderBottom: '1px solid var(--miniapp-border-soft)', fontSize: 11.5,
                  }}>
                    <span style={{
                      fontFamily: 'var(--miniapp-mono, monospace)', color: MUTED,
                      minWidth: 64, maxWidth: 110, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5,
                    }}>{r.user_id ?? '—'}</span>
                    <span style={{ fontWeight: 700, color: pres.color, whiteSpace: 'nowrap' }}>{pres.label}</span>
                    {pres.detail ? (
                      <span style={{
                        color: MUTED, fontSize: 11, flex: 1, minWidth: 100,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{pres.detail}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* Entries */}
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              borderBottom: '1px solid var(--miniapp-border)', paddingBottom: 4, marginBottom: 8,
            }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '1.6px',
                textTransform: 'uppercase', color: 'var(--miniapp-text-secondary)',
              }}>{t('tasks.reportEntries')}</span>
              <span style={{ fontFamily: 'var(--miniapp-mono, monospace)', fontSize: 10, color: MUTED }}>
                {filtered.length}
              </span>
            </div>

            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: 4,
                padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--miniapp-border-soft)',
                background: 'var(--miniapp-surface)',
                color: 'var(--miniapp-text-primary)', fontSize: 12,
                fontFamily: 'var(--miniapp-sans)', outline: 'none',
              }}
            />

            {loading ? (
              <div style={{ padding: '22px 0', textAlign: 'center', fontSize: 13, color: MUTED }}>
                {t('common.loading')}
              </div>
            ) : paginated.length === 0 ? (
              <div style={{ padding: '22px 0', textAlign: 'center', fontSize: 13, color: MUTED }}>
                {emptyMessage || t('common.noData')}
              </div>
            ) : (
              paginated.map((rawLog) => {
                const log = rawLog as LogRow
                const key = String(log.id)
                const isExpanded = expandedKey === key
                const ok = log.status === 'sent' || log.status === 'success'
                const invite = log.method === 'invite_link' || log.method === 'invite_link_dm_failed'
                let statusText: string = log.status
                let statusColor: string = ok ? SAGE : CLAY
                if (ok && memberAdd) {
                  if (log.method === 'invite_link') {
                    statusText = t('tasks.statusInviteSent')
                    statusColor = SLATE
                  } else {
                    statusText = t('tasks.statusDirectAdd')
                    statusColor = SAGE
                  }
                } else if (ok) {
                  statusText = t('tasks.sent')
                }
                const actorName = log.agent_name || log.agent_phone
                const recipient = log.username
                  ? `@${log.username}`
                  : log.group_title || (log.tg_user_id ? `User ${log.tg_user_id}` : `Group ${log.tg_group_id}`)
                const subParts = [
                  log.tg_user_id || log.tg_group_id,
                  log.phone_number,
                  actorName ? t('tasks.byAgent', { name: actorName }) : '',
                ].filter(Boolean)
                const sub = subParts.join(' · ')
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setExpandedKey(isExpanded ? null : key) }}
                    style={{
                      padding: '9px 0', borderBottom: '1px solid var(--miniapp-border-soft)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                      <span style={{
                        fontWeight: 700, fontSize: 13, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{recipient}</span>
                      <span style={{
                        flexShrink: 0, fontSize: 9.5, fontWeight: 700,
                        letterSpacing: '0.8px', textTransform: 'uppercase',
                        color: statusColor,
                      }}>{statusText}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
                      <span style={{
                        fontFamily: 'var(--miniapp-mono, monospace)', fontSize: 10.5, color: MUTED,
                        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{sub}</span>
                      <span style={{
                        flexShrink: 0, fontFamily: 'var(--miniapp-mono, monospace)',
                        fontSize: 10.5, color: MUTED,
                      }}>{log.sent_at ? formatDateTime(log.sent_at) : '—'}</span>
                    </div>
                    {log.message_preview ? (
                      <div style={{
                        marginTop: 3, fontSize: 11, color: 'var(--miniapp-text-secondary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {log.message_preview.slice(0, 140)}
                      </div>
                    ) : null}
                    {isExpanded && (log.message_full || log.message_preview) ? (
                      <div style={{
                        marginTop: 8, padding: '8px 10px',
                        background: 'var(--miniapp-bg)',
                        borderInlineStart: '2px solid var(--miniapp-border)',
                        fontSize: 11.5, lineHeight: 1.55,
                        color: 'var(--miniapp-text-secondary)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {log.message_full || log.message_preview}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}

            {totalPages > 1 ? (
              <div style={{
                display: 'flex', gap: 8, justifyContent: 'center',
                alignItems: 'center', marginTop: 12, fontSize: 12,
              }}>
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{
                    padding: '5px 12px', borderRadius: 6,
                    border: '1px solid var(--miniapp-border-soft)',
                    background: safePage <= 1 ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-surface)',
                    color: safePage <= 1 ? MUTED : 'var(--miniapp-text-primary)',
                    cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: 12,
                    fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  {t('common.prev')}
                </button>
                <span style={{ color: MUTED }}>
                  {t('common.pagination', { page: safePage, total: totalPages })}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{
                    padding: '5px 12px', borderRadius: 6,
                    border: '1px solid var(--miniapp-border-soft)',
                    background: safePage >= totalPages ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-surface)',
                    color: safePage >= totalPages ? MUTED : 'var(--miniapp-text-primary)',
                    cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: 12,
                    fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  {t('common.next')}
                </button>
              </div>
            ) : !loading && filtered.length > 0 ? (
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <span style={{
                  fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: MUTED,
                }}>— {t('tasks.reportEnd')} —</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
