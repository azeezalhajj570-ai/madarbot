import { useMemo } from 'react'

import { InputField, LinkRow, Note } from '@miniapp/shared'
import type { AgentManagedGroup } from '@miniapp/shared'

type SelectedGroupChip = { tg_group_id: number; title: string }

export function GroupDestinationField({
  label,
  query,
  onQueryChange,
  groups,
  selectedGroup,
  onSelect,
  onClear,
  syncButton,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  selectedGroup: SelectedGroupChip | null
  onSelect: (group: SelectedGroupChip) => void
  onClear: () => void
  syncButton?: React.ReactNode
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return []
    const seen = new Set<number>()
    return groups.filter((group) => {
      const tgGroupId = Number(group.tg_group_id || 0)
      if (!tgGroupId || seen.has(tgGroupId)) return false
      seen.add(tgGroupId)
      return [group.title || '', String(tgGroupId)].some((value) => value.toLowerCase().includes(normalizedQuery))
    }).slice(0, 8)
  }, [groups, normalizedQuery])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <InputField label={label} value={query} onChange={onQueryChange} placeholder="Search destination group" />
      {normalizedQuery ? (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)' }}>
          {suggestions.length ? suggestions.map((group) => (
            <LinkRow key={String(group.tg_group_id)} onClick={() => onSelect({ tg_group_id: Number(group.tg_group_id), title: String(group.title || group.tg_group_id || 'Group') })}>
              <strong>{group.title || `Group ${group.tg_group_id}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id} · {group.group_type || 'group'}</div>
            </LinkRow>
          )) : <Note>No matching groups found.</Note>}
        </div>
      ) : (
        <Note>Search to find a destination group.</Note>
      )}
      {selectedGroup ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Note>{selectedGroup.title} · {selectedGroup.tg_group_id}</Note>
          <button type="button" onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: '18px', color: 'var(--miniapp-clay)', padding: '4px' }} title="Clear">✕</button>
          {syncButton}
        </div>
      ) : null}
    </div>
  )
}
