import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { InputField, LinkRow, Note } from '@miniapp/shared'
import type { AgentManagedGroup } from '@miniapp/shared'

type SelectedGroupChip = { tg_group_id: number; title: string }

export function GroupAutocompleteField({
  label,
  query,
  onQueryChange,
  groups,
  selectedGroups,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  selectedGroups: SelectedGroupChip[]
  onAdd: (group: SelectedGroupChip) => void
  onRemove: (tgGroupId: number) => void
  placeholder: string
}) {
  const selectedIds = useMemo(() => new Set(selectedGroups.map((g) => g.tg_group_id)), [selectedGroups])
  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return []
    return groups.filter((group) => {
      const tgGroupId = Number(group.tg_group_id || 0)
      if (!tgGroupId || selectedIds.has(tgGroupId)) return false
      return [group.title || '', String(group.tg_group_id || '')].some((v) => v.toLowerCase().includes(normalizedQuery))
    }).slice(0, 8)
  }, [groups, normalizedQuery, selectedIds])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <InputField label={label} value={query} onChange={onQueryChange} placeholder={placeholder} />
      {normalizedQuery ? (
        <div style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12, background: 'var(--miniapp-bg)' }}>
          {suggestions.length ? suggestions.map((group) => (
            <LinkRow key={String(group.tg_group_id)} onClick={() => onAdd({ tg_group_id: Number(group.tg_group_id), title: String(group.title || group.tg_group_id || 'Group') })}>
              <strong>{group.title || `Group ${group.tg_group_id}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id}</div>
            </LinkRow>
          )) : <Note>No matching groups found.</Note>}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {selectedGroups.length ? selectedGroups.map((group) => (
          <span key={group.tg_group_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 999, border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-bg)', fontSize: 12.5 }}>
            {group.title}
            <button type="button" onClick={() => onRemove(group.tg_group_id)} style={{ border: 'none', background: 'transparent', color: 'var(--miniapp-clay)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        )) : <Note>No groups selected.</Note>}
      </div>
    </div>
  )
}
