import { useEffect, useMemo, useRef, useState } from 'react'

import type { AgentManagedGroup } from '../types'
import { InputField } from './index'

export type GroupChip = { tg_group_id: number; title: string }

/**
 * Global group autocomplete used across the miniapp.
 *
 * Two selection modes:
 * - "single": one selected group rendered as a removable chip (was GroupDestinationField).
 * - "multi": many selected groups rendered as removable chips (was GroupAutocompleteField / MultiGroupSelect).
 *
 * The suggestions render as a single attached dropdown panel below the input,
 * matching the app's warm surface system (soft border, shadow, DM Sans).
 */
export function GroupAutocomplete({
  label,
  query,
  onQueryChange,
  groups,
  mode = 'single',
  selected,
  selectedGroup,
  onSelect,
  onToggle,
  onClear,
  onRemove,
  placeholder,
  loading,
  syncButton,
  t,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  mode?: 'single' | 'multi'
  /** multi mode: selected chips */
  selected?: GroupChip[]
  /** single mode: selected group */
  selectedGroup?: GroupChip | null
  /** single mode: choose a group */
  onSelect?: (group: GroupChip) => void
  /** multi mode: add/remove a group */
  onToggle?: (group: GroupChip) => void
  /** single mode: clear selection */
  onClear?: () => void
  /** multi mode: remove one chip */
  onRemove?: (tgGroupId: number) => void
  placeholder?: string
  loading?: boolean
  syncButton?: React.ReactNode
  /** Optional translator for built-in strings. Falls back to English when omitted. */
  t?: (key: string, fallback: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedIds = useMemo(
    () => new Set((mode === 'multi' ? selected ?? [] : selectedGroup ? [selectedGroup] : []).map((g) => g.tg_group_id)),
    [mode, selected, selectedGroup],
  )

  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return []
    const seen = new Set<number>()
    return groups.filter((group) => {
      const tgGroupId = Number(group.tg_group_id || 0)
      if (!tgGroupId || seen.has(tgGroupId)) return false
      // In multi mode, already-selected groups are shown in the chip row, not the list.
      if (mode === 'multi' && selectedIds.has(tgGroupId)) return false
      seen.add(tgGroupId)
      return [group.title || '', String(tgGroupId)].some((value) => value.toLowerCase().includes(normalizedQuery))
    }).slice(0, 8)
  }, [groups, normalizedQuery, mode, selectedIds])

  // Close when clicking outside the combobox.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const chips = mode === 'multi' ? (selected ?? []) : selectedGroup ? [selectedGroup] : []

  function handlePick(group: GroupChip) {
    if (mode === 'multi') {
      onToggle?.(group)
    } else {
      onSelect?.(group)
    }
    onQueryChange('')
    setOpen(false)
  }

  function handleRemove(tgGroupId: number) {
    if (mode === 'multi') {
      onRemove?.(tgGroupId)
    } else {
      onClear?.()
    }
    onQueryChange('')
  }

  const showPanel = open && (normalizedQuery.length > 0 || focused)

  return (
    <div ref={rootRef} style={{ display: 'grid', gap: 8, position: 'relative' }}>
      <InputField
        label={label}
        value={mode === 'single' && selectedGroup && !open ? selectedGroup.title : query}
        onChange={onQueryChange}
        onFocus={() => { setFocused(true); setOpen(true) }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? (t?.('shared.searchGroups', 'Search groups') ?? 'Search groups')}
      />
      {showPanel ? (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
          display: 'grid', gap: 2, padding: 6,
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 'var(--miniapp-radius-sm)',
          boxShadow: 'var(--miniapp-shadow-lg)',
          maxHeight: 260, overflow: 'auto',
        }}>
          {loading ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--miniapp-text-muted)', textAlign: 'center' }}>
              {t?.('shared.searching', 'Searching…') ?? 'Searching…'}
            </div>
          ) : suggestions.length ? suggestions.map((group) => (
            <div
              key={String(group.tg_group_id)}
              onClick={() => handlePick({ tg_group_id: Number(group.tg_group_id), title: String(group.title || group.tg_group_id || (t?.('shared.groupFallback', 'Group') ?? 'Group')) })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px',
                borderRadius: 8, cursor: 'pointer', userSelect: 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--miniapp-bg-warm, var(--miniapp-bg))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                background: group.can_add_members === false ? 'var(--miniapp-border)' : 'var(--miniapp-sage)',
              }} />
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, display: 'block', color: 'var(--miniapp-text-primary)' }}>{group.title || (t?.('shared.groupFallback', 'Group') ?? 'Group')}</strong>
                <div style={{ color: 'var(--miniapp-text-muted)', fontSize: 11, marginTop: 1 }}>
                  {group.tg_group_id} · {group.group_type || (t?.('shared.group', 'group') ?? 'group')}
                </div>
              </div>
            </div>
          )) : (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--miniapp-text-muted)', textAlign: 'center' }}>
              {t?.('shared.noMatchingGroups', 'No matching groups found.') ?? 'No matching groups found.'}
            </div>
          )}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {chips.map((group) => (
            <span key={group.tg_group_id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 999,
              border: '1px solid var(--miniapp-sage-border)',
              background: 'var(--miniapp-sage-dim)',
              fontSize: 12.5, fontWeight: 500, color: 'var(--miniapp-text-primary)',
            }}>
              {group.title}
              <button type="button" onClick={() => handleRemove(group.tg_group_id)}
                style={{ border: 'none', background: 'transparent', color: 'var(--miniapp-clay)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
          {mode === 'single' ? syncButton : null}
        </div>
      ) : null}
    </div>
  )
}

export default GroupAutocomplete
