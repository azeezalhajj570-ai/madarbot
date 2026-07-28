import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { contentMaxWidth, radius, spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'

const panelBaseStyle: CSSProperties = {
  background: uiVars.surface,
  border: `1px solid ${uiVars.border}`,
  borderRadius: radius.lg,
  boxShadow: uiVars.shadow,
}

function buttonVariantStyle(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case 'outline':
      return {
        background: uiVars.surfaceStrong,
        color: uiVars.text,
        border: `1px solid ${uiVars.borderStrong}`,
      }
    case 'ghost':
      return {
        background: 'transparent',
        color: uiVars.textMuted,
        border: '1px solid transparent',
      }
    case 'destructive':
      return {
        background: uiVars.dangerSoft,
        color: uiVars.danger,
        border: `1px solid color-mix(in srgb, ${uiVars.danger} 22%, transparent)`,
      }
    default:
      return {
        background: uiVars.primary,
        color: uiVars.primaryText,
        border: `1px solid ${uiVars.primary}`,
      }
  }
}

function overlayStyle(dimmed = true): CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    background: dimmed ? 'rgba(20, 33, 61, 0.22)' : 'transparent',
    backdropFilter: 'blur(8px)',
    zIndex: 1000,
  }
}

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive'

export function AutoComplete<T>({
  items,
  value,
  onChange,
  placeholder = 'Search...',
  getLabel = (item: T) => String(item),
  getKey = (item: T) => String(item),
  style,
}: {
  items: T[]
  value: T | null
  onChange: (item: T | null) => void
  placeholder?: string
  getLabel?: (item: T) => string
  getKey?: (item: T) => string
  style?: CSSProperties
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <input
        placeholder={placeholder}
        value={value && !open ? getLabel(value) : query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{
          width: '100%', minHeight: 44, borderRadius: radius.md,
          border: `1px solid ${uiVars.borderStrong}`, padding: '0 14px',
          background: uiVars.surfaceStrong, color: uiVars.text,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72)',
          cursor: 'text',
        }}
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
              key={getKey(item)}
              onClick={() => { onChange(item); setQuery(''); setOpen(false) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 14,
                background: value && getKey(item) === getKey(value) ? uiVars.primarySoft : 'transparent',
                borderBottom: `1px solid ${uiVars.border}`,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = uiVars.bgMuted }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = value && getKey(item) === getKey(value) ? uiVars.primarySoft : 'transparent' }}
            >
              {getLabel(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  style,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: { minHeight: 32, padding: '0 10px', fontSize: 13 },
    md: { minHeight: 40, padding: '0 14px', fontSize: typeScale.subhead },
    lg: { minHeight: 48, padding: '0 20px', fontSize: 16 },
  }
  const sizeStyle = sizes[size]

  return (
    <button
      {...props}
      style={{
        borderRadius: radius.md,
        fontWeight: 700,
        lineHeight: '18px',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
        opacity: props.disabled ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        whiteSpace: 'nowrap',
        ...sizeStyle,
        ...buttonVariantStyle(variant),
        ...style,
      }}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  style,
  padded = true,
  title,
  subtitle,
}: {
  children: ReactNode
  style?: CSSProperties
  padded?: boolean
  title?: string
  subtitle?: string
}) {
  return (
    <section style={{ ...panelBaseStyle, padding: padded ? spacing.lg : 0, ...style }}>
      {title ? (
        <div style={{ padding: `0 0 ${spacing.md}px 0`, borderBottom: `1px solid ${uiVars.border}`, marginBottom: spacing.md }}>
          <div style={{ fontSize: typeScale.title, fontWeight: 700, lineHeight: '24px', color: uiVars.text }}>{title}</div>
          {subtitle ? <div style={{ fontSize: typeScale.body, color: uiVars.textMuted, marginTop: 2, lineHeight: '20px' }}>{subtitle}</div> : null}
        </div>
      ) : null}
      <div>{children}</div>
    </section>
  )
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div style={{ padding: spacing.xxxl, textAlign: 'center', color: uiVars.textMuted }}>
      <div className="pulse" style={{ width: 32, height: 32, borderRadius: 16, background: uiVars.primarySoft, margin: '0 auto 12px' }} />
      <div style={{ fontSize: typeScale.body }}>{label}</div>
    </div>
  )
}

export function SectionHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.lg }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          {icon ? <span style={{ color: uiVars.primary, flexShrink: 0 }}>{icon}</span> : null}
          <div style={{ fontSize: 22, lineHeight: '28px', fontWeight: 800, color: uiVars.text }}>{title}</div>
        </div>
        {subtitle ? (
          <div style={{ marginTop: spacing.xs, fontSize: typeScale.body, lineHeight: '20px', color: uiVars.textMuted }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div> : null}
    </div>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        minHeight: 42,
        borderRadius: radius.md,
        border: `1px solid ${uiVars.borderStrong}`,
        padding: '0 12px',
        background: uiVars.surfaceStrong,
        color: uiVars.text,
        fontSize: typeScale.body,
        transition: 'border-color 0.15s',
        ...props.style,
      }}
    />
  )
}

export function Select({
  children,
  size: selectSize,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode; size?: 'sm' | 'default' }) {
  return (
    <select
      {...props}
      style={{
        width: '100%',
        minHeight: selectSize === 'sm' ? 32 : 42,
        borderRadius: radius.md,
        border: `1px solid ${uiVars.border}`,
        padding: selectSize === 'sm' ? '0 8px' : '0 12px',
        fontSize: selectSize === 'sm' ? 13 : typeScale.body,
        background: uiVars.surfaceStrong,
        color: uiVars.text,
        ...props.style,
      }}
    >
      {children}
    </select>
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%',
        minHeight: 100,
        borderRadius: radius.md,
        border: `1px solid ${uiVars.borderStrong}`,
        padding: 12,
        background: uiVars.surfaceStrong,
        color: uiVars.text,
        fontSize: typeScale.body,
        resize: 'vertical',
        ...props.style,
      }}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <div>
        <div style={{ fontSize: typeScale.body, lineHeight: '18px', fontWeight: 700, color: uiVars.textMuted }}>
          {label}
        </div>
        {hint ? <div style={{ marginTop: 2, fontSize: typeScale.caption, lineHeight: '16px', color: uiVars.textSubtle }}>{hint}</div> : null}
      </div>
      {children}
    </label>
  )
}

export function FieldRow({
  children,
  columns = 2,
}: {
  children: ReactNode
  columns?: 1 | 2 | 3
}) {
  return (
    <div
      className="field-row"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: spacing.md,
      }}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'default',
  style,
}: {
  children: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'neutral'
  style?: CSSProperties
}) {
  const tones: Record<string, CSSProperties> = {
    default: { background: uiVars.primarySoft, color: uiVars.primary },
    success: { background: uiVars.successSoft, color: uiVars.success },
    warning: { background: uiVars.warningSoft, color: uiVars.warning },
    destructive: { background: uiVars.dangerSoft, color: uiVars.danger },
    info: { background: uiVars.primarySoft, color: uiVars.primary },
    neutral: { background: uiVars.bgMuted, color: uiVars.textMuted },
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: radius.xs,
        padding: '3px 7px',
        fontSize: typeScale.caption,
        lineHeight: '16px',
        fontWeight: 700,
      ...tones[tone],
      ...style,
    }}
  >
    {children}
  </span>
)
}

export function ToggleRow({
  title,
  subtitle,
  defaultChecked,
  checked,
  onCheckedChange,
  action,
  disabled,
}: {
  title: ReactNode
  subtitle: ReactNode
  defaultChecked?: boolean
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  action?: ReactNode
  disabled?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        padding: '12px 14px',
        borderRadius: radius.md,
        border: `1px solid ${uiVars.border}`,
        background: uiVars.surfaceAlt,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: typeScale.subhead, lineHeight: '20px', fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: 2, fontSize: typeScale.body, lineHeight: '20px', color: uiVars.textMuted }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        {action}
        <input
          type="checkbox"
          defaultChecked={defaultChecked}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange?.(event.target.checked)}
          style={{ width: 18, height: 18, accentColor: 'var(--ui-primary)' }}
        />
      </div>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string
  hint: string
  icon?: ReactNode
}) {
  return (
    <Card style={{ display: 'grid', gap: spacing.xs }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
        <div style={{ fontSize: typeScale.body, lineHeight: '18px', fontWeight: 700, color: uiVars.textMuted }}>
          {label}
        </div>
        {icon ? <div style={{ color: uiVars.primary }}>{icon}</div> : null}
      </div>
      <div style={{ fontSize: 28, lineHeight: '32px', fontWeight: 800, color: uiVars.text }}>{value}</div>
      <div style={{ fontSize: typeScale.caption, lineHeight: '16px', color: uiVars.textSubtle }}>{hint}</div>
    </Card>
  )
}

export function EmptyState({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        padding: spacing.xxxl,
        textAlign: 'center',
        display: 'grid',
        gap: spacing.sm,
        justifyItems: 'center',
      }}
    >
      <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 700, color: uiVars.text }}>{title}</div>
      <div style={{ maxWidth: 420, fontSize: typeScale.body, lineHeight: '20px', color: uiVars.textMuted }}>{subtitle}</div>
      {action}
    </div>
  )
}

export function Skeleton({ width, height, style }: {
  width?: string | number
  height?: string | number
  style?: CSSProperties
}) {
  return (
    <div
      aria-hidden="true"
      className="pulse"
      style={{
        borderRadius: radius.xs,
        background: uiVars.bgMuted,
        width: width ?? '100%',
        height: height ?? 16,
        ...style,
      }}
    />
  )
}

const CARD_SKELETON_WIDTHS = ['85%', '70%', '60%', '75%', '65%']

export function CardSkeleton({ rows = 3, title = true }: { rows?: number; title?: boolean }) {
  return (
    <Card aria-busy="true" aria-label="Loading content">
      <div style={{ display: 'grid', gap: spacing.md }}>
        {title && <Skeleton width="55%" height={20} />}
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} height={14} width={CARD_SKELETON_WIDTHS[i % CARD_SKELETON_WIDTHS.length]} />
        ))}
      </div>
    </Card>
  )
}

export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading table data">
      <div style={{ display: 'grid', gap: spacing.sm }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: spacing.md, padding: '0 0 10px 0' }}>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} height={12} width="70%" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: spacing.md, padding: '12px 0', borderTop: `1px solid ${uiVars.border}` }}>
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton key={colIdx} height={14} width={colIdx === 0 ? '65%' : '85%'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function InlineMessage({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'destructive'
  children: ReactNode
}) {
  const toneStyle: Record<string, CSSProperties> = {
    neutral: { background: uiVars.bgMuted, color: uiVars.textMuted },
    success: { background: uiVars.successSoft, color: uiVars.success },
    warning: { background: uiVars.warningSoft, color: uiVars.warning },
    destructive: { background: uiVars.dangerSoft, color: uiVars.danger },
  }

  return (
    <div style={{ padding: '10px 14px', borderRadius: radius.md, fontSize: typeScale.body, lineHeight: '20px', ...toneStyle[tone] }}>
      {children}
    </div>
  )
}

export function ActionBar({
  primary,
  secondary,
}: {
  primary?: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>{secondary}</div>
      <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>{primary}</div>
    </div>
  )
}

export interface ColumnDef<Row = any> {
  key: string
  label: string
  hideOnMobile?: boolean
  render: (row: Row, index: number) => ReactNode
}

export function Table<Row>({
  columns,
  data,
  keyExtractor = (_, i) => i,
}: {
  columns: ColumnDef<Row>[]
  data: Row[]
  keyExtractor?: (row: Row, index: number) => string | number
}) {
  const visibleColumns = columns.filter(c => !c.hideOnMobile)

  return (
    <div>
      <div className="table-desktop-view" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: 'left',
                    fontSize: typeScale.caption,
                    color: uiVars.textMuted,
                    padding: '0 8px 10px 0',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={keyExtractor(row, i)}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '12px 8px 12px 0',
                      borderTop: `1px solid ${uiVars.border}`,
                      fontSize: typeScale.body,
                      lineHeight: '20px',
                      verticalAlign: 'top',
                    }}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-mobile-view" style={{ display: 'none', gap: spacing.sm }}>
        {data.map((row, i) => (
          <div
            key={keyExtractor(row, i)}
            style={{
              background: uiVars.surface,
              border: `1px solid ${uiVars.border}`,
              borderRadius: radius.lg,
              padding: spacing.md,
              display: 'grid',
              gap: spacing.sm,
            }}
          >
            {visibleColumns.map((col) => (
              <div key={col.key} style={{ display: 'grid', gap: 1 }}>
                <div
                  style={{
                    fontSize: typeScale.micro,
                    fontWeight: 700,
                    color: uiVars.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {col.label}
                </div>
                <div style={{ fontSize: typeScale.body }}>{col.render(row, i)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ListItem({
  title,
  subtitle,
  meta,
  actions,
  markerColor,
}: {
  title: ReactNode
  subtitle: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  markerColor?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        padding: `${spacing.md}px 0`,
        borderTop: `1px solid ${uiVars.border}`,
      }}
    >
      <div style={{ display: 'flex', gap: spacing.sm, minWidth: 0, flex: 1 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: radius.xs,
            background: markerColor ?? uiVars.primary,
            marginTop: 7,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <div style={{ fontSize: typeScale.subhead, lineHeight: '20px', fontWeight: 700 }}>{title}</div>
            {meta}
          </div>
          <div style={{ marginTop: 2, fontSize: typeScale.body, lineHeight: '20px', color: uiVars.textMuted }}>{subtitle}</div>
        </div>
      </div>
      {actions ? <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div> : null}
    </div>
  )
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div style={{ ...overlayStyle(), display: 'grid', placeItems: 'center', padding: spacing.lg }}>
      <div style={{ ...panelBaseStyle, width: 'min(520px, 100%)', padding: spacing.xl, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.lg }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: '24px' }}>{title}</div>
            {description ? <div style={{ fontSize: typeScale.body, color: uiVars.textMuted, marginTop: 2 }}>{description}</div> : null}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: uiVars.textMuted, cursor: 'pointer', padding: 4 }} aria-label="Close">✕</button>
        </div>
        <div style={{ display: 'grid', gap: spacing.md }}>{children}</div>
      </div>
    </div>
  )
}

export function Sheet({
  open,
  title,
  description,
  children,
  onClose,
  footer,
}: {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
}) {
  if (!open) return null

  return (
    <div style={overlayStyle()}>
      <div
        style={{
          position: 'absolute',
          top: spacing.lg,
          right: spacing.lg,
          bottom: spacing.lg,
          width: 'min(520px, calc(100vw - 32px))',
          ...panelBaseStyle,
          background: uiVars.surfaceStrong,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: spacing.xl, borderBottom: `1px solid ${uiVars.border}` }}>
          <SectionHeader title={title} subtitle={description} actions={<Button variant="ghost" onClick={onClose}>Close</Button>} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: spacing.xl, display: 'grid', gap: spacing.lg }}>{children}</div>
        {footer ? <div style={{ padding: spacing.xl, borderTop: `1px solid ${uiVars.border}` }}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (value: string) => void
  items: { value: string; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
      {items.map((item) => (
        <Button key={item.value} variant={value === item.value ? 'default' : 'outline'} size="sm" onClick={() => onChange(item.value)}>
          {item.label}
        </Button>
      ))}
    </div>
  )
}

export function ContentGrid({
  children,
  columns = 'repeat(2, minmax(0, 1fr))',
}: {
  children: ReactNode
  columns?: string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: spacing.lg }}>
      {children}
    </div>
  )
}

export function PageFrame({ children }: { children: ReactNode }) {
  return <div style={{ width: '100%', maxWidth: contentMaxWidth, margin: '0 auto', display: 'grid', gap: spacing.lg }}>{children}</div>
}
