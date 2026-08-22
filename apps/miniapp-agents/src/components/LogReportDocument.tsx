import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

export type ReportTone = 'good' | 'bad' | 'neutral' | 'info'

export interface LogReportAttempt {
  userId?: number | string
  label: string
  tone: ReportTone
  detail?: string
}

export interface LogReportEntry {
  no: string
  recipient: string
  recipientSub?: string
  statusLabel: string
  ok: boolean
  time?: string
  message?: string
}

export interface LogReportModel {
  dir: 'ltr' | 'rtl'
  kicker: string
  generatedAt: string
  title: string
  metaItems: string[]
  summary: Array<{ label: string; value: string; tone?: Extract<ReportTone, 'good' | 'bad' | 'neutral'> }>
  messagePreview?: string
  messageLabel?: string
  attemptsLabel?: string
  attempts?: LogReportAttempt[]
  attemptsMoreLabel?: string
  entriesCount: number
  entriesRangeLabel: (from: number, to: number) => string
  colNo: string
  colRecipient: string
  colStatus: string
  colTime: string
  entries: LogReportEntry[]
  footerLeft: string
  endMark: string
  pageOf: (page: number, total: number) => string
}

const INK = '#2a251e'
const TEXT = '#1a1612'
const SECONDARY = '#5a5248'
const MUTED = '#7d746a'
const HAIRLINE = '#e4ddd0'
const STRONG = '#b9ae99'
const PAPER = '#fffdf9'
const SAGE = '#5a7a5a'
const CLAY = '#9c4a35'
const SLATE = '#475977'
const SERIF = "var(--miniapp-serif, Georgia, serif)"
const SANS = "var(--miniapp-sans, sans-serif)"
const MONO = "var(--miniapp-mono, monospace)"

const PAGE_W = 794
const PAGE_H = 1123
const LEDGER_ROWS_PER_PAGE = 20

const TONE_COLOR: Record<ReportTone, string> = {
  good: SAGE,
  bad: CLAY,
  neutral: MUTED,
  info: SLATE,
}

function pageFrame(): CSSProperties {
  return {
    width: PAGE_W,
    height: PAGE_H,
    boxSizing: 'border-box',
    padding: '44px 48px',
    background: PAPER,
    color: TEXT,
    fontFamily: SANS,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  }
}

function PageFooter({ left, pageText }: { left: string; pageText?: string }) {
  return (
    <div style={{
      marginTop: 'auto', paddingTop: 10, borderTop: `1px solid ${HAIRLINE}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: 8.5, color: MUTED, letterSpacing: '0.6px', textTransform: 'uppercase',
    }}>
      <span>{left}</span>
      {pageText ? <span style={{ fontFamily: MONO }}>{pageText}</span> : null}
    </div>
  )
}

function Masthead({ model }: { model: LogReportModel }) {
  const title = model.title.length > 120 ? `${model.title.slice(0, 117)}...` : model.title
  return (
    <div style={{ borderBottom: `2.5px solid ${INK}`, paddingBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: CLAY }}>
          {model.kicker}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED }}>{model.generatedAt}</span>
      </div>
      <div style={{
        marginTop: 10, fontFamily: SERIF, fontSize: 26, lineHeight: 1.25, color: TEXT,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        wordBreak: 'break-word',
      }}>
        {title}
      </div>
      {model.metaItems.length > 0 ? (
        <div style={{ marginTop: 6, fontSize: 11, color: SECONDARY, letterSpacing: '0.3px' }}>
          {model.metaItems.filter(Boolean).join('  ·  ')}
        </div>
      ) : null}
    </div>
  )
}

function SummaryBand({ model }: { model: LogReportModel }) {
  if (model.summary.length === 0) return null
  return (
    <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: `repeat(${model.summary.length}, 1fr)`, border: `1px solid ${STRONG}` }}>
      {model.summary.map((s, i) => (
        <div key={i} style={{
          padding: '12px 16px',
          borderInlineStart: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
        }}>
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: MUTED }}>{s.label}</div>
          <div style={{ marginTop: 4, fontFamily: SERIF, fontSize: 22, lineHeight: 1.1, color: s.tone ? TONE_COLOR[s.tone] : TEXT }}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

function MessageBlock({ model }: { model: LogReportModel }) {
  if (!model.messagePreview) return null
  return (
    <div style={{ marginTop: 18, background: '#f4efe6', border: `1px solid ${HAIRLINE}`, padding: '12px 16px' }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: MUTED }}>
        {model.messageLabel}
      </div>
      <div style={{ marginTop: 6, fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, lineHeight: 1.55, color: SECONDARY, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        “{model.messagePreview}”
      </div>
    </div>
  )
}

function AttemptsBlock({ model }: { model: LogReportModel }) {
  const attempts = model.attempts || []
  if (!model.attemptsLabel || attempts.length === 0) return null
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${STRONG}`, paddingBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase', color: SECONDARY }}>{model.attemptsLabel}</span>
        {model.attemptsMoreLabel ? (
          <span style={{ fontSize: 9.5, color: MUTED }}>{model.attemptsMoreLabel}</span>
        ) : null}
      </div>
      {attempts.map((a, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '110px 150px 1fr', gap: 12, alignItems: 'baseline',
          padding: '6px 0', borderBottom: `1px solid ${HAIRLINE}`, fontSize: 10.5,
        }}>
          <span style={{ fontFamily: MONO, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.userId || '—'}</span>
          <span style={{ fontWeight: 700, color: TONE_COLOR[a.tone] }}>{a.label}</span>
          <span style={{ color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail || ''}</span>
        </div>
      ))}
    </div>
  )
}

function EntryRow({ entry, zebra }: { entry: LogReportEntry; zebra: boolean }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '38px minmax(0,1fr) 92px 108px', gap: 10, alignItems: 'start',
      minHeight: 46, padding: '7px 0', borderBottom: `1px solid ${HAIRLINE}`,
      background: zebra ? '#faf6ee' : 'transparent',
    }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED, paddingTop: 3 }}>{entry.no}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.recipient}
        </div>
        {entry.recipientSub ? (
          <div style={{ fontFamily: MONO, fontSize: 9, color: MUTED, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.recipientSub}
          </div>
        ) : null}
        {entry.message ? (
          <div style={{ fontSize: 10, color: SECONDARY, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.message}
          </div>
        ) : null}
      </div>
      <span style={{
        justifySelf: 'start', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase',
        color: entry.ok ? SAGE : CLAY, paddingTop: 3,
      }}>
        {entry.statusLabel}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: SECONDARY, textAlign: 'end', paddingTop: 3 }}>
        {entry.time || '—'}
      </span>
    </div>
  )
}

function LedgerPage({ model, from, to, pageIndex, totalPages }: {
  model: LogReportModel
  from: number
  to: number
  pageIndex: number
  totalPages: number
}) {
  const slice = model.entries.slice(from, to)
  return (
    <div data-report-page style={pageFrame()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${STRONG}`, paddingBottom: 5 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase', color: SECONDARY }}>
          {trimTitle(model.title)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 9, color: MUTED }}>
          {model.entriesRangeLabel(from + 1, Math.min(to, model.entries.length))}
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '38px minmax(0,1fr) 92px 108px', gap: 10,
        marginTop: 12, paddingBottom: 6,
        borderTop: `2px solid ${INK}`, borderBottom: `1px solid ${INK}`,
      }}>
        {[model.colNo, model.colRecipient, model.colStatus, model.colTime].map((label, i) => (
          <span key={i} style={{
            fontSize: 8.5, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase',
            color: MUTED, textAlign: i === 3 ? 'end' : 'start',
          }}>
            {label}
          </span>
        ))}
      </div>

      <div>
        {slice.map((e, i) => (
          <EntryRow key={e.no} entry={e} zebra={i % 2 === 1} />
        ))}
      </div>

      {pageIndex === totalPages - 1 ? (
        <div style={{ marginTop: 18, textAlign: 'center' }}>
          <span style={{ fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: MUTED }}>
            — {model.endMark} —
          </span>
        </div>
      ) : null}

      <PageFooter left={model.footerLeft} pageText={model.pageOf(pageIndex + 1, totalPages)} />
    </div>
  )
}

function trimTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 37)}...` : title
}

export function LogReportDocument({ model, onReady }: { model: LogReportModel; onReady?: () => void }) {
  const calledRef = useRef(false)
  useEffect(() => {
    if (!calledRef.current) {
      calledRef.current = true
      onReady?.()
    }
  }, [onReady])

  const ledgerPages = Math.max(1, Math.ceil(model.entries.length / LEDGER_ROWS_PER_PAGE))
  const totalPages = 1 + ledgerPages

  return (
    <div dir={model.dir} style={{ width: PAGE_W, background: PAPER }}>
      {/* Cover / summary page */}
      <div data-report-page style={pageFrame()}>
        <Masthead model={model} />
        <SummaryBand model={model} />
        <MessageBlock model={model} />
        <AttemptsBlock model={model} />
        {model.entries.length === 0 ? (
          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <span style={{ fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: MUTED }}>
              — {model.endMark} —
            </span>
          </div>
        ) : null}
        <PageFooter left={model.footerLeft} />
      </div>

      {/* Ledger pages */}
      {Array.from({ length: ledgerPages }, (_, p) => (
        <LedgerPage
          key={p}
          model={model}
          from={p * LEDGER_ROWS_PER_PAGE}
          to={(p + 1) * LEDGER_ROWS_PER_PAGE}
          pageIndex={p + 1}
          totalPages={totalPages}
        />
      ))}
    </div>
  )
}
