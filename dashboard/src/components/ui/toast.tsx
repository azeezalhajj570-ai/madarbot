import { createContext, useContext, useState, useCallback, useRef, useEffect, type CSSProperties, type ReactNode } from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'

import { radius, spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration: number
  createdAt: number
}

interface ToastContextValue {
  toast: {
    success: (message: string, duration?: number) => void
    error: (message: string, duration?: number) => void
    warning: (message: string, duration?: number) => void
    info: (message: string, duration?: number) => void
  }
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return {
      toast: {
        success: () => {},
        error: () => {},
        warning: () => {},
        info: () => {},
      },
    }
  }
  return ctx
}

let toastIdCounter = 0

const TYPE_STYLES: Record<ToastType, { bg: string; icon: ReactNode }> = {
  success: { bg: uiVars.successSoft, icon: <CheckCircle2 size={18} style={{ color: uiVars.success }} /> },
  error: { bg: uiVars.dangerSoft, icon: <AlertCircle size={18} style={{ color: uiVars.danger }} /> },
  warning: { bg: uiVars.warningSoft, icon: <AlertTriangle size={18} style={{ color: uiVars.warning }} /> },
  info: { bg: uiVars.primarySoft, icon: <Info size={18} style={{ color: uiVars.primary }} /> },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = `toast-${++toastIdCounter}`
    const toast: ToastItem = { id, type, message, duration, createdAt: Date.now() }
    setToasts(prev => [...prev.slice(-4), toast])
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => removeToast(id), duration))
    }
  }, [removeToast])

  const toast = {
    success: (msg: string, dur?: number) => addToast('success', msg, dur),
    error: (msg: string, dur?: number) => addToast('error', msg, dur),
    warning: (msg: string, dur?: number) => addToast('warning', msg, dur),
    info: (msg: string, dur?: number) => addToast('info', msg, dur),
  }

  // Cleanup on unmount
  useEffect(() => () => { timers.current.forEach(t => clearTimeout(t)) }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        role="alert"
        aria-live="polite"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: spacing.lg,
          right: spacing.lg,
          zIndex: 9999,
          display: 'grid',
          gap: spacing.sm,
          maxWidth: 380,
          width: 'calc(100vw - 32px)',
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => {
          const style = TYPE_STYLES[t.type]
          return (
            <div
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: spacing.sm,
                padding: '12px 14px',
                borderRadius: radius.lg,
                background: style.bg,
                border: `1px solid ${uiVars.border}`,
                boxShadow: uiVars.shadowStrong,
                pointerEvents: 'auto',
                animation: 'toast-slide-in 0.25s ease-out',
                fontSize: typeScale.body,
                lineHeight: '20px',
                color: uiVars.text,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}>{style.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                aria-label="Dismiss"
                style={{
                  flexShrink: 0,
                  background: 'none',
                  border: 'none',
                  color: uiVars.textMuted,
                  cursor: 'pointer',
                  padding: 2,
                  marginTop: 1,
                  display: 'flex',
                }}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
