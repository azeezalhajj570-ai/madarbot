import { useMemo, useState } from 'react'
import type { AgentManagedGroup } from '@miniapp/shared'

interface SelectedGroupChip {
  tg_group_id: number
  title: string
}

interface Props {
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  selected: SelectedGroupChip[]
  onToggle: (group: SelectedGroupChip) => void
  placeholder?: string
}

export function MultiGroupSelect({ query, onQueryChange, groups, selected, onToggle, placeholder = 'Search groups...' }: Props) {
  const [focused, setFocused] = useState(false)
  const selectedIds = useMemo(() => new Set(selected.map((g) => g.tg_group_id)), [selected])
  const normalizedQuery = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    const seen = new Set<number>()
    return groups.filter((group) => {
      const tgGroupId = Number(group.tg_group_id || 0)
      if (!tgGroupId || seen.has(tgGroupId)) return false
      seen.add(tgGroupId)
      if (!normalizedQuery) return true
      return [group.title || '', String(tgGroupId)].some((v) => v.toLowerCase().includes(normalizedQuery))
    })
  }, [groups, normalizedQuery])

  const unselected = useMemo(() => filtered.filter((g) => !selectedIds.has(Number(g.tg_group_id))), [filtered, selectedIds])
  const selectedItems = useMemo(() => filtered.filter((g) => selectedIds.has(Number(g.tg_group_id))), [filtered, selectedIds])

  const showList = focused || normalizedQuery.length > 0 || selectedItems.length > 0 || unselected.length > 0

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>
        Target Groups {selected.length > 0 ? <span style={{ color: 'var(--miniapp-coral)', fontWeight: 700 }}>({selected.length})</span> : null}
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '10px 14px', borderRadius: 10,
          border: '1px solid var(--miniapp-border)',
          background: 'var(--miniapp-surface)',
          color: 'var(--miniapp-text-primary)',
          fontSize: 14, fontFamily: 'inherit', outline: 'none',
        }}
      />
      {showList ? (
        <div style={{
          display: 'grid', gap: 2,
          padding: 6, border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 12, background: 'var(--miniapp-bg)',
          maxHeight: 260, overflow: 'auto',
        }}>
          {selectedItems.length > 0 ? (
            <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, color: 'var(--miniapp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Selected ({selectedItems.length})
            </div>
          ) : null}
          {selectedItems.map((group) => (
            <Row key={`sel-${group.tg_group_id}`} group={group} selected={true} onToggle={onToggle} />
          ))}
          {selectedItems.length > 0 && unselected.length > 0 ? (
            <div style={{ padding: '4px 8px', fontSize: 10, fontWeight: 600, color: 'var(--miniapp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 4 }}>
              Results
            </div>
          ) : null}
          {unselected.length > 0 ? unselected.map((group) => (
            <Row key={`uns-${group.tg_group_id}`} group={group} selected={false} onToggle={onToggle} />
          )) : normalizedQuery && selectedItems.length === 0 ? (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--miniapp-text-muted)', textAlign: 'center' }}>
              No groups found
            </div>
          ) : null}
        </div>
      ) : null}
      {selected.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
          {selected.map((group) => (
            <span key={group.tg_group_id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 999,
              border: '1px solid var(--miniapp-border-soft)',
              background: 'var(--miniapp-bg)', fontSize: 12.5,
            }}>
              {group.title}
              <button type="button" onClick={() => onToggle(group)}
                style={{ border: 'none', background: 'transparent', color: 'var(--miniapp-clay)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Row({ group, selected, onToggle }: { group: AgentManagedGroup; selected: boolean; onToggle: (g: SelectedGroupChip) => void }) {
  return (
    <div onClick={() => onToggle({
      tg_group_id: Number(group.tg_group_id),
      title: String(group.title || group.tg_group_id || 'Group'),
    })}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderRadius: 8, cursor: 'pointer', userSelect: 'none',
        background: selected ? 'var(--miniapp-highlight, #e8f4e8)' : 'transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--miniapp-bg-deep)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: '2px solid',
        borderColor: selected ? 'var(--miniapp-sage)' : 'var(--miniapp-border-soft)',
        background: selected ? 'var(--miniapp-sage)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 12, fontWeight: 700,
      }}>
        {selected ? '✓' : ''}
      </span>
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 13 }}>{group.title || `Group ${group.tg_group_id}`}</strong>
        <div style={{ color: '#655d52', fontSize: 11, marginTop: 1 }}>{group.tg_group_id}</div>
      </div>
    </div>
  )
}
