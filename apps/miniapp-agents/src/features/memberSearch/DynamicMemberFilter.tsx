import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Note, SelectField } from '@miniapp/shared'
import type { GroupChip, MemberSearchNode, MemberSearchResult, MemberSearchSort } from '@miniapp/shared'
import { FilterBuilder } from './FilterBuilder'
import { MemberResults } from './MemberResults'
import { SORT_OPTIONS, emptyGroup, isFilterUsable } from './types'
import { useMemberSearch } from './useMemberSearch'

export interface DynamicMemberFilterProps {
  agentId: number
  /** Groups available for the "All Groups / Group A / ..." scope selector. */
  groups: GroupChip[]
  /** Live filter AST updates (for external consumers, e.g. saved filters). */
  onChange?: (filter: MemberSearchNode) => void
  /** Fired on every executed search with the params used. */
  onSearch?: (params: { groupIds: number[]; filter: MemberSearchNode | null; sort: MemberSearchSort; dateFrom?: string | null; dateTo?: string | null }) => void
  pageSize?: number
  includeTotal?: boolean
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
 * Reusable dynamic member filter — search scraped group members by attributes
 * and by the content of their scraped messages. The filter is built as a JSON
 * AST and executed entirely server-side; only the requested page of members
 * reaches the browser. Debounced (350ms) with request cancellation.
 */
export default function DynamicMemberFilter({
  agentId,
  groups,
  onChange,
  onSearch,
  pageSize = 50,
  includeTotal = false,
}: DynamicMemberFilterProps) {
  const { t } = useTranslation()
  const { results, searching, error, autoSearch, searchNow, cancel } = useMemberSearch()

  const [filter, setFilter] = useState<MemberSearchNode>(() => emptyGroup('AND'))
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
  const [datePreset, setDatePreset] = useState<DatePreset>('any')
  const [customRange, setCustomRange] = useState<{ from?: string; to?: string }>({})
  const [sort, setSort] = useState<MemberSearchSort>('newest_matching_activity')
  const [page, setPage] = useState(1)
  const [searched, setSearched] = useState(false)
  const [initialSearchDone, setInitialSearchDone] = useState(false)

  // Live AST notifications to the parent (saved filters, analytics, etc.).
  useEffect(() => {
    onChange?.(filter)
  }, [filter, onChange])

  const range = datePreset === 'custom' ? customRange : presetRange(datePreset)
  const usable = isFilterUsable(filter)
  const groupCount = selectedGroupIds.length
  const scopeLabel = groupCount === 0 ? t('memberSearch.allGroups') : t('memberSearch.nGroups', { count: groupCount })

  const summaryKey = useMemo(() => JSON.stringify({ f: filter, g: selectedGroupIds, d: range, s: sort }), [filter, selectedGroupIds, range, sort])

  // Debounced auto-search whenever the filter/scope changes.
  useEffect(() => {
    if (!usable || !initialSearchDone) return
    autoSearch({ agentId, groupIds: selectedGroupIds, filter, dateFrom: range.from, dateTo: range.to, sort, pageSize, includeTotal })
  }, [summaryKey, initialSearchDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial search on first mount.
  useEffect(() => {
    if (!usable || initialSearchDone) return
    setInitialSearchDone(true)
    autoSearch({ agentId, groupIds: selectedGroupIds, filter, dateFrom: range.from, dateTo: range.to, sort, pageSize, includeTotal })
    onSearch?.({ groupIds: selectedGroupIds, filter, sort, dateFrom: range.from, dateTo: range.to })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Explicit search (submit button / page change).
  const runSearch = (nextPage: number) => {
    setPage(nextPage)
    searchNow({ agentId, groupIds: selectedGroupIds, filter, dateFrom: range.from, dateTo: range.to, sort, page: nextPage, pageSize, includeTotal })
    onSearch?.({ groupIds: selectedGroupIds, filter, sort, dateFrom: range.from, dateTo: range.to })
    setSearched(true)
  }

  const handleFilterChange = (next: MemberSearchNode) => {
    setFilter(next)
    setPage(1)
  }

  const handleGroupToggle = (id: number) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
    setPage(1)
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Filter builder */}
      <div style={{ display: 'grid', gap: 12 }}>
        <FilterBuilder node={filter} groups={groups} onChange={handleFilterChange} />
      </div>

      {/* Scope: groups + date + sort */}
      <div style={{ display: 'grid', gap: 10, padding: '12px 0', borderTop: '1px solid var(--miniapp-border-soft)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            {t('memberSearch.group')}
          </span>
          <select
            aria-label={t('memberSearch.group')}
            value={groupCount === 1 ? String(selectedGroupIds[0]) : ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) {
                setSelectedGroupIds([])
              } else {
                setSelectedGroupIds([Number(v)])
              }
              setPage(1)
            }}
            style={{ ...inputStyle, width: 'auto', minWidth: 180 }}
          >
            <option value="">{t('memberSearch.allGroups')}</option>
            {groups.map((g) => (
              <option key={g.tg_group_id} value={g.tg_group_id}>
                {g.title || `Group ${g.tg_group_id}`}
              </option>
            ))}
          </select>

          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            {t('memberSearch.date')}
          </span>
          <select
            aria-label={t('memberSearch.date')}
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            style={{ ...inputStyle, width: 'auto', minWidth: 140 }}
          >
            <option value="any">{t('memberSearch.dateAny')}</option>
            <option value="today">{t('memberSearch.dateToday')}</option>
            <option value="7d">{t('memberSearch.date7d')}</option>
            <option value="30d">{t('memberSearch.date30d')}</option>
            <option value="custom">{t('memberSearch.dateCustom')}</option>
          </select>

          {datePreset === 'custom' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="date"
                value={customRange.from || ''}
                onChange={(e) => setCustomRange((p) => ({ ...p, from: e.target.value || undefined }))}
                style={inputStyle}
              />
              <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 12 }}>–</span>
              <input
                type="date"
                value={customRange.to || ''}
                onChange={(e) => setCustomRange((p) => ({ ...p, to: e.target.value || undefined }))}
                style={inputStyle}
              />
            </div>
          ) : null}

          <SelectField label={t('memberSearch.sort')} value={sort} onChange={(v) => setSort(v as MemberSearchSort)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--miniapp-text-muted)' }}>
            {t('memberSearch.scope', { scope: scopeLabel })}
          </span>
          <Button
            disabled={!usable || searching}
            onClick={() => runSearch(1)}
          >
            {searching ? t('memberSearch.searching') : t('memberSearch.searchMembers')}
          </Button>
        </div>
      </div>

      {/* Results */}
      {searched || searching || results ? (
        <MemberResults
          results={results}
          searching={searching}
          error={error}
          page={page}
          pageSize={pageSize}
          onPageChange={(p) => runSearch(p)}
          onRetry={() => runSearch(page)}
          emptyState={
            <Note>
              <div>{t('memberSearch.noMatches')}</div>
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, display: 'grid', gap: 4, fontSize: 12.5 }}>
                <li>{t('memberSearch.tryRemoveCondition')}</li>
                <li>{t('memberSearch.tryChangeAndOr')}</li>
                <li>{t('memberSearch.tryWidenDate')}</li>
                <li>{t('memberSearch.tryMoreGroups')}</li>
              </ul>
            </Note>
          }
        />
      ) : null}

      {/* Cleanup cancelled searches on unmount. */}
      <UnmountCancel cancel={cancel} />
    </div>
  )
}

function UnmountCancel({ cancel }: { cancel: () => void }) {
  useEffect(() => cancel, [cancel])
  return null
}

const inputStyle: React.CSSProperties = {
  background: 'var(--miniapp-bg)',
  border: '1px solid var(--miniapp-border-soft)',
  borderRadius: 'var(--miniapp-radius-sm)',
  padding: '8px 10px',
  fontFamily: 'var(--miniapp-sans)',
  fontSize: 13,
  color: 'var(--miniapp-text-primary)',
  boxSizing: 'border-box',
}
