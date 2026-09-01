import type {
  MemberSearchField,
  MemberSearchGroup,
  MemberSearchNode,
  MemberSearchOperator,
  MemberSearchSort,
} from '@miniapp/shared'

export type {
  MemberSearchCondition,
  MemberSearchField,
  MemberSearchGroup,
  MemberSearchMatch,
  MemberSearchNode,
  MemberSearchOperator,
  MemberSearchResult,
  MemberSearchResultItem,
  MemberSearchSort,
} from '@miniapp/shared'

export type KeywordMode = 'any' | 'all' | 'none'

/** How a condition's value is edited in the builder. */
export type ValueKind =
  | 'text'
  | 'number'
  | 'date'
  | 'status'
  | 'claim'
  | 'group'
  | 'keywords'

export interface FieldDef {
  field: MemberSearchField
  label: string
  kind: ValueKind
  operators: MemberSearchOperator[]
  /** message.content only — same-message vs member-level matching. */
  matchable?: boolean
}

export const FIELD_DEFS: FieldDef[] = [
  { field: 'message.content', label: 'Message contains', kind: 'keywords', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'], matchable: true },
  { field: 'member.username', label: 'Username', kind: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'] },
  { field: 'member.display_name', label: 'Display name', kind: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'] },
  { field: 'member.user_id', label: 'User ID', kind: 'number', operators: ['equals', 'not_equals'] },
  { field: 'member.status', label: 'Member status', kind: 'status', operators: ['equals', 'not_equals'] },
  { field: 'member.claim_status', label: 'Claim status', kind: 'claim', operators: ['equals', 'not_equals'] },
  { field: 'member.message_count', label: 'Message count', kind: 'number', operators: ['equals', 'not_equals', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'between'] },
  { field: 'member.first_message_at', label: 'First message at', kind: 'date', operators: ['before', 'after', 'between'] },
  { field: 'member.last_message_at', label: 'Last active at', kind: 'date', operators: ['before', 'after', 'between'] },
  { field: 'group.name', label: 'Group name', kind: 'text', operators: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'] },
  { field: 'message.created_at', label: 'Message date', kind: 'date', operators: ['before', 'after', 'between'] },
]

export function fieldDef(field: MemberSearchField): FieldDef {
  return FIELD_DEFS.find((d) => d.field === field) ?? FIELD_DEFS[0]
}

export function defaultOperator(field: MemberSearchField): MemberSearchOperator {
  const def = fieldDef(field)
  if (def.kind === 'number' || def.kind === 'date') return def.operators[0]
  if (field === 'message.content') return 'contains'
  return 'contains'
}

export const SORT_OPTIONS: Array<{ value: MemberSearchSort; label: string }> = [
  { value: 'newest_matching_activity', label: 'Newest matching activity' },
  { value: 'last_active', label: 'Last active' },
  { value: 'message_count', label: 'Message count' },
  { value: 'username', label: 'Username' },
]

export const MEMBER_STATUS_OPTIONS = ['admin', 'creator', 'member', 'restricted']
export const CLAIM_STATUS_OPTIONS = ['claimed', 'unclaimed', 'claimed_by_me', 'claimed_by_other']

export function emptyCondition(): MemberSearchNode {
  return {
    type: 'condition',
    field: 'message.content',
    operator: 'contains',
    value: '',
  }
}

export function emptyGroup(operator: 'AND' | 'OR' = 'AND'): MemberSearchGroup {
  return { type: 'group', operator, conditions: [emptyCondition()] }
}

/** True if the node is a valid, searchable filter (no empty text/values). */
export function isFilterUsable(node: MemberSearchNode): boolean {
  if (node.type === 'condition') {
    const v = node.value
    if (typeof v === 'string') return v.trim().length > 0
    if (Array.isArray(v)) return v.some((k) => typeof k === 'string' && k.trim().length > 0)
    if (v && typeof v === 'object') {
      const range = v as { from?: string | number; to?: string | number }
      const has = (x: unknown) => x !== undefined && x !== null && x !== ''
      return has(range.from) || has(range.to)
    }
    if (typeof v === 'number') return true
    return v !== undefined && v !== null && v !== ''
  }
  return node.conditions.length > 0 && node.conditions.some(isFilterUsable)
}

/** Clone a filter tree (immutable builder updates). */
export function cloneNode<T extends MemberSearchNode>(node: T): T {
  if (node.type === 'group') {
    return {
      type: 'group',
      operator: node.operator,
      conditions: node.conditions.map(cloneNode),
    } as T
  }
  return { ...node, value: Array.isArray(node.value) ? [...node.value] : node.value } as T
}
