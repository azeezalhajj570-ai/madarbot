import { useTranslation } from 'react-i18next'
import type { ColumnDef } from './DataTable'
import { DataTable } from './DataTable'

interface TableModalProps<T> {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  data: T[]
  columns: ColumnDef<T>[]
  keyField: keyof T
  searchAccessor?: (row: T) => string
  pageSize?: number
  loading?: boolean
  emptyMessage?: string
  renderExpanded?: (row: T) => React.ReactNode
}

export function TableModal<T extends Record<string, unknown>>({
  open, onClose, title, subtitle,
  data, columns, keyField,
  searchAccessor, pageSize = 25,
  loading, emptyMessage, renderExpanded,
}: TableModalProps<T>) {
  const { t } = useTranslation()
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(32,25,16,0.55)',
        display: 'grid', placeItems: 'center', padding: 16, zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20, boxShadow: '0 22px 60px rgba(32,25,16,0.22)',
        }}
      >
        <div style={{
          padding: '20px 20px 12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          borderBottom: '1px solid var(--miniapp-border-soft)',
        }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 18 }}>{title}</h3>
            {subtitle ? <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 2 }}>{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--miniapp-clay)', fontSize: 22, lineHeight: 1,
              padding: 0, flexShrink: 0, marginLeft: 16,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ overflow: 'auto', padding: '12px 20px 20px' }}>
          <DataTable<T>
            data={data}
            columns={columns}
            keyField={keyField}
            searchable={true}
            searchAccessor={searchAccessor}
            pageSize={pageSize}
            loading={loading}
            emptyMessage={emptyMessage || t('common.noData')}
            renderExpanded={renderExpanded}
          />
        </div>
      </div>
    </div>
  )
}
