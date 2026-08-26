import { useState } from 'react'
import { createPortal } from 'react-dom'

export type StatusIconKind = 'check' | 'error' | 'clock' | 'mail' | 'lock' | 'selected' | 'shield' | 'bot'

export function StatusIcon({ kind, color, title, detail }: { kind: StatusIconKind; color: string; title: string; detail?: string }) {
  const paths: Record<StatusIconKind, string> = {
    check: 'M5 12l4 4L19 6',
    error: 'M12 8v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
    clock: 'M12 6v6l4 2M12 22a10 10 0 100-20 10 10 0 000 20z',
    mail: 'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm18 0l-9 6-9-6',
    lock: 'M5 11h14v9H5v-9zm3 0V7a4 4 0 018 0v4',
    selected: 'M9 12l2 2 4-4m1 11H6a2 2 0 01-2-2V7a2 2 0 012-2h3m4 0h3a2 2 0 012 2v9',
    shield: 'M12 3l7 3v5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6l7-3z',
    bot: 'M12 8a3 3 0 100 6 3 3 0 000-6zm-7 3h2m10 0h2M12 2v2',
  }
  const [open, setOpen] = useState(false)

  return (
    <>
      <span
        style={{ display: 'inline-flex', flexShrink: 0, cursor: 'help' }}
        aria-label={title}
        role="img"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d={paths[kind]} />
        </svg>
      </span>
      {open ? createPortal(
        <span
          className="mb-tip"
          role="tooltip"
          style={{
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            minWidth: 220,
            maxWidth: 'min(320px, calc(100vw - 32px))',
            padding: '10px 14px',
            background: 'var(--miniapp-surface)',
            border: '1px solid var(--miniapp-border)',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--miniapp-text-primary)',
            zIndex: 1000,
            pointerEvents: 'none',
            textAlign: 'center',
          }}
        >
          <span style={{ fontWeight: 600 }}>{title}</span>
          {detail ? <div style={{ color: 'var(--miniapp-text-secondary)', wordBreak: 'break-word' }}>{detail}</div> : null}
        </span>,
        document.body,
      ) : null}
    </>
  )
}
