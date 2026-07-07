import { useTranslation } from 'react-i18next'

export interface Toast {
  id: string
  kind: 'notification' | 'error' | 'success' | 'info'
  title: string
  body: string
  notificationId?: number
  onAction?: () => void
}

const ANIMATION_STYLES = `
@keyframes toast-in {
  from { transform: translateX(120%); opacity: 0; }
  to   { transform: translateX(0);   opacity: 1; }
}
`

function toastAccent(kind: string) {
  switch (kind) {
    case 'error': return '#a1573e'
    case 'success': return '#36664e'
    case 'notification': return '#475977'
    default: return '#475977'
  }
}

function toastBg(kind: string) {
  switch (kind) {
    case 'error': return 'rgba(161, 87, 62, 0.06)'
    case 'success': return 'rgba(54, 102, 78, 0.06)'
    case 'notification': return 'rgba(71, 89, 119, 0.06)'
    default: return 'rgba(71, 89, 119, 0.06)'
  }
}

export function ToastContainer({
  toasts,
  onDismiss,
  onAction,
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
  onAction: (toast: Toast) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      aria-live="polite"
      aria-label={t('toast.notifications')}
      style={{
        position: 'fixed',
        top: 70,
        right: 16,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 360,
        width: 'calc(100% - 32px)',
      }}
    >
      <style>{ANIMATION_STYLES}</style>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => onAction(toast)}
          role="alert"
          style={{
            pointerEvents: 'auto',
            animation: 'toast-in 0.35s ease-out',
            background: toastBg(toast.kind),
            border: '1px solid var(--miniapp-border-soft)',
            borderLeft: `4px solid ${toastAccent(toast.kind)}`,
            borderRadius: 12,
            padding: '12px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            cursor: 'pointer',
            display: 'grid',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{toast.title}</strong>
            <button
              type="button"
              aria-label={t('toast.dismiss')}
              onClick={(e) => { e.stopPropagation(); onDismiss(toast.id) }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--miniapp-clay)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#655d52',
              lineHeight: 1.4,
              wordBreak: 'break-word',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {toast.body}
          </div>
        </div>
      ))}
    </div>
  )
}
