import { useMemo, useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Search, X, RefreshCw, CheckSquare, Square } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import { radius, spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'
import { Badge, Button } from './primitives'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ColumnDef<Row = any> {
  key: string
  label: string
  hideOnMobile?: boolean
  render: (row: Row, index: number) => ReactNode
}

export interface DataTableFilter {
  key: string
  label: string
  options: { value: string; label: string }[]
  defaultValue?: string
}

export interface FetchParams {
  page: number
  pageSize: number
  search?: string
  filters?: Record<string, string>
}

export interface FetchResult<T> {
  data: T[]
  total: number
}

export interface DataTableProps<Row = any> {
  columns: ColumnDef<Row>[]
  keyExtractor?: (row: Row, index: number) => string | number
  rowActions?: (row: Row, index: number) => ReactNode

  // Server-side pagination (lazy load) — supply fetchFn
  fetchFn?: (params: FetchParams) => Promise<FetchResult<Row>>
  queryKey?: string[]

  // Client-side pagination — supply data directly
  data?: Row[]
  total?: number

  searchPlaceholder?: string

  filters?: DataTableFilter[]

  actions?: ReactNode

  selectable?: boolean
  selectedIds?: (string | number)[]
  onSelectionChange?: (ids: (string | number)[]) => void

  pageSize?: number
  pageSizeOptions?: number[]
  page?: number
  onPageChange?: (page: number) => void

  title?: string
  subtitle?: string
  style?: CSSProperties

  loading?: boolean
  isFetching?: boolean
  error?: string | null
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DataTable<Row>({
  columns,
  fetchFn,
  queryKey = ['data-table'],
  keyExtractor = (_, i) => i,
  rowActions,

  searchPlaceholder = 'Search...',

  filters,

  actions,

  selectable,
  selectedIds: controlledSelectedIds,
  onSelectionChange,

  pageSize: initialPageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  page: controlledPage,
  onPageChange: controlledPageChange,

  title,
  subtitle,
  style,

  loading: externalLoading,
  isFetching: externalIsFetching,
  error: externalError,
  data: externalData,
  total: externalTotal,
}: DataTableProps<Row>) {
  const isLazy = !!fetchFn

  const [internalPage, setInternalPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    filters?.forEach(f => { initial[f.key] = f.defaultValue ?? '' })
    return initial
  })
  const [internalSelected, setInternalSelected] = useState<(string | number)[]>([])
  const [searchInput, setSearchInput] = useState('')
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>()

  const page = controlledPage ?? internalPage
  const setPage = controlledPageChange ?? setInternalPage
  const selectedIds = controlledSelectedIds ?? internalSelected

  const queryFilters = useMemo(() => {
    const active: Record<string, string> = {}
    for (const [k, v] of Object.entries(filterValues)) {
      if (v) active[k] = v
    }
    return active
  }, [filterValues])

  const queryParams = useMemo<FetchParams>(() => ({
    page,
    pageSize,
    search: search || undefined,
    filters: Object.keys(queryFilters).length > 0 ? queryFilters : undefined,
  }), [page, pageSize, search, queryFilters])

  // Server-side: use react-query
  const queryResult = useQuery({
    queryKey: [...queryKey, queryParams],
    queryFn: () => fetchFn!(queryParams),
    enabled: isLazy,
    placeholderData: (prev) => prev,
  })

  // Client-side: filter + paginate locally
  const localData = useMemo(() => {
    if (isLazy || !externalData) return null
    let filtered = [...externalData]
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(row =>
        columns.some(col => {
          const val = col.render(row, 0)
          return String(val).toLowerCase().includes(q)
        })
      )
    }
    // Apply filters
    for (const [key, val] of Object.entries(queryFilters)) {
      if (val) {
        filtered = filtered.filter((row: any) => String(row[key]).toLowerCase() === val.toLowerCase())
      }
    }
    return filtered
  }, [externalData, search, queryFilters, isLazy, columns])

  // Resolve rows and total
  const rows = isLazy
    ? (queryResult.data?.data ?? [])
    : (localData ?? []).slice((page - 1) * pageSize, page * pageSize)

  const total = isLazy
    ? (queryResult.data?.total ?? 0)
    : (externalTotal ?? localData?.length ?? 0)

  const isLoading = isLazy ? queryResult.isLoading : (!!externalLoading && !externalIsFetching)
  const isFetching = isLazy ? queryResult.isFetching : (!!externalLoading || !!externalIsFetching)
  const showLoadingBar = isFetching && !isLoading && !!rows.length
  const fetchError = isLazy ? queryResult.error : externalError
  const refetch = isLazy ? queryResult.refetch : () => {}

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function handleSearchInput(value: string) {
    setSearchInput(value)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      setSearch(value)
      setPage(1)
    }, 300)
  }

  function handleFilterChange(key: string, value: string) {
    setFilterValues(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function toggleAll() {
    if (!selectable) return
    const allIds = rows.map((row, i) => keyExtractor(row, i))
    const allSelected = allIds.every(id => selectedIds.includes(id))
    const next = allSelected ? selectedIds.filter(id => !allIds.includes(id)) : [...selectedIds, ...allIds.filter(id => !selectedIds.includes(id))]
    if (onSelectionChange) onSelectionChange(next)
    else setInternalSelected(next)
  }

  function toggleOne(id: string | number) {
    if (!selectable) return
    const next = selectedIds.includes(id) ? selectedIds.filter(i => i !== id) : [...selectedIds, id]
    if (onSelectionChange) onSelectionChange(next)
    else setInternalSelected(next)
  }

  const visibleColumns = useMemo(() => columns.filter(c => !c.hideOnMobile), [columns])

  return (
    <section style={{ ...style }}>
      {/* Title */}
      {(title || subtitle) && (
        <div style={{ marginBottom: spacing.md }}>
          {title && <div style={{ fontSize: typeScale.title, fontWeight: 700, lineHeight: '24px', color: uiVars.text }}>{title}</div>}
          {subtitle && <div style={{ fontSize: typeScale.body, color: uiVars.textMuted, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: spacing.sm,
        flexWrap: 'wrap',
        marginBottom: spacing.md,
      }}>
        {/* Search */}
        {searchPlaceholder ? (
          <div style={{ position: 'relative', minWidth: 200, flex: '1 1 200px' }}>
            <Search size={14} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: uiVars.textMuted, pointerEvents: 'none',
            }} />
            <input
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              style={{
                width: '100%', minHeight: 38, borderRadius: radius.md,
                border: `1px solid ${uiVars.borderStrong}`, padding: '0 30px 0 32px',
                background: uiVars.surfaceStrong, color: uiVars.text,
                fontSize: typeScale.body, outline: 'none',
              }}
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: uiVars.textMuted, cursor: 'pointer', padding: 4 }}>
                <X size={14} />
              </button>
            )}
          </div>
        ) : null}

        {/* Filters */}
        {filters?.map(filter => (
          <div key={filter.key} style={{ minWidth: 140 }}>
            <select
              value={filterValues[filter.key] ?? ''}
              onChange={e => handleFilterChange(filter.key, e.target.value)}
              aria-label={filter.label}
              style={{
                width: '100%', minHeight: 38, borderRadius: radius.md,
                border: `1px solid ${uiVars.border}`, padding: '0 10px',
                fontSize: typeScale.body, background: uiVars.surfaceStrong, color: uiVars.text,
              }}
            >
              {filter.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Actions */}
        {actions}

        {/* Refresh */}
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
          <RefreshCw size={14} className={isFetching ? 'spin' : ''} />
        </Button>
      </div>

      {/* Mobile view */}
      <div className="table-mobile-view" style={{ display: 'none', gap: spacing.sm }}>
        {isLoading ? (
          <div style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.textMuted }}>Loading...</div>
        ) : fetchError ? (
          <div style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.danger }}>
            Failed to load data
            <Button variant="ghost" size="sm" onClick={() => refetch()} style={{ display: 'block', margin: '8px auto 0' }}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.textMuted }}>No data found.</div>
        ) : (
          rows.map((row, i) => (
            <div key={keyExtractor(row, i)} style={{
              background: uiVars.surface, border: `1px solid ${uiVars.border}`,
              borderRadius: radius.lg, padding: spacing.md, display: 'grid', gap: spacing.sm,
            }}>
              {visibleColumns.map(col => (
                <div key={col.key} style={{ display: 'grid', gap: 1 }}>
                  <div style={{ fontSize: typeScale.micro, fontWeight: 700, color: uiVars.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {col.label}
                  </div>
                  <div style={{ fontSize: typeScale.body }}>{col.render(row, i)}</div>
                </div>
              ))}
              {rowActions && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.xs, paddingTop: spacing.xs, borderTop: `1px solid ${uiVars.border}` }}>
                  {rowActions(row, i)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="table-desktop-view" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 40, padding: '0 4px 10px 0' }}>
                  <button onClick={toggleAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: uiVars.textMuted, padding: 0 }}>
                    {rows.length > 0 && rows.every((row, i) => selectedIds.includes(keyExtractor(row, i)))
                      ? <CheckSquare size={16} />
                      : <Square size={16} />
                    }
                  </button>
                </th>
              )}
              {columns.map(col => (
                <th key={col.key} style={{
                  textAlign: 'left', fontSize: typeScale.caption, color: uiVars.textMuted,
                  padding: '0 8px 10px 0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {col.label}
                </th>
              ))}
              {rowActions && (
                <th style={{
                  textAlign: 'right', fontSize: typeScale.caption, color: uiVars.textMuted,
                  padding: '0 0 10px 8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.textMuted }}>
                  <div className="pulse" style={{ width: 28, height: 28, borderRadius: 14, background: uiVars.primarySoft, margin: '0 auto 8px' }} />
                  Loading...
                </td>
              </tr>
            ) : fetchError ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} style={{ padding: spacing.xxxl, textAlign: 'center' }}>
                  <div style={{ color: uiVars.danger, fontSize: typeScale.body, marginBottom: 8 }}>Failed to load data</div>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.textMuted }}>
                  No data found.
                </td>
              </tr>
            ) : (
              <>
                {showLoadingBar && (
                  <tr>
                    <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} style={{ padding: 0 }}>
                      <div style={{ height: 2, background: uiVars.border, overflow: 'hidden' }}>
                        <div className="loading-bar-fill" style={{ width: '30%', height: '100%', background: uiVars.primary, borderRadius: 2 }} />
                      </div>
                    </td>
                  </tr>
                )}
                {rows.map((row, i) => (
                  <tr key={keyExtractor(row, i)}>
                    {selectable && (
                      <td style={{ padding: '12px 4px 12px 0', borderTop: `1px solid ${uiVars.border}` }}>
                        <button onClick={() => toggleOne(keyExtractor(row, i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: selectedIds.includes(keyExtractor(row, i)) ? uiVars.primary : uiVars.textMuted, padding: 0 }}>
                          {selectedIds.includes(keyExtractor(row, i)) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                    )}
                    {columns.map(col => (
                      <td key={col.key} style={{
                        padding: '12px 8px 12px 0', borderTop: `1px solid ${uiVars.border}`,
                        fontSize: typeScale.body, lineHeight: '20px', verticalAlign: 'top',
                      }}>
                        {col.render(row, i)}
                      </td>
                    ))}
                    {rowActions && (
                      <td style={{
                        padding: '12px 0 12px 8px', borderTop: `1px solid ${uiVars.border}`,
                        textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap',
                      }}>
                        {rowActions(row, i)}
                      </td>
                    )}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <div style={{ fontSize: typeScale.body, color: uiVars.textMuted }}>
            {total === 0 ? '0 results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
          </div>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            aria-label="Page size"
            style={{
              minHeight: 32, borderRadius: radius.md, border: `1px solid ${uiVars.border}`,
              padding: '0 6px', fontSize: 13, background: uiVars.surfaceStrong, color: uiVars.text,
            }}
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>{opt} / page</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronDown size={14} style={{ transform: 'rotate(90deg)' }} />
          </Button>
          <div style={{ minWidth: 56, textAlign: 'center', fontSize: typeScale.body, color: uiVars.text, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {page} / {totalPages}
          </div>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} />
          </Button>
        </div>
      </div>
    </section>
  )
}
