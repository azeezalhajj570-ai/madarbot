import { useMemo, useState, useCallback, useRef, memo } from 'react'

export interface ColumnDef<T> {
  key: string
  label: string
  render: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
  align?: 'left' | 'right' | 'center'
}

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  keyField: keyof T
  searchable?: boolean
  searchAccessor?: (row: T) => string
  pageSize?: number
  loading?: boolean
  emptyMessage?: string
  defaultSort?: { key: string; direction: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
  renderExpanded?: (row: T) => React.ReactNode
}

function DebouncedInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setLocal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange(v), 250)
  }, [onChange])

  return (
    <input
      type="text"
      value={local}
      onChange={handleChange}
      placeholder={placeholder || 'Search...'}
      style={{
        flex: 1, minWidth: 120, padding: '7px 10px', borderRadius: 8,
        border: '1px solid var(--miniapp-border-soft)',
        background: 'var(--miniapp-surface)',
        color: 'var(--miniapp-text-primary)', fontSize: 12,
        fontFamily: 'var(--miniapp-sans)', outline: 'none',
      }}
    />
  )
}

const TableRow = memo(function TableRow<T>({
  row, columns, keyField, onRowClick, isExpanded, onToggleExpand, renderExpanded,
}: {
  row: T
  columns: ColumnDef<T>[]
  keyField: keyof T
  onRowClick?: (row: T) => void
  isExpanded: boolean
  onToggleExpand: () => void
  renderExpanded?: (row: T) => React.ReactNode
}) {
  return (
    <>
      <div
        onClick={() => { onRowClick?.(row); if (renderExpanded) onToggleExpand() }}
        style={{
          display: 'contents', cursor: onRowClick || renderExpanded ? 'pointer' : undefined,
        }}
      >
        {columns.map((col) => (
          <div key={col.key} style={{
            padding: '8px 10px', fontSize: 12, textAlign: col.align || 'left',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            width: col.width || 'auto', minWidth: 0,
          }}>
            {col.render(row)}
          </div>
        ))}
      </div>
      {isExpanded && renderExpanded ? (
        <div style={{ gridColumn: `1 / span ${columns.length}`, padding: '8px 10px', background: 'var(--miniapp-bg)', borderBottom: '1px solid var(--miniapp-border-soft)', fontSize: 12 }}>
          {renderExpanded(row)}
        </div>
      ) : null}
    </>
  )
})

export function DataTable<T extends Record<string, unknown>>({
  data, columns, keyField,
  searchable, searchAccessor,
  pageSize = 25, loading, emptyMessage = 'No data.',
  defaultSort, onRowClick, renderExpanded,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState(defaultSort?.key || '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSort?.direction || 'asc')
  const [page, setPage] = useState(1)
  const [expandedKey, setExpandedKey] = useState<string | number | null>(null)

  const filtered = useMemo(() => {
    if (!search || !searchAccessor) return data
    const q = search.toLowerCase()
    return data.filter((row) => searchAccessor(row).toLowerCase().includes(q))
  }, [data, search, searchAccessor])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col || !col.sortable) return filtered
    return [...filtered].sort((a, b) => {
      const va = col.render(a)
      const vb = col.render(b)
      const sa = va == null ? '' : String(va)
      const sb = vb == null ? '' : String(vb)
      const cmp = sa.localeCompare(sb, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, safePage, pageSize])

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
        return prev
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v)
    setPage(1)
  }, [])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {searchable ? (
        <DebouncedInput value={search} onChange={handleSearchChange} placeholder="Search..." />
      ) : null}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)', padding: 16, textAlign: 'center' }}>Loading...</div>
      ) : paginated.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)', padding: 16, textAlign: 'center' }}>{emptyMessage}</div>
      ) : (
        <div style={{
          overflowX: 'auto', borderRadius: 8, border: '1px solid var(--miniapp-border-soft)',
        }}>
        <div style={{
          display: 'grid', gridTemplateColumns: columns.map((c) => c.width || '1fr').join(' '),
          minWidth: columns.reduce((s, c) => s + (parseInt(c.width || '100') || 100), 0),
        }}>
          <div style={{
            display: 'contents', fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
            letterSpacing: '0.4px', color: 'var(--miniapp-text-muted)',
            background: 'var(--miniapp-bg-deep)',
          }}>
            {columns.map((col) => (
              <div
                key={col.key}
                onClick={() => col.sortable ? handleSort(col.key) : undefined}
                style={{
                  padding: '8px 10px', textAlign: col.align || 'left',
                  cursor: col.sortable ? 'pointer' : undefined,
                  userSelect: 'none', borderBottom: '1px solid var(--miniapp-border-soft)',
                  position: 'sticky', top: 0, background: 'var(--miniapp-bg-deep)', zIndex: 1,
                }}
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </div>
            ))}
          </div>
          {paginated.map((row) => {
            const key = row[keyField] as string | number
            return (
              <TableRow
                key={key}
                row={row}
                columns={columns}
                keyField={keyField}
                onRowClick={onRowClick}
                isExpanded={expandedKey === key}
                onToggleExpand={() => setExpandedKey(expandedKey === key ? null : key)}
                renderExpanded={renderExpanded}
              />
            )
          })}
        </div>
        </div>
      )}

      {totalPages > 1 ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', fontSize: 12 }}>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)',
              background: safePage <= 1 ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-surface)',
              color: safePage <= 1 ? 'var(--miniapp-text-muted)' : 'var(--miniapp-text-primary)',
              cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: 12, fontFamily: 'var(--miniapp-sans)',
            }}
          >
            ← Prev
          </button>
          <span style={{ color: 'var(--miniapp-text-muted)' }}>
            Page {safePage} of {totalPages} ({sorted.length} total)
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--miniapp-border-soft)',
              background: safePage >= totalPages ? 'var(--miniapp-bg-deep)' : 'var(--miniapp-surface)',
              color: safePage >= totalPages ? 'var(--miniapp-text-muted)' : 'var(--miniapp-text-primary)',
              cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: 12, fontFamily: 'var(--miniapp-sans)',
            }}
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  )
}
