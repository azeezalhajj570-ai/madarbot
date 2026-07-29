import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useMemo, useRef, useState, useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { radius, spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'
import { Button } from './primitives'

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationProps {
  page: number
  total: number
  limit: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, total, limit, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.sm,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ fontSize: typeScale.body, color: uiVars.textMuted }}>
        {from}–{to} of {total}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>
        <div
          style={{
            minWidth: 60,
            textAlign: 'center',
            fontSize: typeScale.body,
            color: uiVars.text,
            fontWeight: 600,
          }}
        >
          {page} / {totalPages}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}

// ─── Simple Pagination (prev/next without total count) ──────────────────────

export interface SimplePaginationProps {
  page: number
  onPageChange: (page: number) => void
  hasNext: boolean
  hasPrev?: boolean
}

export function SimplePagination({ page, onPageChange, hasNext, hasPrev }: SimplePaginationProps) {
  const prevDisabled = hasPrev !== undefined ? !hasPrev : page <= 1

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
      <Button
        variant="outline"
        size="sm"
        disabled={prevDisabled}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </Button>
      <div
        style={{
          minWidth: 40,
          textAlign: 'center',
          fontSize: typeScale.body,
          color: uiVars.text,
          fontWeight: 600,
        }}
      >
        {page}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}

// ─── Search Input ────────────────────────────────────────────────────────────

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onSearch?: () => void
  placeholder?: string
  style?: CSSProperties
}

export function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = 'Search...',
  style,
}: SearchInputProps) {
  return (
    <div style={{ position: 'relative', minWidth: 200, ...style }}>
      <Search
        size={14}
        style={{
          position: 'absolute',
          left: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          color: uiVars.textMuted,
          pointerEvents: 'none',
        }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSearch) onSearch()
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          width: '100%',
          minHeight: 40,
          borderRadius: radius.md,
          border: `1px solid ${uiVars.borderStrong}`,
          padding: '0 32px 0 36px',
          background: uiVars.surfaceStrong,
          color: uiVars.text,
          fontSize: typeScale.body,
          outline: 'none',
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: uiVars.textMuted,
            cursor: 'pointer',
            padding: 4,
          }}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

export interface FilterOption {
  value: string
  label: string
}

export interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: FilterOption[]
  label?: string
  style?: CSSProperties
}

export function FilterSelect({
  value,
  onChange,
  options,
  label,
  style,
}: FilterSelectProps) {
  return (
    <div style={{ display: 'grid', gap: 4, ...style }}>
      {label && (
        <div
          style={{
            fontSize: typeScale.caption,
            fontWeight: 700,
            color: uiVars.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </div>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          minHeight: 32,
          borderRadius: radius.md,
          border: `1px solid ${uiVars.border}`,
          padding: '0 8px',
          fontSize: 13,
          background: uiVars.surfaceStrong,
          color: uiVars.text,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Toolbar: combined search + filter + actions bar ────────────────────────

export interface ToolbarProps {
  children?: ReactNode
  style?: CSSProperties
}

export function Toolbar({ children, style }: ToolbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: spacing.sm,
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Spacer({ flex }: { flex?: number }) {
  return <div style={{ flex: flex ?? 1 }} />
}

// ─── Page Size Selector ──────────────────────────────────────────────────────

export interface PageSizeSelectorProps {
  value: number
  onChange: (size: number) => void
  options?: number[]
}

// ─── Group AutoComplete ──────────────────────────────────────────────────────

export interface GroupAutoCompleteProps<T> {
  items: T[]
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
  getLabel: (item: T) => string
  getId?: (item: T) => number
  style?: CSSProperties
}

export function GroupAutoComplete<T>({
  items,
  value,
  onChange,
  placeholder = 'Search groups...',
  getLabel,
  getId = (item: any) => item.id ?? item.tg_group_id,
  style,
}: GroupAutoCompleteProps<T>) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const suppressFocus = useRef(false)
  const selected = useMemo(() => items.find(i => getId(i) === value) ?? null, [items, value, getId])

  const filtered = useMemo(
    () => query ? items.filter(i => getLabel(i).toLowerCase().includes(query.toLowerCase())) : items,
    [items, query, getLabel]
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSelect(id: number) {
    onChange(id)
    setQuery('')
    setOpen(false)
    suppressFocus.current = true
    inputRef.current?.blur()
    setTimeout(() => { suppressFocus.current = false }, 200)
  }

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        placeholder={placeholder}
        value={selected && !open ? getLabel(selected) : query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { if (!suppressFocus.current) setOpen(true) }}
        style={{
          width: '100%', minHeight: 42, borderRadius: radius.md,
          border: `1px solid ${uiVars.borderStrong}`, padding: '0 12px',
          background: uiVars.surfaceStrong, color: uiVars.text,
          fontSize: typeScale.body,
          cursor: 'text',
        }}
        aria-label={placeholder}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          marginTop: 4, borderRadius: radius.md, border: `1px solid ${uiVars.border}`,
          background: uiVars.surface, boxShadow: uiVars.shadow, maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: uiVars.textMuted, textAlign: 'center' }}>No results</div>
          ) : filtered.map(item => (
            <div
              key={getId(item)}
              onClick={() => handleSelect(getId(item))}
              style={{
                padding: '10px 12px', cursor: 'pointer', fontSize: typeScale.body,
                background: selected && getId(item) === getId(selected) ? uiVars.primarySoft : 'transparent',
                borderBottom: `1px solid ${uiVars.border}`,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = uiVars.bgMuted }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selected && getId(item) === getId(selected) ? uiVars.primarySoft : 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', width: '100%' }}>
                <span>{getLabel(item)}</span>
                {(item as any).group_type && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    padding: '1px 6px', borderRadius: 4, lineHeight: '18px',
                    background: (item as any).group_type === 'channel' ? 'var(--ui-danger-soft, #fce8e6)' : (item as any).group_type === 'supergroup' ? 'var(--ui-primary-soft, #e8f0fe)' : 'var(--ui-bg-muted, #f1f3f4)',
                    color: (item as any).group_type === 'channel' ? 'var(--ui-danger, #d93025)' : (item as any).group_type === 'supergroup' ? 'var(--ui-primary, #1a73e8)' : 'var(--ui-text-muted, #5f6368)',
                  }}>
                    {(item as any).group_type === 'supergroup' ? 'Super' : (item as any).group_type}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PageSizeSelector({
  value,
  onChange,
  options = [10, 20, 50, 100],
}: PageSizeSelectorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
      <span style={{ fontSize: typeScale.body, color: uiVars.textMuted, whiteSpace: 'nowrap' }}>
        Per page:
      </span>
      <select
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          minHeight: 32,
          borderRadius: radius.md,
          border: `1px solid ${uiVars.border}`,
          padding: '0 8px',
          fontSize: 13,
          background: uiVars.surfaceStrong,
          color: uiVars.text,
          width: 72,
        }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  )
}
