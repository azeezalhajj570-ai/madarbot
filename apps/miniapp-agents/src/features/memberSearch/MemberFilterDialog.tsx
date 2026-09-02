import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, SelectField } from '@miniapp/shared'
import type { GroupChip, MemberSearchNode, MemberSearchSort } from '@miniapp/shared'
import { FilterBuilder } from './FilterBuilder'
import { SORT_OPTIONS, emptyGroup, isFilterUsable } from './types'

export interface MemberFilterValue {
  /** Filter AST (AND/OR tree of conditions). */
  filter: MemberSearchNode | null
  /** Group scope — empty = all groups. */
  groupIds: number[]
  /** Date range (ISO). */
  dateFrom?: string | null
  dateTo?: string | null
  sort: MemberSearchSort
  /** Resolved matching member ids (populated on Apply). */
  memberIds?: number[]
}

export interface MemberFilterDialogProps {
  open: boolean
  onClose: () => void
  /** Initial/current filter value (kept in sync with the parent). */
  value: MemberFilterValue
  /** Fired when Apply (or Clear) is pressed with the new filter + scope. */
  onApply: (value: MemberFilterValue) => void
  /** Groups available for the scope selector. */
  groups: GroupChip[]
  /**
   * When set, the group scope is locked to this single group (the one already
   * selected in the form) — the group selector is hidden and the applied
   * filter always scopes to this group.
   */
  scopeGroup?: GroupChip | null
  /**
   * Called to count matching members for the current draft (debounced by the
   * dialog). The parent owns the actual search (it knows the agent id).
   * Return null when a count isn't available (e.g. count > 10k).
   */
  countMatches: (value: MemberFilterValue) => Promise<number | null>
  /**
   * Called when Apply is pressed to resolve the full set of matching member
   * ids BEFORE the dialog closes, so the parent can narrow immediately.
   * Returns the ids (may be empty for an empty filter).
   */
  resolveIds: (value: MemberFilterValue) => Promise<number[]>
}

const DATE_PRESETS = ['any', 'today', '7d', '30d', 'custom'] as const
type DatePreset = (typeof DATE_PRESETS)[number]

function presetRange(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString()
  switch (preset) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return { from: iso(start), to: iso(now) }
    }
    case '7d': {
      const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
      return { from: iso(from), to: iso(now) }
    }
    case '30d': {
      const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
      return { from: iso(from), to: iso(now) }
    }
    default:
      return {}
  }
}

/**
 * Modal editor for the dynamic member filter — used as the "Advanced filter"
 * in the Bulk Add and Send Messages forms. Owns a local draft of the filter +
 * scope so Apply commits it to the parent; shows a debounced live match count
 * so the user knows how many members the filter selects before committing.
 */
export function MemberFilterDialog({
  open,
  onClose,
  value,
  onApply,
  groups,
  scopeGroup,
  countMatches,
  resolveIds,
}: MemberFilterDialogProps) {
  const { t } = useTranslation()

  // Draft state — initialised from `value` every time the dialog opens so the
  // parent's committed filter is what the user sees on reopen.
  const [draftFilter, setDraftFilter] = useState<MemberSearchNode | null>(value.filter)
  const [draftGroupIds, setDraftGroupIds] = useState<number[]>(value.groupIds)
  const [draftSort, setDraftSort] = useState<MemberSearchSort>(value.sort)
  const [datePreset, setDatePreset] = useState<DatePreset>(() =>
    value.dateFrom || value.dateTo ? 'custom' : 'any',
  )
  const [customRange, setCustomRange] = useState<{ from?: string; to?: string }>({
    from: value.dateFrom || undefined,
    to: value.dateTo || undefined,
  })
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [applying, setApplying] = useState(false)
  const countKeyRef = useRef(0)
  // Snapshot the committed filter only when the dialog transitions to open.
  // Re-initialising on every `value` change would wipe in-progress edits the
  // moment the parent re-renders (e.g. while adding a condition).
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setDraftFilter(value.filter)
      setDraftGroupIds(value.groupIds)
      setDraftSort(value.sort)
      setDatePreset(value.dateFrom || value.dateTo ? 'custom' : 'any')
      setCustomRange({ from: value.dateFrom || undefined, to: value.dateTo || undefined })
      setCount(null)
    }
    wasOpenRef.current = open
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const range = datePreset === 'custom' ? customRange : presetRange(datePreset)
  const usable = draftFilter !== null && isFilterUsable(draftFilter)

  // Group scope — when scopeGroup is provided the filter is locked to that
  // single group (the one already selected in the form) and the selector is
  // hidden; otherwise the dialog's own group selector applies.
  const effectiveGroupIds = scopeGroup ? [scopeGroup.tg_group_id] : draftGroupIds
  const scopeLabel = scopeGroup
    ? (scopeGroup.title || `Group ${scopeGroup.tg_group_id}`)
    : effectiveGroupIds.length === 0
      ? t('memberSearch.allGroups')
      : t('memberSearch.nGroups', { count: effectiveGroupIds.length })

  const draftValue = useMemo<MemberFilterValue>(
    () => ({
      filter: draftFilter,
      groupIds: effectiveGroupIds,
      dateFrom: range.from,
      dateTo: range.to,
      sort: draftSort,
    }),
    [draftFilter, effectiveGroupIds, range.from, range.to, draftSort],
  )
  const draftKey = useMemo(() => JSON.stringify(draftValue), [draftValue])

  // Debounced live count whenever the draft changes.
  useEffect(() => {
    if (!open || !usable) {
      setCount(null)
      return
    }
    setCounting(true)
    const key = ++countKeyRef.current
    const timer = window.setTimeout(() => {
      void countMatches(draftValue)
        .then((n) => {
          if (key === countKeyRef.current) setCount(n)
        })
        .catch(() => {
          if (key === countKeyRef.current) setCount(null)
        })
        .finally(() => {
          if (key === countKeyRef.current) setCounting(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draftKey, open, usable]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = async () => {
    if (!usable || applying) return
    setApplying(true)
    try {
      let memberIds: number[] | undefined
      try {
        memberIds = await resolveIds(draftValue)
      } catch {
        memberIds = undefined
      }
      onApply({ ...draftValue, memberIds })
      onClose()
    } finally {
      setApplying(false)
    }
  }

  const handleClear = () => {
    const cleared: MemberFilterValue = {
      filter: null,
      groupIds: [],
      dateFrom: null,
      dateTo: null,
      sort: 'newest_matching_activity',
    }
    setDraftFilter(null)
    setDraftGroupIds([])
    setDraftSort('newest_matching_activity')
    setDatePreset('any')
    setCustomRange({})
    setCount(null)
    onApply(cleared)
    onClose()
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(32,25,16,0.55)',
        display: 'grid', placeItems: 'center', padding: 16, zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          maxWidth: '100%',
          maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          minWidth: 0,
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20, boxShadow: '0 22px 60px rgba(32,25,16,0.22)',
        }}
      >
        <div style={{
          padding: '20px 20px 12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          borderBottom: '1px solid var(--miniapp-border-soft)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 18 }}>{t('memberSearch.dialogTitle')}</h3>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 2 }}>{t('memberSearch.dialogSubtitle')}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--miniapp-clay)', fontSize: 22, lineHeight: 1,
              padding: 0, flexShrink: 0, marginLeft: 16,
            }}
          >
            ×
          </button>
        </div>

        <div style={{
          overflowX: 'hidden', overflowY: 'auto',
          padding: '12px 20px 20px', display: 'grid', gap: 14,
          minWidth: 0,
        }}>
          {/* Filter builder */}
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>
              {t('memberSearch.conditions')}
            </span>
            <FilterBuilder
              node={draftFilter ?? emptyGroup('AND')}
              groups={groups}
              onChange={(next) => setDraftFilter(next)}
            />
          </div>

          {/* Scope: groups + date + sort */}
          <div style={{ display: 'grid', gap: 10, paddingTop: 4 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {scopeGroup ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>
                    {t('memberSearch.group')}
                  </span>
                  <div style={{
                    background: 'var(--miniapp-bg)',
                    border: '1px solid var(--miniapp-border-soft)',
                    borderRadius: 'var(--miniapp-radius-sm)',
                    padding: '8px 10px',
                    fontFamily: 'var(--miniapp-sans)',
                    fontSize: 13,
                    color: 'var(--miniapp-text-primary)',
                    boxSizing: 'border-box',
                  }}>
                    {scopeLabel}
                  </div>
                </div>
              ) : (
                <SelectField label={t('memberSearch.group')} value={draftGroupIds.length === 1 ? String(draftGroupIds[0]) : ''} onChange={(v) => setDraftGroupIds(v ? [Number(v)] : [])}>
                  <option value="">{t('memberSearch.allGroups')}</option>
                  {groups.map((g) => (
                    <option key={g.tg_group_id} value={g.tg_group_id}>
                      {g.title || `Group ${g.tg_group_id}`}
                    </option>
                  ))}
                </SelectField>
              )}

              <SelectField label={t('memberSearch.date')} value={datePreset} onChange={(v) => setDatePreset(v as DatePreset)}>
                <option value="any">{t('memberSearch.dateAny')}</option>
                <option value="today">{t('memberSearch.dateToday')}</option>
                <option value="7d">{t('memberSearch.date7d')}</option>
                <option value="30d">{t('memberSearch.date30d')}</option>
                <option value="custom">{t('memberSearch.dateCustom')}</option>
              </SelectField>

              <SelectField label={t('memberSearch.sort')} value={draftSort} onChange={(v) => setDraftSort(v as MemberSearchSort)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectField>
            </div>

            {datePreset === 'custom' ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={customRange.from || ''}
                  onChange={(e) => setCustomRange((p) => ({ ...p, from: e.target.value || undefined }))}
                  aria-label={t('memberSearch.from')}
                  style={{
                    background: 'var(--miniapp-bg)',
                    border: '1px solid var(--miniapp-border-soft)',
                    borderRadius: 'var(--miniapp-radius-sm)',
                    padding: '8px 10px',
                    fontFamily: 'var(--miniapp-sans)',
                    fontSize: 13,
                    color: 'var(--miniapp-text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 12 }}>–</span>
                <input
                  type="date"
                  value={customRange.to || ''}
                  onChange={(e) => setCustomRange((p) => ({ ...p, to: e.target.value || undefined }))}
                  aria-label={t('memberSearch.to')}
                  style={{
                    background: 'var(--miniapp-bg)',
                    border: '1px solid var(--miniapp-border-soft)',
                    borderRadius: 'var(--miniapp-radius-sm)',
                    padding: '8px 10px',
                    fontFamily: 'var(--miniapp-sans)',
                    fontSize: 13,
                    color: 'var(--miniapp-text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ) : null}

            <div style={{ fontSize: 12.5, color: 'var(--miniapp-text-muted)' }}>
              {t('memberSearch.scope', { scope: scopeLabel })}
              {usable && count !== null ? (
                <> · {t(count >= 10000 ? 'memberSearch.matchingCountPlus' : 'memberSearch.matchingCount', { count })}</>
              ) : null}
              {counting ? <> · {t('memberSearch.counting')}</> : null}
            </div>
          </div>
        </div>

        <div style={{
          padding: '12px 20px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          borderTop: '1px solid var(--miniapp-border-soft)',
        }}>
          {applying ? (
            <span style={{ fontSize: 12.5, color: 'var(--miniapp-text-muted)' }}>
              {t('memberSearch.applying')}
            </span>
          ) : <span />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="secondary" onClick={handleClear} disabled={applying}>{t('memberSearch.clear')}</Button>
            <Button disabled={!usable || applying} onClick={() => void handleApply()}>
              {applying ? t('memberSearch.applying') : t('memberSearch.apply')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
