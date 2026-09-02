import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemberSearchCondition, MemberSearchField, MemberSearchNode, MemberSearchOperator } from '@miniapp/shared'
import type { GroupChip } from '@miniapp/shared'
import {
  CLAIM_STATUS_OPTIONS,
  FIELD_DEFS,
  KeywordMode,
  MEMBER_STATUS_OPTIONS,
  cloneNode,
  defaultOperator,
  emptyCondition,
  emptyGroup,
  fieldDef,
} from './types'

const TEXT_OP_LABELS: Record<string, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'equals',
  not_equals: 'not equals',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: '>',
  greater_than_or_equal: '>=',
  less_than: '<',
  less_than_or_equal: '<=',
  before: 'before',
  after: 'after',
  between: 'between',
}

const KEYWORD_MODE_LABELS: Record<KeywordMode, string> = {
  any: 'ANY',
  all: 'ALL',
  none: 'NONE',
}

export interface FilterBuilderProps {
  node: MemberSearchNode
  groups: GroupChip[]
  onChange: (node: MemberSearchNode) => void
  onRemove?: () => void
  depth?: number
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
  width: '100%',
  minWidth: 0,
}

const selectStyle: React.CSSProperties = { ...inputStyle, padding: '8px 8px', minWidth: 0 }

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.5px',
  textTransform: 'uppercase',
  color: 'var(--miniapp-text-muted)',
}

const removeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--miniapp-text-muted)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: '4px 6px',
  alignSelf: 'center',
}

const addBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--miniapp-border)',
  borderRadius: 10,
  padding: '7px 12px',
  fontSize: 12.5,
  color: 'var(--miniapp-coral)',
  cursor: 'pointer',
  fontFamily: 'var(--miniapp-sans)',
  fontWeight: 600,
}

export function FilterBuilder({ node, groups, onChange, onRemove, depth = 0 }: FilterBuilderProps) {
  if (node.type === 'group') {
    return (
      <GroupBuilder
        node={node}
        groups={groups}
        onChange={onChange}
        onRemove={onRemove}
        depth={depth}
      />
    )
  }
  return <ConditionRow node={node} groups={groups} onChange={onChange} onRemove={onRemove} />
}

// ── Group builder (AND / OR, nested) ─────────────────────────────────────

function GroupBuilder({
  node,
  groups,
  onChange,
  onRemove,
  depth,
}: {
  node: Extract<MemberSearchNode, { type: 'group' }>
  groups: GroupChip[]
  onChange: (node: MemberSearchNode) => void
  onRemove?: () => void
  depth: number
}) {
  const { t } = useTranslation()

  const updateChild = (index: number, child: MemberSearchNode) => {
    const next = cloneNode(node)
    next.conditions[index] = child
    onChange(next)
  }

  const removeChild = (index: number) => {
    const next = cloneNode(node)
    next.conditions.splice(index, 1)
    if (next.conditions.length === 0) {
      // An empty group is invalid — collapse to a fresh condition.
      onChange(emptyCondition())
    } else {
      onChange(next)
    }
  }

  const addCondition = () => {
    const next = cloneNode(node)
    next.conditions.push(emptyCondition())
    onChange(next)
  }

  const addGroup = () => {
    const next = cloneNode(node)
    next.conditions.push(emptyGroup('OR'))
    onChange(next)
  }

  const groupStyle: React.CSSProperties = {
    display: 'grid',
    gap: 10,
    padding: 12,
    border: depth > 0 ? '1px solid var(--miniapp-border-soft)' : 'none',
    borderRadius: 12,
    background: depth > 0 ? 'var(--miniapp-bg)' : 'transparent',
  }

  return (
    <div style={groupStyle}>
      {node.conditions.length > 1 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <select
            aria-label={t('memberSearch.operatorLabel')}
            value={node.operator}
            onChange={(e) => {
              const next = cloneNode(node)
              next.operator = e.target.value as 'AND' | 'OR'
              onChange(next)
            }}
            style={{ ...selectStyle, fontWeight: 700, width: 76, textTransform: 'uppercase' }}
          >
            <option value="AND">AND</option>
            <option value="OR">OR</option>
          </select>
          {onRemove ? (
            <button type="button" style={removeBtnStyle} onClick={onRemove} aria-label={t('common.remove')}>
              ✕
            </button>
          ) : null}
        </div>
      ) : onRemove ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={removeBtnStyle} onClick={onRemove} aria-label={t('common.remove')}>
            ✕
          </button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {node.conditions.map((child, index) => (
          <FilterBuilder
            key={index}
            node={child}
            groups={groups}
            depth={depth + 1}
            onChange={(next) => updateChild(index, next)}
            onRemove={node.conditions.length > 1 ? () => removeChild(index) : undefined}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={addBtnStyle} onClick={addCondition}>
          + {t('memberSearch.addCondition')}
        </button>
        {depth < 5 ? (
          <button type="button" style={addBtnStyle} onClick={addGroup}>
            + {t('memberSearch.addGroup')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ── Condition row ────────────────────────────────────────────────────────

function ConditionRow({
  node,
  groups,
  onChange,
  onRemove,
}: {
  node: MemberSearchCondition
  groups: GroupChip[]
  onChange: (node: MemberSearchNode) => void
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const def = fieldDef(node.field)
  const update = (patch: Partial<MemberSearchCondition>) => onChange({ ...node, ...patch })
  const setValue = (value: MemberSearchCondition['value']) => update({ value })

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {onRemove ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={removeBtnStyle} onClick={onRemove} aria-label={t('common.remove')}>
            ✕
          </button>
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
          alignItems: 'start',
        }}
      >
        <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={labelStyle}>{t('memberSearch.field')}</span>
          <select
            value={node.field}
            onChange={(e) => {
              const field = e.target.value as MemberSearchField
              update({ field, operator: defaultOperator(field), value: defaultValueFor(field) })
            }}
            style={{ ...selectStyle, width: '100%' }}
          >
            {FIELD_DEFS.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <span style={labelStyle}>{t('memberSearch.operator')}</span>
          <select
            value={node.operator}
            onChange={(e) => update({ operator: e.target.value as MemberSearchOperator })}
            style={{ ...selectStyle, width: '100%', whiteSpace: 'nowrap' }}
          >
            {def.operators.map((op) => (
              <option key={op} value={op}>
                {TEXT_OP_LABELS[op] ?? op}
              </option>
            ))}
          </select>
        </label>

        <div style={{ minWidth: 0 }}>
          <ValueInput
            node={node}
            groups={groups}
            setValue={setValue}
            onMatchChange={(match) => update({ match })}
          />
        </div>
      </div>
    </div>
  )
}

// ── Per-kind value input ─────────────────────────────────────────────────

function ValueInput({
  node,
  groups,
  setValue,
  onMatchChange,
}: {
  node: MemberSearchCondition
  groups: GroupChip[]
  setValue: (v: MemberSearchCondition['value']) => void
  onMatchChange: (match: 'substring' | 'token' | 'phrase') => void
}) {
  const { t } = useTranslation()
  const def = fieldDef(node.field)

  if (node.field === 'message.content' && Array.isArray(node.value)) {
    return <KeywordInput node={node} setValue={setValue} onMatchChange={onMatchChange} />
  }

  switch (def.kind) {
    case 'keywords':
      return (
        <KeywordSingleInput
          node={node}
          setValue={setValue}
          onMatchChange={onMatchChange}
        />
      )
    case 'number':
      return (
        <NumberInput node={node} setValue={setValue} />
      )
    case 'date':
      return <DateInput node={node} setValue={setValue} />
    case 'status':
      return (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>{t('memberSearch.value')}</span>
          <select value={String(node.value)} onChange={(e) => setValue(e.target.value)} style={selectStyle}>
            {MEMBER_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )
    case 'claim':
      return (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>{t('memberSearch.value')}</span>
          <select value={String(node.value)} onChange={(e) => setValue(e.target.value)} style={selectStyle}>
            {CLAIM_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )
    case 'group':
      return (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>{t('memberSearch.value')}</span>
          <select
            value={String(node.value)}
            onChange={(e) => setValue(e.target.value)}
            style={selectStyle}
          >
            <option value="">{t('memberSearch.anyGroup')}</option>
            {groups.map((g) => (
              <option key={g.tg_group_id} value={g.tg_group_id}>
                {g.title || `Group ${g.tg_group_id}`}
              </option>
            ))}
          </select>
        </label>
      )
    default:
      return (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>{t('memberSearch.value')}</span>
          <input
            type="text"
            value={typeof node.value === 'string' ? node.value : ''}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('memberSearch.valuePlaceholder')}
            style={inputStyle}
          />
        </label>
      )
  }
}

// ── Keyword inputs ───────────────────────────────────────────────────────

function KeywordSingleInput({
  node,
  setValue,
  onMatchChange,
}: {
  node: MemberSearchCondition
  setValue: (v: MemberSearchCondition['value']) => void
  onMatchChange: (match: 'substring' | 'token' | 'phrase') => void
}) {
  const { t } = useTranslation()
  const text = typeof node.value === 'string' ? node.value : ''
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        {t('memberSearch.value')}
        <select
          value={node.match || 'substring'}
          onChange={(e) => onMatchChange(e.target.value as 'substring' | 'token' | 'phrase')}
          style={{ ...selectStyle, padding: '1px 4px', fontSize: 11, fontWeight: 600 }}
        >
          <option value="substring">{t('memberSearch.matchSubstring')}</option>
          <option value="token">{t('memberSearch.matchToken')}</option>
          <option value="phrase">{t('memberSearch.matchPhrase')}</option>
        </select>
      </span>
      <input
        type="text"
        value={text}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('memberSearch.keywordPlaceholder')}
        style={inputStyle}
      />
    </label>
  )
}

function KeywordInput({
  node,
  setValue,
  onMatchChange,
}: {
  node: MemberSearchCondition
  setValue: (v: MemberSearchCondition['value']) => void
  onMatchChange: (match: 'substring' | 'token' | 'phrase') => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const mode = keywordModeFor(node)
  const keywords = (Array.isArray(node.value) ? node.value : []) as string[]

  const commitDraft = () => {
    const kw = draft.trim()
    if (!kw) return
    const next = keywords.includes(kw) ? keywords : [...keywords, kw]
    setValue(next)
    setDraft('')
  }

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
        {t('memberSearch.keywords')}
        <select
          value={mode}
          onChange={(e) => setValue(keywordsForMode(node, e.target.value as KeywordMode))}
          style={{ ...selectStyle, padding: '1px 4px', fontSize: 11, fontWeight: 700 }}
        >
          {(Object.keys(KEYWORD_MODE_LABELS) as KeywordMode[]).map((m) => (
            <option key={m} value={m}>
              {KEYWORD_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <select
          value={node.match || 'substring'}
          onChange={(e) => onMatchChange(e.target.value as 'substring' | 'token' | 'phrase')}
          style={{ ...selectStyle, padding: '1px 4px', fontSize: 11, fontWeight: 600 }}
        >
          <option value="substring">{t('memberSearch.matchSubstring')}</option>
          <option value="token">{t('memberSearch.matchToken')}</option>
          <option value="phrase">{t('memberSearch.matchPhrase')}</option>
        </select>
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {keywords.map((kw) => (
          <span
            key={kw}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'var(--miniapp-surface)',
              border: '1px solid var(--miniapp-border-soft)',
              color: 'var(--miniapp-text-primary)',
              fontSize: 12,
            }}
          >
            {kw}
            <button
              type="button"
              aria-label={t('common.remove')}
              onClick={() => setValue(keywords.filter((k) => k !== kw))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--miniapp-text-muted)', padding: 0, fontSize: 12, lineHeight: 1 }}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commitDraft()
            }
          }}
          onBlur={commitDraft}
          placeholder={t('memberSearch.keywordPlaceholder')}
          style={{ ...inputStyle, flex: 1, minWidth: 120, padding: '6px 10px' }}
        />
      </div>
    </div>
  )
}

// ── Numeric / date inputs ────────────────────────────────────────────────

function NumberInput({
  node,
  setValue,
}: {
  node: MemberSearchCondition
  setValue: (v: MemberSearchCondition['value']) => void
}) {
  const { t } = useTranslation()
  if (node.operator === 'between') {
    const range = (typeof node.value === 'object' && node.value ? node.value : {}) as { from?: string | number; to?: string | number }
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <input
          type="number"
          value={range.from ?? ''}
          onChange={(e) => setValue({ from: e.target.value === '' ? undefined : Number(e.target.value), to: range.to })}
          placeholder={t('memberSearch.from')}
          style={inputStyle}
        />
        <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 12, flexShrink: 0 }}>–</span>
        <input
          type="number"
          value={range.to ?? ''}
          onChange={(e) => setValue({ from: range.from, to: e.target.value === '' ? undefined : Number(e.target.value) })}
          placeholder={t('memberSearch.to')}
          style={inputStyle}
        />
      </div>
    )
  }
  return (
    <input
      type="number"
      value={typeof node.value === 'number' ? node.value : ''}
      onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
      placeholder={t('memberSearch.valuePlaceholder')}
      style={inputStyle}
    />
  )
}

function DateInput({
  node,
  setValue,
}: {
  node: MemberSearchCondition
  setValue: (v: MemberSearchCondition['value']) => void
}) {
  const { t } = useTranslation()
  if (node.operator === 'between') {
    const range = (typeof node.value === 'object' && node.value ? node.value : {}) as { from?: string | number; to?: string | number }
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <input
          type="date"
          value={String(range.from ?? '')}
          onChange={(e) => setValue({ from: e.target.value || undefined, to: range.to })}
          style={inputStyle}
        />
        <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 12, flexShrink: 0 }}>–</span>
        <input
          type="date"
          value={String(range.to ?? '')}
          onChange={(e) => setValue({ from: range.from, to: e.target.value || undefined })}
          style={inputStyle}
        />
      </div>
    )
  }
  const value = typeof node.value === 'string' ? node.value.slice(0, 10) : ''
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      style={inputStyle}
    />
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function defaultValueFor(field: MemberSearchField): MemberSearchCondition['value'] {
  const def = fieldDef(field)
  if (def.kind === 'number') return 0
  if (def.kind === 'date') return ''
  if (def.kind === 'status') return 'member'
  if (def.kind === 'claim') return 'claimed'
  if (def.kind === 'keywords') return []
  return ''
}

function keywordModeFor(node: MemberSearchCondition): KeywordMode {
  const op = node.operator
  if (op === 'not_contains' || op === 'not_equals') return 'none'
  if (Array.isArray(node.value)) return 'any'
  return 'any'
}

function keywordsForMode(node: MemberSearchCondition, mode: KeywordMode): string[] {
  const current = Array.isArray(node.value) ? node.value : []
  return current
}
