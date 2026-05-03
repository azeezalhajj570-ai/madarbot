import { useEffect, useMemo, useState } from 'react'

import { GroupAnalysisPage } from './components/GroupAnalysisPage'

import {
  agentsApi,
  AppShell,
  Button,
  Card,
  Grid,
  InputField,
  LinkRow,
  Note,
  SelectField,
  TextAreaField,
  useMiniappSession,
} from '@miniapp/shared'
import type {
  Agent,
  AgentAnalytics,
  AgentGroupMember,
  AgentGroupMemberMessage,
  AgentLead,
  AgentLeadPage,
  AgentLeadStats,
  AgentManagedGroup,
  AgentNotification,
  AutomationTask,
  TaskCatalogItem,
} from '@miniapp/shared'

type AgentsPage = 'dashboard' | 'tasks' | 'groups' | 'settings'
type WizardStep = 'code' | 'password' | 'finish'
type TaskDestinationMode = 'group' | 'text'
type SelectedGroupChip = {
  tg_group_id: number
  title: string
}

const LINK_ACCOUNT_STEPS: WizardStep[] = ['code', 'password', 'finish']
const PHONE_INPUT_PATTERN = /^[+\d\s().-]+$/
const REGULAR_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/
const PHONE_NUMBER_FORMAT_MESSAGE = 'Enter a valid phone number in international format, for example +15551234567'
const SCRAPE_LIMIT_MAX = 50000
const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'
const BULK_MESSAGE_TASK_META: TaskCatalogItem = {
  key: BULK_MESSAGE_TASK_KEY,
  title: 'Bulk message',
  description: 'Queue a worker job that sends a controlled bulk message through this linked agent.',
  executor_types: ['agent'],
}

interface SubscriptionStatusInfo {
  status: 'active' | 'inactive'
  plan: 'pro' | 'business' | null
  expires_at: string | null
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const styles: Record<string, React.CSSProperties> = {
    neutral: { background: 'var(--miniapp-bg-deep)', color: 'var(--miniapp-text-muted)' },
    success: { background: 'var(--miniapp-sage-dim)', color: 'var(--miniapp-sage)', border: '1px solid var(--miniapp-sage-border)' },
    warning: { background: 'var(--miniapp-ochre-dim)', color: 'var(--miniapp-ochre)', border: '1px solid var(--miniapp-ochre-border)' },
  }
  return (
    <span style={{
      ...styles[tone],
      padding: '3px 8px',
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
    }}>
      {children}
    </span>
  )
}

function SubscriptionForm({
  status,
  onRedeemed,
}: {
  status: SubscriptionStatusInfo | null
  onRedeemed: (info: SubscriptionStatusInfo) => void
}) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkoutPlan, setCheckoutPlan] = useState<'pro' | 'business' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleRedeem() {
    if (!code.trim() || loading) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await agentsApi.redeemPromoCode(code)
      setSuccess(result.message)
      setCode('')
      onRedeemed({
        status: result.status as 'active' | 'inactive',
        plan: result.plan as 'pro' | 'business' | null,
        expires_at: result.expires_at,
      })
    } catch (err: any) {
      setError(err.message || 'Failed to redeem code')
    } finally {
      setLoading(false)
    }
  }

  async function handleStripeCheckout(plan: 'pro' | 'business') {
    if (checkoutPlan) return
    setCheckoutPlan(plan)
    setError(null)
    setSuccess(null)
    try {
      const data = await agentsApi.createSubscriptionCheckout(plan, window.location.href, window.location.href)
      if (!data.url) {
        throw new Error('Checkout session was not created')
      }
      const webapp = (window as any).Telegram?.WebApp
      if (webapp?.openLink) {
        webapp.openLink(data.url)
      } else {
        window.open(data.url, '_blank')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start Stripe checkout')
    } finally {
      setCheckoutPlan(null)
    }
  }

  const isActive = status?.status === 'active'
  const expiryDate = status?.expires_at ? new Date(status.expires_at) : null
  const isLifetime = isActive && !expiryDate

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600 }}>Current Plan</span>
          <Badge tone={isActive ? 'success' : 'neutral'}>
            {isActive ? (isLifetime ? 'Lifetime' : 'Active') : 'No active subscription'}
          </Badge>
        </div>
        {isActive && expiryDate && (
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)' }}>
            Valid until {expiryDate.toLocaleDateString()} {expiryDate.toLocaleTimeString()}
          </div>
        )}
        {!isActive && (
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)' }}>
            Redeem a promotion code to unlock agent features.
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <InputField
          label="Redeem promotion code"
          value={code}
          onChange={(val) => setCode(val.toUpperCase())}
          placeholder="PROMO-CODE"
        />
        {error && <Note tone="warning">{error}</Note>}
        {success && <Note>{success}</Note>}
        <Button onClick={() => void handleRedeem()} disabled={loading || !code.trim()}>
          {loading ? 'Redeeming...' : 'Redeem code'}
        </Button>
      </div>

      {!isActive && (
        <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text)' }}>Or pay with Stripe:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { plan: 'pro', label: 'Pro', price: '$29', desc: '/month', days: 30 },
              { plan: 'business', label: 'Business', price: '$79', desc: '/month', days: 30 },
            ].map((p) => (
              <button
                key={p.plan}
                onClick={() => void handleStripeCheckout(p.plan as 'pro' | 'business')}
                disabled={checkoutPlan !== null}
                style={{
                  padding: '12px', borderRadius: 12, border: '1px solid var(--miniapp-border)',
                  background: 'var(--miniapp-bg)', textAlign: 'center', cursor: checkoutPlan ? 'wait' : 'pointer', color: 'var(--miniapp-text)',
                  opacity: checkoutPlan && checkoutPlan !== p.plan ? 0.65 : 1,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700 }}>{p.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--miniapp-primary)', margin: '4px 0' }}>
                  {checkoutPlan === p.plan ? 'Opening...' : p.price}
                </div>
                <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 13, color: 'var(--miniapp-text-secondary)', display: 'grid', gap: 8 }}>
        <strong>Subscribing gives you access to:</strong>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
          <li>Linking multiple Telegram accounts as agents</li>
          <li>Running background member scraping jobs</li>
          <li>Automated broadcasts and member messaging</li>
          <li>Real-time agent notifications</li>
        </ul>
      </div>
    </div>
  )
}

function SubscriptionSheet({
  open,
  onClose,
  status,
  onRedeemed,
}: {
  open: boolean
  onClose: () => void
  status: SubscriptionStatusInfo | null
  onRedeemed: (info: SubscriptionStatusInfo) => void
}) {
  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(32, 25, 16, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 1100,
      }}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20,
          padding: 24,
          display: 'grid',
          gap: 20,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 22 }}>Subscription</h2>
          <Button tone="secondary" onClick={onClose}>Close</Button>
        </div>

        <SubscriptionForm status={status} onRedeemed={onRedeemed} />
      </div>
    </div>
  )
}

function NotificationSheet({
  open,
  account,
  onUnseenCountChange,
  onClose,
}: {
  open: boolean
  account: Agent | null
  onUnseenCountChange: (count: number) => void
  onClose: () => void
}) {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMarkingSeen, setIsMarkingSeen] = useState(false)

  async function refresh() {
    if (!account) return
    setLoading(true)
    try {
      const payload = await agentsApi.fetchAgentNotifications(account.id, 100)
      setNotifications(payload.items)
      onUnseenCountChange(payload.unseen_count)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && account) {
      void refresh()
    }
  }, [open, account?.id])

  async function markAllSeen() {
    if (!account) return
    setIsMarkingSeen(true)
    try {
      await agentsApi.markAgentNotificationsSeen(account.id)
      await refresh()
    } finally {
      setIsMarkingSeen(false)
    }
  }

  if (!open) return null

  const visibleNotifications = notifications.filter((notification) => !notification.is_seen)

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(32, 25, 16, 0.55)',
        display: 'grid', placeItems: 'center',
        padding: 16, zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 100%)',
          maxHeight: '85vh', overflow: 'auto',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20, padding: 24,
          display: 'grid', gap: 16,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>Notifications</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button tone="secondary" onClick={() => void markAllSeen()} disabled={isMarkingSeen || loading}>Mark seen</Button>
            <Button tone="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
        {status ? <Note>{status}</Note> : null}
        <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
        {loading ? <Note>Loading notifications...</Note> : null}
        {!loading && visibleNotifications.length === 0 ? <Note>No unseen notifications.</Note> : null}
        <div style={{ display: 'grid', gap: 8 }}>
          {visibleNotifications.map((notification) => {
            const tone = notificationTone(notification.kind)
            const chips = notificationChips(notification)
            return (
              <div
                key={notification.id}
                style={{
                  display: 'grid', gap: 10, padding: 14,
                  border: `1px solid ${tone.border}`, borderRadius: 14,
                  background: tone.background,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      padding: '4px 8px', borderRadius: 999, background: tone.badge,
                      color: tone.accent, fontSize: 11, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap',
                    }}>
                      {notificationKindLabel(notification.kind)}
                    </span>
                    <span style={{ color: 'var(--miniapp-coral)', fontSize: 12, fontWeight: 700 }}>NEW</span>
                  </div>
                  <div style={{ color: '#7d746a', fontSize: 12, whiteSpace: 'nowrap' }}>{notificationTimeLabel(notification.created_at)}</div>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 15 }}>{notification.title}</strong>
                  <div style={{ color: '#655d52', lineHeight: 1.45 }}>{notification.body}</div>
                </div>
                {chips.length ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {chips.map((chip) => (
                      <span key={chip} style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '5px 9px', borderRadius: 999,
                        background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)',
                        color: '#655d52', fontSize: 12,
                      }}>
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function parseAgentsRoute(pathname: string, basePath: string) {
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  const stripped = pathname.startsWith(normalizedBase) ? pathname.slice(normalizedBase.length) : pathname
  const segments = stripped.split('/').filter(Boolean)
  if (segments[0] !== 'accounts') {
    return { accountId: null, page: 'settings' as AgentsPage }
  }

  const accountId = segments[1] ? Number(segments[1]) : null
  const rawPage = segments[2] || 'settings'

  const pageMap: Record<string, AgentsPage> = {
    accounts: 'settings',
    analytics: 'dashboard',
    analysis: 'dashboard',
    notifications: 'dashboard',
    scraping: 'tasks',
    tasks: 'tasks',
    leads: 'groups',
    groups: 'groups',
    settings: 'settings',
    dashboard: 'dashboard',
  }

  const page = pageMap[rawPage] || 'groups'

  return {
    accountId: Number.isFinite(accountId) ? accountId : null,
    page: accountId ? page : 'settings',
  }
}

function accountPath(accountId: number | null, page: AgentsPage) {
  if (!accountId || page === 'settings') {
    return '/accounts'
  }
  return `/accounts/${accountId}/${page}`
}

function normalizePhoneNumberInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed || !PHONE_INPUT_PATTERN.test(trimmed)) {
    return trimmed
  }
  const digits = trimmed.replace(/\D/g, '')
  return trimmed.startsWith('+') && digits ? `+${digits}` : trimmed
}

function isRegularPhoneNumber(value: string) {
  return REGULAR_PHONE_PATTERN.test(normalizePhoneNumberInput(value))
}

function clampScrapeLimit(value: string) {
  return Math.max(1, Math.min(Number(value) || SCRAPE_LIMIT_MAX, SCRAPE_LIMIT_MAX))
}

function accountLabel(account: Agent) {
  const displayName = typeof account.metadata?.display_name === 'string' ? account.metadata.display_name : ''
  return displayName || account.external_account_id
}

function taskTitle(task: AutomationTask, catalog: TaskCatalogItem[]) {
  return catalog.find((item) => item.key === task.task_key)?.title || task.task_key.replace(/_/g, ' ')
}

function taskConditionLabel(task: AutomationTask) {
  const keyword = String(task.conditions.text_contains || '').trim()
  return keyword ? `When message contains: ${keyword}` : 'No keyword condition'
}

function taskConfigLabel(task: AutomationTask) {
  if (task.task_key === 'notify_destination') {
    const destination = String(task.config.destination || '').trim() || 'No destination'
    const delivery = String(task.config.delivery_mode || 'text')
    return `${destination} · ${delivery}`
  }
  const template = String(task.config.message_template || '').trim()
  const summary = template ? template : 'No message template'
  const mode = task.config.reply_mode === 'private' ? ' · private' : ''
  return `${summary}${mode}`
}

function notificationTimeLabel(createdAt?: string | null) {
  if (!createdAt) {
    return 'Unknown time'
  }
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString()
}

function notificationTone(kind: string) {
  if (kind.includes('failed')) {
    return {
      background: 'rgba(161, 87, 62, 0.08)',
      border: 'rgba(161, 87, 62, 0.16)',
      accent: 'var(--miniapp-clay)',
      badge: 'rgba(161, 87, 62, 0.12)',
    }
  }
  if (kind.includes('completed') || kind.includes('queued')) {
    return {
      background: 'rgba(54, 102, 78, 0.08)',
      border: 'rgba(54, 102, 78, 0.16)',
      accent: '#36664e',
      badge: 'rgba(54, 102, 78, 0.12)',
    }
  }
  return {
    background: 'rgba(71, 89, 119, 0.08)',
    border: 'rgba(71, 89, 119, 0.16)',
    accent: '#475977',
    badge: 'rgba(71, 89, 119, 0.12)',
  }
}

function notificationKindLabel(kind: string) {
  if (kind.startsWith('bulk_message')) return 'Bulk message'
  if (kind.startsWith('scrape')) return 'Scrape'
  if (kind.startsWith('task')) return 'Task'
  if (kind === 'job_queued') return 'Queued'
  if (kind === 'job_failed') return 'Job failed'
  return kind.replace(/_/g, ' ')
}

function notificationChips(notification: AgentNotification) {
  const payload = notification.payload || {}
  const chips: string[] = []
  const groupTitle = typeof payload.group_title === 'string' ? payload.group_title.trim() : ''
  const sourceGroupTitle = typeof payload.source_group_title === 'string' ? payload.source_group_title.trim() : ''
  const taskLabel = typeof payload.task_label === 'string' ? payload.task_label.trim() : ''
  const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : ''
  const destination = typeof payload.destination === 'string' ? payload.destination.trim() : ''
  const selectedCount = typeof payload.selected_count === 'number' ? payload.selected_count : null
  const sentCount = typeof payload.sent_count === 'number' ? payload.sent_count : null
  const attemptedCount = typeof payload.attempted_count === 'number' ? payload.attempted_count : null
  const failedCount = typeof payload.failed_count === 'number' ? payload.failed_count : null
  const membersCount = typeof payload.members_count === 'number' ? payload.members_count : null
  const messagesCount = typeof payload.messages_count === 'number' ? payload.messages_count : null

  if (taskLabel) chips.push(taskLabel)
  if (sourceGroupTitle) chips.push(sourceGroupTitle)
  else if (groupTitle) chips.push(groupTitle)
  if (keyword) chips.push(`Keyword: ${keyword}`)
  if (destination) chips.push(`To: ${destination}`)
  if (selectedCount && notification.kind === 'job_queued') chips.push(`${selectedCount} selected`)
  if (attemptedCount && notification.kind === 'bulk_message_completed') chips.push(`${attemptedCount} attempted`)
  if (sentCount) chips.push(`${sentCount} sent`)
  if (failedCount) chips.push(`${failedCount} failed`)
  if (membersCount && notification.kind.startsWith('scrape')) chips.push(`${membersCount} members`)
  if (messagesCount && notification.kind.startsWith('scrape')) chips.push(`${messagesCount} messages`)

  return chips.slice(0, 4)
}

function mapTaskGroups(task: AutomationTask) {
  const tgGroupIds = Array.isArray(task.group_tg_ids) ? task.group_tg_ids : []
  const titles = Array.isArray(task.group_titles) ? task.group_titles : []
  return tgGroupIds.map((tgGroupId, index) => ({
    tg_group_id: Number(tgGroupId),
    title: String(titles[index] || `Group ${tgGroupId}`),
  }))
}

function FormActions({
  submitLabel,
  onSubmit,
  onCancel,
  submitDisabled = false,
  cancelDisabled = false,
}: {
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
  submitDisabled?: boolean
  cancelDisabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
      <Button tone="secondary" onClick={onCancel} disabled={cancelDisabled}>Cancel</Button>
    </div>
  )
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  isBusy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  isBusy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(32, 25, 16, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20,
          padding: 20,
          display: 'grid',
          gap: 12,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>{title}</div>
        <Note>{message}</Note>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button tone="secondary" onClick={onCancel} disabled={isBusy}>Cancel</Button>
          <Button tone="danger" onClick={onConfirm} disabled={isBusy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

function GroupAutocompleteField({
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
  const selectedIds = useMemo(() => new Set(selectedGroups.map((group) => group.tg_group_id)), [selectedGroups])
  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!normalizedQuery) {
      return []
    }
    return groups.filter((group) => {
      const tgGroupId = Number(group.tg_group_id || 0)
      if (!tgGroupId || selectedIds.has(tgGroupId)) {
        return false
      }
      return [group.title || '', String(group.tg_group_id || '')].some((value) => value.toLowerCase().includes(normalizedQuery))
    }).slice(0, 8)
  }, [groups, normalizedQuery, selectedIds])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <InputField label={label} value={query} onChange={onQueryChange} placeholder={placeholder} />
      {normalizedQuery ? (
        <div
          style={{
            display: 'grid',
            gap: 6,
            padding: 8,
            border: '1px solid var(--miniapp-border-soft)',
            borderRadius: 12,
            background: 'var(--miniapp-bg)',
          }}
        >
          {suggestions.length ? suggestions.map((group) => (
            <LinkRow
              key={String(group.tg_group_id)}
              onClick={() => onAdd({
                tg_group_id: Number(group.tg_group_id),
                title: String(group.title || group.tg_group_id || 'Group'),
              })}
            >
              <strong>{group.title || `Group ${group.tg_group_id}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id}</div>
            </LinkRow>
          )) : <Note>No matching groups found.</Note>}
        </div>
      ) : (
        <Note>Search to find visible groups.</Note>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {selectedGroups.length ? selectedGroups.map((group) => (
          <span
            key={group.tg_group_id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 999,
              border: '1px solid var(--miniapp-border-soft)',
              background: 'var(--miniapp-bg)',
              fontSize: 12.5,
            }}
          >
            {group.title}
            <button
              type="button"
              onClick={() => onRemove(group.tg_group_id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--miniapp-clay)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        )) : <Note>No groups selected.</Note>}
      </div>
    </div>
  )
}

function GroupDestinationField({
  label,
  query,
  onQueryChange,
  groups,
  selectedGroup,
  onSelect,
  onClear,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  selectedGroup: SelectedGroupChip | null
  onSelect: (group: SelectedGroupChip) => void
  onClear: () => void
}) {
  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!normalizedQuery) {
      return []
    }
    return groups.filter((group) =>
      [group.title || '', String(group.tg_group_id || '')].some((value) => value.toLowerCase().includes(normalizedQuery)),
    ).slice(0, 8)
  }, [groups, normalizedQuery])

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <InputField label={label} value={query} onChange={onQueryChange} placeholder="Search destination group" />
      {normalizedQuery ? (
        <div
          style={{
            display: 'grid',
            gap: 6,
            padding: 8,
            border: '1px solid var(--miniapp-border-soft)',
            borderRadius: 12,
            background: 'var(--miniapp-bg)',
          }}
        >
          {suggestions.length ? suggestions.map((group) => (
            <LinkRow
              key={String(group.tg_group_id)}
              onClick={() => onSelect({
                tg_group_id: Number(group.tg_group_id),
                title: String(group.title || group.tg_group_id || 'Group'),
              })}
            >
              <strong>{group.title || `Group ${group.tg_group_id}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>{group.tg_group_id}</div>
            </LinkRow>
          )) : <Note>No matching groups found.</Note>}
        </div>
      ) : (
        <Note>Search to find a destination group.</Note>
      )}
      {selectedGroup ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Note>{selectedGroup.title} · {selectedGroup.tg_group_id}</Note>
          <Button tone="secondary" onClick={onClear}>Clear</Button>
        </div>
      ) : null}
    </div>
  )
}

function DismissibleStatus({
  message,
  onClose,
}: {
  message: string
  onClose: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        border: '1px solid var(--miniapp-border-soft)',
        borderRadius: 12,
        background: 'var(--miniapp-surface)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{message}</div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onClose}
        style={{
          border: 'none',
          background: 'transparent',
          color: 'var(--miniapp-clay)',
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

function NoAccountNotice({ onLink }: { onLink: () => void }) {
  return (
    <Card title="Account required" subtitle="An active linked account is required to use this page.">
      <Note tone="warning">
        You haven't linked any Telegram accounts yet, or your selected account is not fully authenticated.
      </Note>
      <div style={{ marginTop: 14 }}>
        <Button onClick={onLink}>Go to Accounts</Button>
      </div>
    </Card>
  )
}

function LinkedAccountCard({
  account,
  onOpen,
  onResume,
  onDelete,
  onStatus,
}: {
  account: Agent
  onOpen: () => void
  onResume: () => void
  onDelete: () => void
  onStatus: (msg: string) => void
}) {
  const [isSyncing, setIsSyncing] = useState(false)
  const isActive = account.auth_state === 'active' && account.status === 'active'

  async function syncWorkspace() {
    setIsSyncing(true)
    onStatus(`Syncing ${accountLabel(account)} workspace from Telegram...`)
    try {
      await agentsApi.syncAgentWorkspace(account.id)
      onStatus(`Workspace sync finished for ${accountLabel(account)}.`)
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Failed to sync workspace')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: 14,
        border: '1px solid var(--miniapp-border-soft)',
        borderRadius: 12,
        background: 'var(--miniapp-surface)',
      }}
    >
      <div>
        <strong>{account.phone_number || accountLabel(account)}</strong>
        <div style={{ color: '#655d52', marginTop: 4 }}>
          {accountLabel(account) ? `${accountLabel(account)} · ` : ''}status {account.status} · auth {account.auth_state}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isActive ? (
          <>
            <Button onClick={onOpen}>Open workspace</Button>
            <Button tone="secondary" onClick={() => void syncWorkspace()} disabled={isSyncing}>
              {isSyncing ? 'Syncing...' : 'Sync'}
            </Button>
          </>
        ) : (
          <Button onClick={onResume}>Resume setup</Button>
        )}
        <Button tone="danger" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}

function BottomNav({ currentPage, onNavigate }: { currentPage: AgentsPage; onNavigate: (page: AgentsPage) => void }) {
  const tabs: { id: AgentsPage; label: string; icon: React.ReactNode }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      ),
    },
    {
      id: 'tasks',
      label: 'Tasks',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'groups',
      label: 'Groups',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M16 14.5a3 3 0 013 3v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ]

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200 }}>
      <nav
        style={{
          maxWidth: 860,
          margin: '0 auto',
          background: 'rgba(245,240,232,0.94)',
          backdropFilter: 'blur(28px) saturate(180%)',
          borderTop: '1px solid var(--miniapp-border-soft)',
          padding: '8px 8px calc(8px + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === currentPage
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '6px 14px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: isActive ? 'var(--miniapp-coral)' : 'var(--miniapp-text-muted)',
                fontFamily: 'var(--miniapp-sans)',
                transition: 'color .2s',
              }}
            >
              {tab.icon}
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, lineHeight: 1, letterSpacing: '0.2px' }}>{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default function App() {
  const basePath = import.meta.env.BASE_URL
  const session = useMiniappSession()
  const [route, setRoute] = useState(() => parseAgentsRoute(window.location.pathname, basePath))
  const [accounts, setAccounts] = useState<Agent[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [accountName, setAccountName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardAccountId, setWizardAccountId] = useState<number | null>(null)
  const [wizardStep, setWizardStep] = useState<WizardStep>('code')

  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [unseenNotifications, setUnseenNotifications] = useState(0)
  const [subscription, setSubscription] = useState<SubscriptionStatusInfo | null>(null)
  const [showSubscription, setShowSubscription] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const effectiveGroupId = session.selectedGroupId ?? session.groups[0]?.id ?? null

  useEffect(() => {
    const onPopState = () => setRoute(parseAgentsRoute(window.location.pathname, basePath))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [basePath])

  async function refresh() {
    if (!session.identity) {
      setAccounts([])
      setSubscription(null)
      setAccountsLoading(false)
      return
    }

    setAccountsLoading(true)
    try {
      const [accs, sub] = await Promise.all([
        agentsApi.fetchAgents(),
        agentsApi.fetchSubscriptionStatus(),
      ])
      setAccounts(accs)
      setSubscription(sub)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to refresh data')
    } finally {
      setAccountsLoading(false)
    }
  }

  useEffect(() => {
    if (session.loading) {
      return
    }
    void refresh()
  }, [session.loading, session.identity?.user.id, effectiveGroupId])

  function navigate(nextPath: string) {
    const target = `${basePath.replace(/\/$/, '')}${nextPath}`
    window.history.pushState({}, '', target)
    setRoute(parseAgentsRoute(window.location.pathname, basePath))
  }

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.auth_state === 'active' && account.status === 'active'),
    [accounts],
  )
  const defaultWorkspaceAccount = activeAccounts[0] ?? accounts[0] ?? null
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === route.accountId) ?? defaultWorkspaceAccount,
    [accounts, defaultWorkspaceAccount, route.accountId],
  )
  const hasAccounts = accounts.length > 0
  const wizardAccount = useMemo(
    () => accounts.find((account) => account.id === wizardAccountId) ?? null,
    [accounts, wizardAccountId],
  )
  const isWizardInProgress = isWizardOpen

  const isAuthenticated = Boolean(session.identity)
  const appReady = !session.loading && !accountsLoading

  useEffect(() => {
    if (!appReady || isWizardInProgress || !selectedAccount) {
      setUnseenNotifications(0)
      return
    }
    if (selectedAccount.auth_state === 'active' && selectedAccount.status === 'active') {
      void agentsApi.fetchAgentNotifications(selectedAccount.id, 50)
        .then((payload) => setUnseenNotifications(payload.unseen_count))
        .catch(() => setUnseenNotifications(0))
    } else {
      setUnseenNotifications(0)
    }
  }, [appReady, selectedAccount, isWizardInProgress])

  function handleTabNavigate(page: AgentsPage) {
    const targetPath = page === 'settings' || !selectedAccount?.id
      ? '/accounts'
      : accountPath(selectedAccount.id, page)
    navigate(targetPath)
  }

  function openCreateWizard() {
    setStatus(null)
    setAccountName('')
    setPhoneNumber('')
    setWizardAccountId(null)
    setWizardStep('code')
    setIsWizardOpen(true)
  }

  function closeWizard() {
    setIsWizardOpen(false)
    setWizardAccountId(null)
    setWizardStep('code')
    setAccountName('')
    setPhoneNumber('')
  }

  async function linkAndStartAuth() {
    const normalizedPhone = normalizePhoneNumberInput(phoneNumber)
    if (!normalizedPhone) {
      setStatus('Phone number is required')
      return
    }
    if (!isRegularPhoneNumber(normalizedPhone)) {
      setStatus('Enter a valid international phone number, e.g. +966501234567')
      return
    }

    setIsCreatingAccount(true)
    try {
      const response = await agentsApi.linkAgent(effectiveGroupId, {
        name: accountName.trim() || 'Agent',
        phone_number: normalizedPhone,
      }) as { agent: Agent }
      const agentId = response.agent.id
      setWizardAccountId(agentId)
      setPhoneNumber(response.agent.phone_number || normalizedPhone)

      const authResponse = await agentsApi.startAgentAuth(effectiveGroupId, normalizedPhone, agentId) as { agent: Agent }
      setStatus(authResponse.agent.auth_state === 'active' ? 'Account already authenticated' : 'Confirmation code sent to Telegram')
      await refresh()

      if (authResponse.agent.auth_state === 'pending_2fa') {
        setWizardStep('password')
      } else {
        setWizardStep('code')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to link account')
    } finally {
      setIsCreatingAccount(false)
    }
  }

  function openWorkspace(accountId: number) {
    setIsWizardOpen(false)
    setWizardAccountId(null)
    setWizardStep('finish')
    navigate(accountPath(accountId, 'groups'))
  }

  async function confirmDeleteAccount() {
    if (!deleteTarget) {
      return
    }
    setIsDeleting(true)
    try {
      await agentsApi.deleteAgent(deleteTarget.id)
      setStatus('Account deleted')
      if (route.accountId === deleteTarget.id) {
        navigate('/accounts')
      }
      setDeleteTarget(null)
      await refresh()
    } finally {
      setIsDeleting(false)
    }
  }

  const headerSubtitle = useMemo(() => {
    const label = selectedAccount
      ? `${selectedAccount.phone_number || accountLabel(selectedAccount)}`
      : ''
    if (subscription?.status === 'active') {
      const planLabel = subscription.plan === 'business' ? 'Business' : 'Pro'
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          <Badge tone="success">{planLabel}</Badge>
          {subscription.plan === 'pro' && (
            <button
              onClick={() => setShowSubscription(true)}
              style={{
                background: 'var(--miniapp-bg-deep)',
                border: '1px solid var(--miniapp-border-soft)',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--miniapp-text-primary)',
                cursor: 'pointer',
              }}
            >
              Upgrade
            </button>
          )}
        </div>
      )
    }
    return label
  }, [selectedAccount, subscription])

  return (
    <AppShell title="MadarAppBot" subtitle={headerSubtitle} actions={
      <button
        type="button"
        onClick={() => setShowNotifications(true)}
        style={{
          position: 'relative',
          width: 36, height: 36, borderRadius: 10,
          border: '1px solid var(--miniapp-border-soft)',
          background: 'var(--miniapp-surface)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: unseenNotifications ? 'var(--miniapp-coral)' : 'var(--miniapp-text-muted)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseenNotifications > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 18, height: 18, borderRadius: 9,
            background: 'var(--miniapp-coral)', color: '#fff',
            fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px',
          }}>
            {unseenNotifications > 99 ? '99+' : unseenNotifications}
          </span>
        )}
      </button>
    }>
      <Grid>
        {status ? <DismissibleStatus message={status} onClose={() => setStatus(null)} /> : null}
        {session.error ? <Note tone="warning">{session.error}</Note> : null}
        {!appReady ? (
          <Card title="Loading" subtitle="Preparing accounts, groups, and agent tools.">
            <Note>Please wait while the miniapp loads your workspace.</Note>
          </Card>
        ) : null}
        {appReady && !isAuthenticated ? (
          <Card title="Authentication required" subtitle="Open this WebApp from Telegram to load your agent workspace.">
            <Note tone="warning">{session.error || 'Telegram authentication is unavailable.'}</Note>
          </Card>
        ) : null}
        {appReady && isAuthenticated && isWizardInProgress ? (
          <RegistrationWizard
            account={wizardAccount}
            step={wizardStep}
            phoneNumber={phoneNumber}
            onPhoneNumberChange={setPhoneNumber}
            onLinkAccount={() => void linkAndStartAuth()}
            isLinking={isCreatingAccount}
            onSaved={setStatus}
            onRefresh={refresh}
            onStepChange={setWizardStep}
            onCancel={closeWizard}
            onOpenWorkspace={openWorkspace}
          />
        ) : null}
        {appReady && isAuthenticated && !isWizardInProgress && route.page === 'settings' ? (
          <>
            {subscription?.status !== 'active' ? (
              <Card title="Subscription Required" subtitle="Activate your access to use agent features.">
                <SubscriptionForm
                  status={subscription}
                  onRedeemed={(info) => {
                    setSubscription(info)
                    void refresh()
                  }}
                />
              </Card>
            ) : (
              <>
                <Card title="Linked accounts" subtitle="Manage your linked Telegram agents and their authentication status.">
                  <div style={{ display: 'grid', gap: 8 }}>
                    {accounts.length ? accounts.map((account) => (
                      <LinkedAccountCard
                        key={account.id}
                        account={account}
                        onOpen={() => navigate(accountPath(account.id, 'groups'))}
                        onStatus={setStatus}
                        onDelete={() => setDeleteTarget(account)}
                        onResume={() => {
                          setIsWizardOpen(true)
                          setWizardAccountId(account.id)
                          setPhoneNumber(account.phone_number || '')
                          if (account.auth_state === 'pending_2fa') {
                            setWizardStep('password')
                          } else {
                            setWizardStep('code')
                          }
                        }}
                      />
                    )) : <Note>No linked accounts yet. Link an account to start using agent tools.</Note>}
                  </div>
                </Card>
                <Card title="Link new account">
                  {subscription?.plan === 'pro' && accounts.length >= 1 ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <Note tone="warning">
                        Your Pro plan allows linking up to 1 account. Upgrade to Business to link more accounts.
                      </Note>
                      <Button onClick={() => setShowSubscription(true)}>Upgrade Plan</Button>
                    </div>
                  ) : (
                    <CreateAccountPanel
                      onOpen={openCreateWizard}
                    />
                  )}
                </Card>
              </>
            )}
          </>
        ) : null}
        {appReady && isAuthenticated && !isWizardInProgress && route.page !== 'settings' ? (
          selectedAccount && selectedAccount.auth_state === 'active' && selectedAccount.status === 'active' ? (
            <>
              {route.page === 'dashboard' ? (
                <>
                  <AccountAnalyticsPage account={selectedAccount} />
                  {subscription?.plan === 'business' ? (
                    <GroupAnalysisPage account={selectedAccount} />
                  ) : null}
                </>
              ) : null}
              {route.page === 'tasks' ? (
                <>
                  <AccountTasksPage account={selectedAccount} onSaved={setStatus} />
                  {subscription?.plan === 'business' ? (
                    <AccountScrapingPage
                      account={selectedAccount}
                      onSaved={(msg) => setStatus(msg)}
                    />
                  ) : null}
                </>
              ) : null}
              {route.page === 'groups' ? (
                <>
                  <AccountGroupsPage account={selectedAccount} />
                  <AccountLeadsPage account={selectedAccount} />
                </>
              ) : null}
            </>
          ) : (
            <NoAccountNotice onLink={() => navigate('/accounts')} />
          )
        ) : null}
      </Grid>

      <BottomNav currentPage={route.page} onNavigate={handleTabNavigate} />

      <SubscriptionSheet
        open={showSubscription}
        onClose={() => setShowSubscription(false)}
        status={subscription}
        onRedeemed={(info) => {
          setSubscription(info)
          void refresh()
        }}
      />
      <NotificationSheet
        open={showNotifications}
        account={selectedAccount}
        onUnseenCountChange={setUnseenNotifications}
        onClose={() => setShowNotifications(false)}
      />
      {deleteTarget ? (
        <ConfirmModal
          title="Delete account"
          message={`Delete ${accountLabel(deleteTarget)}? This removes the linked account from this workspace.`}
          confirmLabel="Delete"
          isBusy={isDeleting}
          onConfirm={() => void confirmDeleteAccount()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </AppShell>
  )
}

function CreateAccountPanel({
  onOpen,
  disabled = false,
}: {
  onOpen: () => void
  disabled?: boolean
}) {
  return <Button onClick={onOpen} disabled={disabled}>Link new account</Button>
}

function RegistrationWizard({
  account,
  step,
  phoneNumber,
  onPhoneNumberChange,
  onLinkAccount,
  isLinking,
  onSaved,
  onRefresh,
  onStepChange,
  onCancel,
  onOpenWorkspace,
}: {
  account: Agent | null
  step: WizardStep
  phoneNumber: string
  onPhoneNumberChange: (value: string) => void
  onLinkAccount: () => void
  isLinking: boolean
  onSaved: (message: string) => void
  onRefresh: () => Promise<void>
  onStepChange: (step: WizardStep) => void
  onCancel: () => void
  onOpenWorkspace: (accountId: number) => void
}) {
  return (
      <Card title={account ? `Link account - ${account.phone_number || ''}` : 'Link Telegram Account'} subtitle={account ? 'Complete the Telegram login flow.' : 'Enter your phone number to link a Telegram account.'}>
      <WizardMilestones currentStep={step} />

      {step === 'code' && account ? (
        <WizardCodeStep account={account} onSaved={onSaved} onRefresh={onRefresh} onStepChange={onStepChange} onCancel={onCancel} />
      ) : null}
      {step === 'code' && !account ? (
        <PhoneEntryStep
          phoneNumber={phoneNumber}
          onPhoneNumberChange={onPhoneNumberChange}
          onLink={onLinkAccount}
          isLinking={isLinking}
          onCancel={onCancel}
        />
      ) : null}

      {step === 'password' && account ? (
        <WizardPasswordStep account={account} onSaved={onSaved} onRefresh={onRefresh} onStepChange={onStepChange} onCancel={onCancel} />
      ) : null}

      {step === 'finish' && account ? (
        <>
          <Note>Account {accountLabel(account)} is ready.</Note>
          <Note>Auth state {account.auth_state} · status {account.status}</Note>
          <Button onClick={() => onOpenWorkspace(account.id)}>Open workspace</Button>
        </>
      ) : null}
    </Card>
  )
}

function PhoneEntryStep({
  phoneNumber,
  onPhoneNumberChange,
  onLink,
  isLinking,
  onCancel,
}: {
  phoneNumber: string
  onPhoneNumberChange: (value: string) => void
  onLink: () => void
  isLinking: boolean
  onCancel: () => void
}) {
  return (
    <>
      <InputField label="Phone number" value={phoneNumber} onChange={onPhoneNumberChange} placeholder="+966501234567" />
      <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: -8, marginBottom: 8 }}>
        Enter your Telegram account phone number in international format
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={onLink} disabled={isLinking || !phoneNumber.trim()}>
          {isLinking ? 'Linking...' : 'Link Account'}
        </Button>
        <Button tone="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  )
}

function WizardMilestones({ currentStep }: { currentStep: WizardStep }) {
  const currentStepIndex = Math.max(0, LINK_ACCOUNT_STEPS.indexOf(currentStep))

  return (
    <div
      aria-label="Link account progress"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        marginBottom: 16,
        overflowX: 'auto',
        paddingBottom: 2,
      }}
    >
      {LINK_ACCOUNT_STEPS.map((step, index) => {
        const isActive = index === currentStepIndex
        const isComplete = index < currentStepIndex
        const milestoneColor = isActive || isComplete ? 'var(--miniapp-clay)' : '#9b9186'

        return (
          <div
            key={step}
            aria-current={isActive ? 'step' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: '0 0 auto',
              color: milestoneColor,
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${isActive || isComplete ? 'var(--miniapp-clay)' : 'var(--miniapp-border-soft)'}`,
                background: isComplete ? 'var(--miniapp-clay)' : 'var(--miniapp-surface)',
                color: isComplete ? 'var(--miniapp-surface)' : milestoneColor,
                marginRight: 6,
                fontSize: 11,
              }}
            >
              {index + 1}
            </span>
            {wizardStepMilestoneLabel(step)}
            {index < LINK_ACCOUNT_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 1,
                  background: index < currentStepIndex ? 'var(--miniapp-clay)' : 'var(--miniapp-border-soft)',
                  margin: '0 10px',
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function wizardStepMilestoneLabel(step: WizardStep) {
  switch (step) {
    case 'code':
      return 'Code'
    case 'password':
      return '2FA'
    case 'finish':
      return 'Workspace'
  }
}

function WizardCodeStep({
  account,
  onSaved,
  onRefresh,
  onStepChange,
  onCancel,
}: {
  account: Agent
  onSaved: (message: string) => void
  onRefresh: () => Promise<void>
  onStepChange: (step: WizardStep) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <InputField label="Login code" value={code} onChange={setCode} placeholder="Enter the code sent to Telegram" />
      {error ? <Note tone="warning">{error}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button
        onClick={() => {
          const trimmed = code.trim()
          if (!trimmed) {
            setError('Code is required')
            return
          }
          if (!/^\d{4,8}$/.test(trimmed)) {
            setError('Code must be 4-8 digits, e.g. 12345')
            return
          }
          setError(null)
          void agentsApi.submitAgentCode(account.id, trimmed).then(async (response) => {
            const nextResponse = response as { agent: Agent }
            onSaved('Code verified')
            await onRefresh()
            onStepChange(nextResponse.agent.auth_state === 'pending_2fa' ? 'password' : 'finish')
          }).catch((err) => {
            setError(err instanceof Error ? err.message : 'Failed to verify code')
          })
        }}
      >
        Continue
      </Button>
      <Button tone="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  )
}

function WizardPasswordStep({
  account,
  onSaved,
  onRefresh,
  onStepChange,
}: {
  account: Agent
  onSaved: (message: string) => void
  onRefresh: () => Promise<void>
  onStepChange: (step: WizardStep) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <InputField label="Password / 2FA" value={password} onChange={setPassword} placeholder="Enter your Telegram 2FA password" />
      {error ? <Note tone="warning">{error}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          onClick={() => {
            const trimmed = password.trim()
            if (!trimmed) {
              setError('Password is required')
              return
            }
            if (trimmed.length < 2) {
              setError('Password must be at least 2 characters')
              return
            }
            setError(null)
            void agentsApi.submitAgentPassword(account.id, trimmed).then(async () => {
              onSaved('2FA verified')
              await onRefresh()
              onStepChange('finish')
            }).catch((err) => {
              setError(err instanceof Error ? err.message : 'Failed to verify password')
            })
          }}
        >
          Finish auth
        </Button>
        <Button tone="secondary" onClick={() => onStepChange('finish')}>
          Skip for now
        </Button>
        <Button tone="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  )
}

function AccountGroupsPage({ account }: { account: Agent }) {
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [query, setQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<AgentManagedGroup | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isMembersOpen, setIsMembersOpen] = useState(false)

  async function refresh() {
    const normalized = query.trim()
    if (!normalized) return
    setLoading(true)
    try {
      const payload = await agentsApi.fetchAgentGroups(account.id, normalized)
      setGroups(payload)
      setStatus(payload.length ? null : 'No matching groups found in the database.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to search groups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const normalized = query.trim()
    if (!normalized) {
      setGroups([])
      setLoading(false)
      return
    }

    const timer = setTimeout(() => {
      void refresh()
    }, 400)

    return () => clearTimeout(timer)
  }, [account.id, query])

  useEffect(() => {
    if (!selectedGroup?.tg_group_id) {
      return
    }
    const refreshed = groups.find((group) => group.tg_group_id === selectedGroup.tg_group_id) ?? null
    if (refreshed) {
      setSelectedGroup(refreshed)
    }
  }, [groups, selectedGroup])

  return (
    <Card title="Search Workspace" subtitle="Search for groups that have been synced to the database.">
      {status && !groups.length ? <Note>{status}</Note> : null}
      <InputField label="Search groups" value={query} onChange={setQuery} placeholder="Type group title or ID" />
      <div style={{ display: 'grid', gap: 8, marginTop: query.trim() ? 12 : 0 }}>
        {loading ? (
          <Note>Searching database...</Note>
        ) : (
          groups.map((group, index) => (
            <LinkRow
              key={`${group.tg_group_id ?? index}-${group.title ?? index}`}
              active={selectedGroup?.tg_group_id === group.tg_group_id}
              onClick={() => setSelectedGroup(group)}
            >
              <strong>{group.title || `Group ${group.tg_group_id ?? index}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>
                {group.tg_group_id ?? 'no tg id'} · members {group.member_count ?? 0} · messages {group.messages_count ?? 0}
              </div>
            </LinkRow>
          ))
        )}
      </div>
      {selectedGroup ? (
        <div style={{ marginTop: 20 }}>
          <Card title="Group info" subtitle="Details for the selected visible group.">
            <Note>Group name: {selectedGroup.title || 'Unknown group'}</Note>
            <Note>TG group ID: {selectedGroup.tg_group_id ?? 'Unavailable'}</Note>
            <Button onClick={() => setIsMembersOpen(true)}>Members ({selectedGroup.member_count ?? 'unknown'})</Button>
            <Note>Messages: {selectedGroup.messages_count ?? 0}</Note>
          </Card>
        </div>
      ) : null}
      {selectedGroup && isMembersOpen ? (
        <GroupMembersModal
          accountId={account.id}
          group={selectedGroup}
          onTotalChange={(total) => {
            setGroups((current) => current.map((entry) => (
              entry.tg_group_id === selectedGroup.tg_group_id ? { ...entry, member_count: total } : entry
            )))
            setSelectedGroup((current) => (current ? { ...current, member_count: total } : current))
          }}
          onClose={() => setIsMembersOpen(false)}
        />
      ) : null}
    </Card>
  )
}

function GroupMembersModal({
  accountId,
  group,
  onTotalChange,
  onClose,
}: {
  accountId: number
  group: AgentManagedGroup
  onTotalChange: (total: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState<AgentGroupMember[]>([])
  const [selectedMembers, setSelectedMembers] = useState<AgentGroupMember[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [selectedMember, setSelectedMember] = useState<AgentGroupMember | null>(null)
  const pageSize = 10
  const [total, setTotal] = useState(group.member_count ?? 0)

  useEffect(() => {
    if (!group.tg_group_id) {
      setMembers([])
      setStatus('Group id unavailable')
      return
    }

    void agentsApi.fetchAgentGroupMembers(accountId, group.tg_group_id, query, page, pageSize)
      .then((payload) => {
        setMembers(payload.members)
        setTotal(payload.total)
        onTotalChange(payload.total)
        setStatus(payload.members.length ? null : 'No members found in the database')
      })
      .catch((error) => {
        setMembers([])
        setTotal(0)
        setStatus(error instanceof Error ? error.message : 'Failed to load group members')
      })
  }, [accountId, group.tg_group_id, onTotalChange, page, pageSize, query])

  useEffect(() => {
    setPage(1)
  }, [query])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function toggleMember(member: AgentGroupMember) {
    setSelectedMembers((current) => {
      const exists = current.some((m) => m.user_id === member.user_id)
      if (exists) {
        return current.filter((m) => m.user_id !== member.user_id)
      }
      return [...current, member]
    })
  }

  function selectAllOnPage() {
    setSelectedMembers((current) => {
      const newSelection = [...current]
      members.forEach((m) => {
        if (!newSelection.some((s) => s.user_id === m.user_id)) {
          newSelection.push(m)
        }
      })
      return newSelection
    })
  }

  async function saveSelectedAsContacts() {
    if (!selectedMembers.length) return
    setStatus(`Queuing ${selectedMembers.length} contact saves...`)
    let success = 0
    let failed = 0
    
    for (const member of selectedMembers) {
      try {
        await agentsApi.createAgentJob(accountId, 'add_contact', {
          user_id: member.user_id,
          username: member.username,
          first_name: member.full_name?.split(' ')[0] || 'User',
          last_name: member.full_name?.split(' ').slice(1).join(' ') || '',
          tg_group_id: group.tg_group_id,
          group_title: group.title || 'Group',
          sequence: new Date().getTime() % 10000,
        })
        success++
      } catch (error) {
        failed++
      }
    }
    
    setSelectedMembers([])
    setStatus(`Contact save jobs queued: ${success} successful, ${failed} failed. Check notifications for details.`)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(32, 25, 16, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20,
          padding: 20,
          display: 'grid',
          gap: 12,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <strong>{group.title || 'Group members'}</strong>
            <div style={{ color: '#655d52', marginTop: 4 }}>
              Members {total || group.member_count || 0} · Page {page} / {totalPages}
            </div>
          </div>
          <Button tone="secondary" onClick={onClose}>Close</Button>
        </div>
        <InputField label="Search members" value={query} onChange={setQuery} placeholder="Name or username" />
        
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button tone="secondary" onClick={selectAllOnPage} disabled={!members.length}>
            Select all on page
          </Button>
          {selectedMembers.length > 0 ? (
            <>
              <Button tone="secondary" onClick={() => setSelectedMembers([])}>
                Clear selection ({selectedMembers.length})
              </Button>
              <Button onClick={() => void saveSelectedAsContacts()}>
                Save selected to contacts
              </Button>
            </>
          ) : null}
        </div>

        {status ? <Note>{status}</Note> : null}

        <div style={{ display: 'grid', gap: 8 }}>
          {members.map((member) => {
            const isSelected = selectedMembers.some((m) => m.user_id === member.user_id)
            return (
              <div
                key={member.user_id}
                onClick={() => toggleMember(member)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 14,
                  padding: 14,
                  border: isSelected ? '1px solid var(--miniapp-sage)' : '1px solid var(--miniapp-border-soft)',
                  borderRadius: 12,
                  background: isSelected ? 'rgba(102, 115, 95, 0.05)' : 'var(--miniapp-bg)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ 
                    width: 20, 
                    height: 20, 
                    borderRadius: 6, 
                    border: '2px solid var(--miniapp-border-soft)',
                    background: isSelected ? 'var(--miniapp-sage)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 14,
                  }}>
                    {isSelected ? '✓' : ''}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>{member.full_name || 'No name stored'}</strong>
                    <div style={{ color: '#655d52' }}>User ID: {member.user_id}</div>
                    <div style={{ color: '#655d52' }}>Username: {member.username ? `@${member.username}` : 'Unavailable'}</div>
                    <div style={{ color: '#655d52' }}>Role: {member.role || 'member'}</div>
                    <div style={{ color: '#655d52' }}>Messages: {member.message_count ?? 0}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                    <Button tone="secondary" onClick={() => setSelectedMember(member)}>
                      View messages
                    </Button>
                    <Button
                      tone="secondary"
                      onClick={async () => {
                        try {
                          await agentsApi.createAgentJob(accountId, 'add_contact', {
                            user_id: member.user_id,
                            username: member.username,
                            first_name: member.full_name?.split(' ')[0] || 'User',
                            last_name: member.full_name?.split(' ').slice(1).join(' ') || '',
                            tg_group_id: group.tg_group_id,
                            group_title: group.title || 'Group',
                            sequence: new Date().getTime() % 10000,
                          })
                          alert('Save contact job queued.')
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'Failed to queue contact save')
                        }
                      }}
                    >
                      Save contact
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <Note>Loaded {members.length} of {total}</Note>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone="secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Button tone="secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </div>
      {selectedMember && group.tg_group_id ? (
        <MemberMessagesModal
          accountId={accountId}
          tgGroupId={group.tg_group_id}
          member={selectedMember}
          onClose={() => setSelectedMember(null)}
        />
      ) : null}
    </div>
  )
}

function MemberMessagesModal({
  accountId,
  tgGroupId,
  member,
  onClose,
}: {
  accountId: number
  tgGroupId: number
  member: AgentGroupMember
  onClose: () => void
}) {
  const [messages, setMessages] = useState<AgentGroupMemberMessage[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 25
  const [total, setTotal] = useState(0)

  useEffect(() => {
    setLoading(true)
    void agentsApi.fetchAgentGroupMemberMessages(accountId, tgGroupId, member.user_id, page, pageSize)
      .then((payload) => {
        setMessages(payload.messages)
        setTotal(payload.total)
        setStatus(payload.messages.length ? null : 'No stored messages found for this member.')
      })
      .catch((error) => {
        setMessages([])
        setTotal(0)
        setStatus(error instanceof Error ? error.message : 'Failed to load member messages')
      })
      .finally(() => setLoading(false))
  }, [accountId, member.user_id, page, tgGroupId])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(32, 25, 16, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        zIndex: 1001,
      }}
    >
      <div
        style={{
          width: 'min(680px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20,
          padding: 20,
          display: 'grid',
          gap: 12,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <strong>{member.full_name || member.username || `User ${member.user_id}`}</strong>
            <div style={{ color: '#655d52', marginTop: 4 }}>
              User ID {member.user_id} · {member.username ? `@${member.username}` : 'No username'} · Page {page} / {totalPages}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              tone="secondary"
              onClick={async () => {
                try {
                  await agentsApi.createAgentJob(accountId, 'add_contact', {
                    user_id: member.user_id,
                    username: member.username,
                    first_name: member.full_name?.split(' ')[0] || 'User',
                    last_name: member.full_name?.split(' ').slice(1).join(' ') || '',
                    tg_group_id: tgGroupId,
                    group_title: 'Group', // We don't have the full group object here, but ID is enough for cache priming
                    sequence: new Date().getTime() % 10000,
                  })
                  alert('Save contact job queued.')
                } catch (error) {
                  alert(error instanceof Error ? error.message : 'Failed to queue contact save')
                }
              }}
            >
              Save contact
            </Button>
            <Button tone="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>
        {loading ? <Note>Loading messages...</Note> : null}
        {status ? <Note>{status}</Note> : null}
        <div style={{ display: 'grid', gap: 8 }}>
          {messages.map((message) => (
            <div
              key={message.message_id}
              style={{
                display: 'grid',
                gap: 6,
                padding: 14,
                border: '1px solid var(--miniapp-border-soft)',
                borderRadius: 12,
                background: 'var(--miniapp-bg)',
              }}
            >
              <div style={{ color: '#655d52', fontSize: 12.5 }}>
                Message #{message.message_id} · {message.message_type || 'text'} · {message.date ? new Date(message.date).toLocaleString() : 'Unknown time'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.text || '[No message text captured]'}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <Note>Loaded {messages.length} of {total}</Note>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone="secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>
              Previous
            </Button>
            <Button tone="secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountNotificationsPage({
  account,
  onUnseenCountChange,
}: {
  account: Agent
  onUnseenCountChange: (count: number) => void
}) {
  const [notifications, setNotifications] = useState<AgentNotification[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isMarkingSeen, setIsMarkingSeen] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const payload = await agentsApi.fetchAgentNotifications(account.id, 100)
      setNotifications(payload.items)
      onUnseenCountChange(payload.unseen_count)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [account.id])

  async function markAllSeen() {
    setIsMarkingSeen(true)
    try {
      await agentsApi.markAgentNotificationsSeen(account.id)
      await refresh()
    } finally {
      setIsMarkingSeen(false)
    }
  }

  const visibleNotifications = notifications.filter((notification) => !notification.is_seen)

  return (
    <Card title="Notifications" subtitle="Scrape completion and account notifications for this agent.">
      {status ? <Note>{status}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>Refresh</Button>
        <Button onClick={() => void markAllSeen()} disabled={isMarkingSeen || loading}>Mark all seen</Button>
      </div>
      {loading ? <Note>Loading notifications...</Note> : null}
      {!loading && visibleNotifications.length === 0 ? <Note>No unseen notifications.</Note> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {visibleNotifications.map((notification) => (
          (() => {
            const tone = notificationTone(notification.kind)
            const chips = notificationChips(notification)
            return (
              <div
                key={notification.id}
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: 14,
                  border: `1px solid ${tone.border}`,
                  borderRadius: 14,
                  background: tone.background,
                  boxShadow: '0 10px 24px rgba(35, 28, 20, 0.06)',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px 8px',
                        borderRadius: 999,
                        background: tone.badge,
                        color: tone.accent,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {notificationKindLabel(notification.kind)}
                    </span>
                    <span style={{ color: 'var(--miniapp-coral)', fontSize: 12, fontWeight: 700 }}>NEW</span>
                  </div>
                  <div style={{ color: '#7d746a', fontSize: 12, whiteSpace: 'nowrap' }}>{notificationTimeLabel(notification.created_at)}</div>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 15 }}>{notification.title}</strong>
                  <div style={{ color: '#655d52', lineHeight: 1.45 }}>{notification.body}</div>
                </div>
                {chips.length ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {chips.map((chip) => (
                      <span
                        key={chip}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '5px 9px',
                          borderRadius: 999,
                          background: 'var(--miniapp-surface)',
                          border: '1px solid var(--miniapp-border-soft)',
                          color: '#655d52',
                          fontSize: 12,
                        }}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })()
        ))}
      </div>
    </Card>
  )
}

function AccountTasksPage({ account, onSaved }: { account: Agent; onSaved: (message: string) => void }) {
  const [catalog, setCatalog] = useState<TaskCatalogItem[]>([])
  const [tasks, setTasks] = useState<AutomationTask[]>([])
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationTask | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [taskKey, setTaskKey] = useState('reply_message')
  const [taskKeyword, setTaskKeyword] = useState('')
  const [taskTemplate, setTaskTemplate] = useState('')
  const [taskReplyMode, setTaskReplyMode] = useState('public')
  const [taskDeliveryMode, setTaskDeliveryMode] = useState('text')
  const [taskDestinationMode, setTaskDestinationMode] = useState<TaskDestinationMode>('group')
  const [taskDestinationText, setTaskDestinationText] = useState('')
  const [taskDestinationGroupQuery, setTaskDestinationGroupQuery] = useState('')
  const [taskDestinationGroup, setTaskDestinationGroup] = useState<SelectedGroupChip | null>(null)
  const [taskGroupsQuery, setTaskGroupsQuery] = useState('')
  const [taskGroups, setTaskGroups] = useState<SelectedGroupChip[]>([])
  const [bulkSourceGroupQuery, setBulkSourceGroupQuery] = useState('')
  const [bulkSourceGroup, setBulkSourceGroup] = useState<SelectedGroupChip | null>(null)
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkThreshold, setBulkThreshold] = useState('25')
  const [bulkIntervalSeconds, setBulkIntervalSeconds] = useState('1')
  const [bulkMemberQuery, setBulkMemberQuery] = useState('')
  const [bulkMemberResults, setBulkMemberResults] = useState<AgentGroupMember[]>([])
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<AgentGroupMember[]>([])
  const [bulkMemberStatus, setBulkMemberStatus] = useState<string | null>(null)
  const [loadingBulkMembers, setLoadingBulkMembers] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const [nextTasks, nextCatalog] = await Promise.all([
        agentsApi.fetchGroupTasks(account.group_id || 196),
        agentsApi.fetchTaskCatalog(),
      ])
      setTasks(nextTasks)
      setCatalog(nextCatalog)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [account.group_id, account.id])

  // Handle group search for autocomplete fields
  const groupQuery = (bulkSourceGroupQuery || taskDestinationGroupQuery || taskGroupsQuery).trim()
  useEffect(() => {
    if (!groupQuery) {
      setGroups([])
      setLoadingGroups(false)
      return
    }

    const timer = setTimeout(() => {
      setLoadingGroups(true)
      void agentsApi.fetchAgentGroups(account.id, groupQuery)
        .then(setGroups)
        .catch(() => setGroups([]))
        .finally(() => setLoadingGroups(false))
    }, 350)

    return () => clearTimeout(timer)
  }, [account.id, groupQuery])

  useEffect(() => {
    if (!catalog.length) {
      return
    }
    if (![...catalog, BULK_MESSAGE_TASK_META].some((item) => item.key === taskKey)) {
      setTaskKey(catalog[0].key)
    }
  }, [catalog, taskKey])

  function resetForm() {
    setEditingTask(null)
    setTaskKey(catalog[0]?.key || 'reply_message')
    setTaskKeyword('')
    setTaskTemplate('')
    setTaskReplyMode('public')
    setTaskDeliveryMode('text')
    setTaskDestinationMode('group')
    setTaskDestinationText('')
    setTaskDestinationGroupQuery('')
    setTaskDestinationGroup(null)
    setTaskGroupsQuery('')
    setTaskGroups([])
    setBulkSourceGroupQuery('')
    setBulkSourceGroup(null)
    setBulkMessage('')
    setBulkThreshold('25')
    setBulkIntervalSeconds('1')
    setBulkMemberQuery('')
    setBulkMemberResults([])
    setBulkSelectedMembers([])
    setBulkMemberStatus(null)
  }

  function openCreateForm() {
    resetForm()
    setIsFormOpen(true)
  }

  function openEditForm(task: AutomationTask) {
    const configuredDestination = String(task.config.destination || '')
    const matchingDestinationGroup = groups.find((group) => String(group.tg_group_id || '') === configuredDestination)
    setEditingTask(task)
    setTaskKey(task.task_key)
    setTaskKeyword(String(task.conditions.text_contains || ''))
    setTaskTemplate(String(task.config.message_template || ''))
    setTaskReplyMode(String(task.config.reply_mode || 'public'))
    setTaskDeliveryMode(String(task.config.delivery_mode || 'text'))
    setTaskDestinationMode(matchingDestinationGroup ? 'group' : 'text')
    setTaskDestinationText(matchingDestinationGroup ? '' : configuredDestination)
    setTaskDestinationGroupQuery(matchingDestinationGroup ? String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || '') : '')
    setTaskDestinationGroup(
      matchingDestinationGroup
        ? {
            tg_group_id: Number(matchingDestinationGroup.tg_group_id),
            title: String(matchingDestinationGroup.title || matchingDestinationGroup.tg_group_id || 'Group'),
          }
        : null,
    )
    setTaskGroupsQuery('')
    setTaskGroups(mapTaskGroups(task))
    setBulkSourceGroupQuery('')
    setBulkSourceGroup(null)
    setBulkMessage('')
    setBulkThreshold('25')
    setBulkIntervalSeconds('1')
    setBulkMemberQuery('')
    setBulkMemberResults([])
    setBulkSelectedMembers([])
    setBulkMemberStatus(null)
    setIsFormOpen(true)
  }

  function closeForm() {
    setIsFormOpen(false)
    resetForm()
  }

  useEffect(() => {
    if (taskKey !== BULK_MESSAGE_TASK_KEY || !bulkSourceGroup?.tg_group_id) {
      setBulkMemberResults([])
      setBulkMemberStatus(null)
      setLoadingBulkMembers(false)
      return
    }

    const query = bulkMemberQuery.trim()
    if (!query) {
      setBulkMemberResults([])
      setBulkMemberStatus(null)
      return
    }

    let cancelled = false
    setLoadingBulkMembers(true)
    setBulkMemberStatus(null)
    void agentsApi.searchAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id, query, 20)
      .then((members) => {
        if (cancelled) {
          return
        }
        const selectedIds = new Set(bulkSelectedMembers.map((member) => member.user_id))
        const filteredMembers = members.filter((member) => !selectedIds.has(member.user_id))
        setBulkMemberResults(filteredMembers)
        setBulkMemberStatus(filteredMembers.length ? null : 'No matching members found.')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setBulkMemberResults([])
        setBulkMemberStatus(error instanceof Error ? error.message : 'Failed to search group members')
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBulkMembers(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [account.id, bulkMemberQuery, bulkSelectedMembers, bulkSourceGroup, taskKey])

  async function saveTask() {
    if (taskKey === BULK_MESSAGE_TASK_KEY) {
      if (!bulkSourceGroup?.tg_group_id) {
        setStatus('Source group is required for bulk message')
        return
      }
      if (!bulkMessage.trim()) {
        setStatus('Bulk message text is required')
        return
      }

      const threshold = Number.parseInt(bulkThreshold, 10)
      if (!Number.isFinite(threshold) || threshold <= 0) {
        setStatus('Threshold must be a positive integer')
        return
      }

      const intervalSeconds = Number.parseFloat(bulkIntervalSeconds)
      if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
        setStatus('Interval seconds must be a non-negative number')
        return
      }

      setIsSaving(true)
      try {
        await agentsApi.createAgentJob(account.id, BULK_MESSAGE_TASK_KEY, {
          source_group_id: bulkSourceGroup.tg_group_id,
          source_group_title: bulkSourceGroup.title,
          message: bulkMessage.trim(),
          threshold,
          interval_seconds: intervalSeconds,
          selected_user_ids: bulkSelectedMembers.map((member) => member.user_id),
        })
        closeForm()
        setStatus(null)
        onSaved('Bulk message job queued')
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to queue bulk message job')
      } finally {
        setIsSaving(false)
      }
      return
    }

    if (!taskKeyword.trim()) {
      setStatus('Task keyword is required')
      return
    }

    const config: Record<string, unknown> = {}
    if (taskTemplate.trim()) {
      config.message_template = taskTemplate.trim()
    }
    if (taskKey === 'reply_message') {
      config.reply_mode = taskReplyMode
    }
    if (taskKey === 'notify_destination') {
      const destination = taskDestinationMode === 'group'
        ? String(taskDestinationGroup?.tg_group_id || '')
        : taskDestinationText.trim()
      if (!destination) {
        setStatus('Destination is required for notify destination')
        return
      }
      config.destination = destination
      config.delivery_mode = taskDeliveryMode
    }

    const payload = {
      task_key: taskKey,
      executor_type: 'agent',
      enabled: true,
      conditions: { text_contains: taskKeyword.trim() },
      config,
      agent_id: account.id,
      group_tg_ids: taskGroups.map((group) => group.tg_group_id),
      group_titles: taskGroups.map((group) => group.title),
    }

    setIsSaving(true)
    try {
      if (editingTask) {
        await agentsApi.updateGroupTask(account.group_id || 196, editingTask.assignment_id, payload)
        onSaved('Task updated')
      } else {
        await agentsApi.createGroupTask(account.group_id || 196, payload)
        onSaved('Task created')
      }
      closeForm()
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save task')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteTask() {
    if (!deleteTarget) {
      return
    }
    setIsSaving(true)
    try {
      await agentsApi.deleteGroupTask(account.group_id, deleteTarget.assignment_id)
      onSaved('Task deleted')
      setDeleteTarget(null)
      await refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete task')
    } finally {
      setIsSaving(false)
    }
  }

  const extendedCatalog = useMemo(() => (catalog.length ? [...catalog, BULK_MESSAGE_TASK_META] : []), [catalog])
  const selectedTaskMeta = extendedCatalog.find((item) => item.key === taskKey) ?? null
  const isBulkMessageTask = taskKey === BULK_MESSAGE_TASK_KEY

  return (
    <Card title="Tasks" subtitle="Select a task type and save it against this account group.">
      {status ? <Note>{status}</Note> : null}
      {!isFormOpen ? <Button onClick={openCreateForm} disabled={loading || !catalog.length}>New task</Button> : null}
      {isFormOpen && catalog.length ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <SelectField label="Task type" value={taskKey} onChange={setTaskKey}>
            {extendedCatalog.map((item) => (
              <option key={item.key} value={item.key}>{item.title}</option>
            ))}
          </SelectField>
          {selectedTaskMeta?.description ? <Note>{selectedTaskMeta.description}</Note> : null}
          {isBulkMessageTask ? (
            <>
              <GroupDestinationField
                label="Source group"
                query={bulkSourceGroupQuery}
                onQueryChange={setBulkSourceGroupQuery}
                groups={groups}
                selectedGroup={bulkSourceGroup}
                onSelect={(group) => {
                  setBulkSourceGroup(group)
                  setBulkSourceGroupQuery(group.title)
                  setBulkMemberQuery('')
                  setBulkMemberResults([])
                  setBulkSelectedMembers([])
                  setBulkMemberStatus(null)
                }}
                onClear={() => {
                  setBulkSourceGroup(null)
                  setBulkSourceGroupQuery('')
                  setBulkMemberQuery('')
                  setBulkMemberResults([])
                  setBulkSelectedMembers([])
                  setBulkMemberStatus(null)
                }}
              />
              <TextAreaField
                label="Message"
                value={bulkMessage}
                onChange={setBulkMessage}
                rows={5}
                placeholder="Hello, this is our latest update."
              />
              <InputField
                label="Select members"
                value={bulkMemberQuery}
                onChange={setBulkMemberQuery}
                placeholder={bulkSourceGroup ? 'Search by name, username, or user id' : 'Choose a source group first'}
              />
              {loadingBulkMembers ? <Note>Searching members...</Note> : null}
              {bulkMemberStatus ? <Note>{bulkMemberStatus}</Note> : null}
              {!loadingBulkMembers && bulkMemberResults.length ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      tone="secondary"
                      onClick={() => {
                        setBulkSelectedMembers((current) => {
                          const next = [...current]
                          bulkMemberResults.forEach((member) => {
                            if (!next.some((entry) => entry.user_id === member.user_id)) {
                              next.push(member)
                            }
                          })
                          return next
                        })
                        setBulkMemberQuery('')
                        setBulkMemberResults([])
                        setBulkMemberStatus(null)
                      }}
                    >
                      Select all results ({bulkMemberResults.length})
                    </Button>
                    <Button tone="secondary" onClick={() => { setBulkMemberResults([]); setBulkMemberQuery(''); }}>
                      Clear results
                    </Button>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: 8,
                      border: '1px solid var(--miniapp-border-soft)',
                      borderRadius: 12,
                      background: 'var(--miniapp-bg)',
                    }}
                  >
                    {bulkMemberResults.map((member) => (
                      <LinkRow
                        key={member.user_id}
                        onClick={() => {
                          setBulkSelectedMembers((current) => (
                            current.some((entry) => entry.user_id === member.user_id) ? current : [...current, member]
                          ))
                          setBulkMemberQuery('')
                          setBulkMemberResults([])
                          setBulkMemberStatus(null)
                        }}
                      >
                        <strong>{member.full_name || member.username || `User ${member.user_id}`}</strong>
                        <div style={{ color: '#655d52', marginTop: 4 }}>
                          {member.username ? `@${member.username} · ` : ''}{member.user_id}
                        </div>
                      </LinkRow>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {bulkSelectedMembers.length ? bulkSelectedMembers.map((member) => (
                  <span
                    key={member.user_id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 999,
                      border: '1px solid var(--miniapp-border-soft)',
                      background: 'var(--miniapp-bg)',
                      fontSize: 12.5,
                    }}
                  >
                    {member.full_name || member.username || `User ${member.user_id}`}
                    <button
                      type="button"
                      onClick={() => setBulkSelectedMembers((current) => current.filter((entry) => entry.user_id !== member.user_id))}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--miniapp-clay)',
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                )) : <Note>No specific members selected. Leave empty to target the full eligible group.</Note>}
              </div>
              <InputField label="Threshold" value={bulkThreshold} onChange={setBulkThreshold} type="number" />
              <InputField label="Interval seconds" value={bulkIntervalSeconds} onChange={setBulkIntervalSeconds} type="number" />
              <Note>This task type queues a worker job immediately. It does not create a saved automation assignment.</Note>
            </>
          ) : (
            <>
              <InputField label="Keyword condition" value={taskKeyword} onChange={setTaskKeyword} placeholder="support" />
              <TextAreaField
                label="Message template"
                value={taskTemplate}
                onChange={setTaskTemplate}
                rows={5}
                placeholder={taskKey === 'notify_destination' ? 'Notify: {text}' : 'We will reply shortly.'}
              />
              {taskKey === 'reply_message' ? (
                <SelectField label="Reply mode" value={taskReplyMode} onChange={setTaskReplyMode}>
                  <option value="public">Public (group)</option>
                  <option value="private">Private (direct message)</option>
                </SelectField>
              ) : null}
              <GroupAutocompleteField
                label="Select groups"
                query={taskGroupsQuery}
                onQueryChange={setTaskGroupsQuery}
                groups={groups}
                selectedGroups={taskGroups}
                onAdd={(group) => {
                  setTaskGroups((current) => current.some((entry) => entry.tg_group_id === group.tg_group_id) ? current : [...current, group])
                  setTaskGroupsQuery('')
                }}
                onRemove={(tgGroupId) => setTaskGroups((current) => current.filter((group) => group.tg_group_id !== tgGroupId))}
                placeholder="Search visible groups"
              />
              <Note>Executor is fixed to this linked agent account.</Note>
              {taskKey === 'notify_destination' ? (
                <>
                  <SelectField label="Destination type" value={taskDestinationMode} onChange={(value) => setTaskDestinationMode(value as TaskDestinationMode)}>
                    <option value="group">Select visible group</option>
                    <option value="text">Manual ID / username</option>
                  </SelectField>
                  {taskDestinationMode === 'group' ? (
                    <GroupDestinationField
                      label="Destination group"
                      query={taskDestinationGroupQuery}
                      onQueryChange={setTaskDestinationGroupQuery}
                      groups={groups}
                      selectedGroup={taskDestinationGroup}
                      onSelect={(group) => {
                        setTaskDestinationGroup(group)
                        setTaskDestinationGroupQuery(group.title)
                      }}
                      onClear={() => {
                        setTaskDestinationGroup(null)
                        setTaskDestinationGroupQuery('')
                      }}
                    />
                  ) : (
                    <InputField label="Destination" value={taskDestinationText} onChange={setTaskDestinationText} placeholder="-1001234567890 or @channel" />
                  )}
                  <SelectField label="Delivery mode" value={taskDeliveryMode} onChange={setTaskDeliveryMode}>
                    <option value="text">Text</option>
                    <option value="forward">Forward</option>
                    <option value="copy">Copy</option>
                    <option value="text_and_forward">Text and forward</option>
                    <option value="text_and_copy">Text and copy</option>
                  </SelectField>
                </>
              ) : null}
            </>
          )}
          <FormActions
            submitLabel={isBulkMessageTask ? 'Queue job' : editingTask ? 'Save task' : 'Create task'}
            onSubmit={() => void saveTask()}
            onCancel={closeForm}
          />
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {loading ? <Note>Loading tasks...</Note> : null}
        {!loading && tasks.length === 0 ? <Note>No tasks configured for this group yet.</Note> : null}
        {!loading ? tasks.map((task) => (
          <div
            key={task.assignment_id}
            style={{
              display: 'grid',
              gap: 10,
              padding: 14,
              border: '1px solid var(--miniapp-border-soft)',
              borderRadius: 12,
              background: 'var(--miniapp-surface)',
            }}
          >
            <div>
              <strong>{taskTitle(task, catalog)}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>{taskConditionLabel(task)}</div>
              <div style={{ color: '#655d52', marginTop: 4 }}>{taskConfigLabel(task)}</div>
              {Array.isArray(task.group_titles) && task.group_titles.length ? (
                <div style={{ color: '#655d52', marginTop: 4 }}>
                  Groups: {task.group_titles.join(', ')}
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button tone="secondary" onClick={() => openEditForm(task)}>Edit</Button>
              <Button tone="danger" onClick={() => setDeleteTarget(task)}>Delete</Button>
            </div>
          </div>
        )) : null}
      </div>
      {deleteTarget ? (
        <ConfirmModal
          title="Delete task"
          message={`Delete ${taskTitle(deleteTarget, catalog)} from this group?`}
          confirmLabel="Delete"
          isBusy={isSaving}
          onConfirm={() => void deleteTask()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </Card>
  )
}

function AccountScrapingPage({
  account,
  onSaved,
}: {
  account: Agent
  onSaved: (message: string) => void
}) {
  const [groups, setGroups] = useState<AgentManagedGroup[]>([])
  const [selectedGroup, setSelectedGroup] = useState<AgentManagedGroup | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [memberLimit, setMemberLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [messageLimit, setMessageLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [maxAgeDays, setMaxAgeDays] = useState('30')

  function resetScrapeForm() {
    setQuery('')
    setSelectedGroup(null)
    setMemberLimit(String(SCRAPE_LIMIT_MAX))
    setMessageLimit(String(SCRAPE_LIMIT_MAX))
    setMaxAgeDays('30')
    setGroups([])
  }

  useEffect(() => {
    const normalized = query.trim()
    if (!normalized) {
      setGroups([])
      setLoadingGroups(false)
      return
    }

    const timer = setTimeout(() => {
      setLoadingGroups(true)
      void agentsApi.fetchAgentGroups(account.id, normalized)
        .then((payload) => {
          setGroups(payload)
          setStatus(payload.length ? null : 'No matching groups found in the database.')
        })
        .catch((error) => setStatus(error instanceof Error ? error.message : 'Failed to search groups'))
        .finally(() => setLoadingGroups(false))
    }, 400)

    return () => clearTimeout(timer)
  }, [account.id, query])

  async function scrapeMembers() {
    if (!selectedGroup?.tg_group_id) {
      setStatus('Choose a group first')
      return
    }
    const targetGroup = selectedGroup
    const targetGroupId = Number(targetGroup.tg_group_id)
    const queuedMessage = `Scraping job queued for ${targetGroup.title || targetGroup.tg_group_id}. The worker will process it and notify you when it finishes.`
    setIsScraping(true)
    try {
      await agentsApi.createAgentJob(account.id, 'scraper_full_group', {
        tg_group_id: targetGroupId,
        scrape_members: true,
        scrape_messages: true,
        member_limit: clampScrapeLimit(memberLimit),
        message_limit: clampScrapeLimit(messageLimit),
        max_age_days: Math.max(1, Number(maxAgeDays) || 30),
      })
      resetScrapeForm()
      setStatus(null)
      onSaved(queuedMessage)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to scrape group members')
    } finally {
      setIsScraping(false)
    }
  }

  return (
    <Card title="Database Scraper" subtitle="Queue background sync jobs for database-indexed groups.">
      {status ? <Note>{status}</Note> : null}
      <InputField label="Find group to scrape" value={query} onChange={setQuery} placeholder="Type group title or ID" />
      
      <div style={{ display: 'grid', gap: 8, marginTop: query.trim() ? 12 : 0 }}>
        {loadingGroups ? (
          <Note>Searching database...</Note>
        ) : (
          groups.map((group, index) => (
            <LinkRow
              key={`${group.tg_group_id ?? index}-${group.title ?? index}`}
              active={selectedGroup?.tg_group_id === group.tg_group_id}
              onClick={() => {
                setSelectedGroup(group)
                setQuery(group.title || '')
              }}
            >
              <strong>{group.title || `Group ${group.tg_group_id ?? index}`}</strong>
              <div style={{ color: '#655d52', marginTop: 4 }}>
                {group.tg_group_id ?? 'no tg id'} · members {group.member_count ?? 0}
              </div>
            </LinkRow>
          ))
        )}
      </div>

      {selectedGroup ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
          <InputField label="Max members to scrape" value={memberLimit} onChange={setMemberLimit} type="number" />
          <InputField label="Max messages to scrape" value={messageLimit} onChange={setMessageLimit} type="number" />
          <InputField label="Max message age in days" value={maxAgeDays} onChange={setMaxAgeDays} type="number" />
          <Button onClick={() => void scrapeMembers()} disabled={isScraping}>
            {isScraping ? 'Queueing...' : 'Start background sync'}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function AccountLeadsPage({ account }: { account: Agent }) {
  const [leads, setLeads] = useState<AgentLead[]>([])
  const [leadPage, setLeadPage] = useState<AgentLeadPage | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [editingLead, setEditingLead] = useState<AgentLead | null>(null)
  const [editNotes, setEditNotes] = useState('')
  const [editLeadStatus, setEditLeadStatus] = useState('')
  const leadStatuses = ['new', 'contacted', 'interested', 'converted', 'junk', 'dismissed']

  async function refresh() {
    setLoading(true)
    try {
      const result = await agentsApi.fetchAgentLeads(account.id, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        page_size: 25,
      })
      setLeadPage(result)
      setLeads(result.items)
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [account.id, statusFilter, page])

  async function updateLead(lead: AgentLead, newStatus: string) {
    try {
      await agentsApi.updateAgentLead(account.id, lead.id, { status: newStatus })
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to update lead')
    }
  }

  async function saveLeadEdits() {
    if (!editingLead) return
    try {
      await agentsApi.updateAgentLead(account.id, editingLead.id, {
        status: editLeadStatus || undefined,
        notes: editNotes,
      })
      setEditingLead(null)
      setEditNotes('')
      setEditLeadStatus('')
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save lead')
    }
  }

  async function deleteLead(leadId: number) {
    try {
      await agentsApi.deleteAgentLead(account.id, leadId)
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to delete lead')
    }
  }

  const totalPages = leadPage?.total_pages ?? 1

  return (
    <Card title="Leads" subtitle="Track and manage captured leads with full CRM lifecycle.">
      {status ? <Note>{status}</Note> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SelectField label="Filter by status" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <option value="all">All statuses</option>
          {leadStatuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </SelectField>
        <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>Refresh</Button>
      </div>

      {loading ? <Note>Loading leads...</Note> : null}
      {!loading && leads.length === 0 ? <Note>No leads found.</Note> : null}

      <div style={{ display: 'grid', gap: 8 }}>
        {leads.map((lead) => {
          const tone = _statusTone(lead.status)
          return (
            <div
              key={lead.id}
              style={{
                display: 'grid',
                gap: 10,
                padding: 14,
                border: `1px solid ${tone.border}`,
                borderRadius: 12,
                background: tone.bg,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <strong>{lead.first_name || lead.username || `User ${lead.tg_user_id}`}</strong>
                  {lead.username ? <span style={{ color: '#655d52', marginLeft: 8 }}>@{lead.username}</span> : null}
                </div>
                <span style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: tone.border,
                  color: tone.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}>
                  {lead.status}
                </span>
              </div>
              {lead.message_text ? (
                <div style={{ fontSize: 13, color: '#655d52', lineHeight: 1.45, maxHeight: 60, overflow: 'hidden' }}>
                  {lead.message_text.length > 200 ? lead.message_text.slice(0, 200) + '...' : lead.message_text}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#9b9186' }}>
                {lead.source_group_title ? <span>Group: {lead.source_group_title}</span> : null}
                {lead.lead_label ? <span>Label: {lead.lead_label}</span> : null}
                {lead.captured_at ? <span>{new Date(lead.captured_at).toLocaleDateString()}</span> : null}
              </div>
              {lead.notes ? (
                <div style={{ fontSize: 12, color: '#655d52', fontStyle: 'italic' }}>
                  Note: {lead.notes.length > 100 ? lead.notes.slice(0, 100) + '...' : lead.notes}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {leadStatuses.filter((s) => s !== lead.status).map((s) => (
                  <Button
                    key={s}
                    tone="secondary"
                    onClick={() => void updateLead(lead, s)}
                  >
                    {s === 'contacted' ? 'Mark Contacted' :
                     s === 'interested' ? 'Mark Interested' :
                     s === 'converted' ? 'Mark Converted' :
                     s === 'junk' ? 'Mark Junk' :
                     s === 'dismissed' ? 'Dismiss' :
                     `Set ${s}`}
                  </Button>
                ))}
                <Button tone="secondary" onClick={() => { setEditingLead(lead); setEditNotes(lead.notes || ''); setEditLeadStatus(lead.status) }}>
                  Edit
                </Button>
                <Button tone="danger" onClick={() => deleteLead(lead.id)}>Delete</Button>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
          <Button tone="secondary" onClick={() => setPage((c) => Math.max(1, c - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <Note>Page {page} of {totalPages} ({leadPage?.total ?? 0} total)</Note>
          <Button tone="secondary" onClick={() => setPage((c) => Math.min(totalPages, c + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      ) : null}

      {editingLead ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(32, 25, 16, 0.55)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 'min(420px, 100%)',
              background: 'var(--miniapp-surface)',
              border: '1px solid var(--miniapp-border-soft)',
              borderRadius: 20,
              padding: 20,
              display: 'grid',
              gap: 12,
              boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
            }}
          >
            <div style={{ fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>
              Edit Lead
            </div>
            <SelectField label="Status" value={editLeadStatus} onChange={setEditLeadStatus}>
              {leadStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </SelectField>
            <TextAreaField
              label="Notes"
              value={editNotes}
              onChange={setEditNotes}
              rows={4}
              placeholder="Add notes about this lead..."
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void saveLeadEdits()}>Save</Button>
              <Button tone="secondary" onClick={() => setEditingLead(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function AccountAnalyticsPage({ account }: { account: Agent }) {
  const [analytics, setAnalytics] = useState<AgentAnalytics | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSafety, setShowSafety] = useState(false)
  const [safetyMaxPerHour, setSafetyMaxPerHour] = useState('')
  const [safetyMaxPerDay, setSafetyMaxPerDay] = useState('')
  const [safetyMinDelay, setSafetyMinDelay] = useState('')
  const [safetyCooldown, setSafetyCooldown] = useState('')
  const [safetyEnabled, setSafetyEnabled] = useState(true)
  const [safetyHours, setSafetyHours] = useState('0')
  const [savingSafety, setSavingSafety] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const data = await agentsApi.fetchAgentAnalytics(account.id)
      setAnalytics(data)
      setSafetyMaxPerHour(String(data.safety?.max_actions_per_hour || ''))
      setSafetyMaxPerDay(String(data.safety?.max_messages_per_day || ''))
      setSafetyMinDelay(String(data.safety?.min_delay_seconds || ''))
      setSafetyCooldown(String(data.safety?.cooldown_minutes || ''))
      setSafetyEnabled(data.safety?.safety_mode_enabled ?? true)
      setSafetyHours('0')
      setStatus(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [account.id])

  async function saveSafety() {
    setSavingSafety(true)
    try {
      await agentsApi.updateAgentSafety(account.id, {
        max_actions_per_hour: safetyMaxPerHour ? Number(safetyMaxPerHour) : undefined,
        max_messages_per_day: safetyMaxPerDay ? Number(safetyMaxPerDay) : undefined,
        min_delay_seconds: safetyMinDelay ? Number(safetyMinDelay) : undefined,
        cooldown_minutes: safetyCooldown ? Number(safetyCooldown) : undefined,
        safety_mode_enabled: safetyEnabled,
        safety_mode_hours: Number(safetyHours),
      })
      setStatus('Safety settings saved')
      setShowSafety(false)
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save safety settings')
    } finally {
      setSavingSafety(false)
    }
  }

  if (loading) return <Card title="Analytics" subtitle="Loading agent statistics..."><Note>Loading...</Note></Card>

  const a = analytics
  const totalJobs = a?.jobs.total ?? 0
  const jobSuccessRate = totalJobs > 0 ? Math.round((a?.jobs.completed ?? 0) / totalJobs * 100) : 0
  const leadConversionRate = (a?.leads?.total ?? 0) > 0
    ? Math.round(((a?.leads?.by_status?.converted ?? 0) + (a?.leads?.by_status?.interested ?? 0)) / (a?.leads?.total ?? 1) * 100)
    : 0

  return (
    <Card title="Analytics" subtitle="Safety score, lead pipeline, and job metrics for this agent.">
      {status ? <Note>{status}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="secondary" onClick={() => void refresh()}>Refresh</Button>
        <Button onClick={() => setShowSafety(!showSafety)}>
          {showSafety ? 'Cancel' : 'Configure Safety'}
        </Button>
      </div>

      {showSafety ? (
        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 16, marginTop: 12 }}>
          <div style={{ fontWeight: 600 }}>Safety Configuration</div>
          <InputField
            label="Max actions per hour"
            value={safetyMaxPerHour}
            onChange={setSafetyMaxPerHour}
            type="number"
            placeholder="e.g. 20"
          />
          <InputField
            label="Max messages per day"
            value={safetyMaxPerDay}
            onChange={setSafetyMaxPerDay}
            type="number"
            placeholder="e.g. 500"
          />
          <InputField
            label="Min delay between actions (seconds)"
            value={safetyMinDelay}
            onChange={setSafetyMinDelay}
            type="number"
            placeholder="e.g. 5"
          />
          <InputField
            label="Cooldown after hitting limit (minutes)"
            value={safetyCooldown}
            onChange={setSafetyCooldown}
            type="number"
            placeholder="e.g. 15"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={safetyEnabled}
                onChange={(e) => setSafetyEnabled(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Safety mode enabled (first 48h)
            </label>
          </div>
          {safetyEnabled ? (
            <SelectField label="Safety mode duration" value={safetyHours} onChange={setSafetyHours}>
              <option value="0">Keep current</option>
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
              <option value="168">7 days</option>
            </SelectField>
          ) : null}
          <Button onClick={() => void saveSafety()} disabled={savingSafety}>
            {savingSafety ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--miniapp-primary)' }}>{a?.leads?.total ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>Total Leads</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#36664e' }}>{a?.leads?.by_status?.converted ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>Converted</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#475977' }}>{a?.jobs?.total ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>Total Jobs</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: a?.notifications?.unseen ? 'var(--miniapp-coral)' : 'var(--miniapp-sage)' }}>{a?.notifications?.unseen ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>Unseen Alerts</div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
          <div style={{ fontWeight: 600 }}>Safety Status</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Safety mode</span>
              <Badge tone={a?.safety?.safety_mode_enabled ? 'success' : 'warning'}>
                {a?.safety?.safety_mode_enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            {a?.safety?.safety_mode_until ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--miniapp-text-muted)' }}>Safe until</span>
                <span>{new Date(a.safety.safety_mode_until).toLocaleString()}</span>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Max actions/hr</span>
              <span>{a?.safety?.max_actions_per_hour || 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Max messages/day</span>
              <span>{a?.safety?.max_messages_per_day || 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Min delay</span>
              <span>{a?.safety?.min_delay_seconds ? `${a.safety.min_delay_seconds}s` : 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Cooldown</span>
              <span>{a?.safety?.cooldown_minutes ? `${a.safety.cooldown_minutes}m` : 'Not set'}</span>
            </div>
          </div>
        </div>

        {a?.leads ? (
          <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
            <div style={{ fontWeight: 600 }}>Lead Pipeline</div>
            {['new', 'contacted', 'interested', 'converted', 'junk', 'dismissed'].map((s) => {
              const count = a.leads.by_status[s] || 0
              const pct = a.leads.total > 0 ? Math.round((count / a.leads.total) * 100) : 0
              const t = _statusTone(s)
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    width: 80,
                    color: t.accent,
                  }}>
                    {s}
                  </span>
                  <div style={{ flex: 1, height: 20, background: 'var(--miniapp-bg-deep)', borderRadius: 10, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(pct, 2)}%`,
                      background: t.accent,
                      borderRadius: 10,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, width: 40, textAlign: 'right', color: 'var(--miniapp-text-muted)' }}>{count}</span>
                </div>
              )
            })}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
          <div style={{ fontWeight: 600 }}>Job Health</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Success rate</span>
              <Badge tone={jobSuccessRate >= 80 ? 'success' : jobSuccessRate >= 50 ? 'warning' : 'warning'}>
                {jobSuccessRate}%
              </Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Completed</span>
              <span style={{ color: '#36664e' }}>{a?.jobs?.completed ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Failed</span>
              <span style={{ color: 'var(--miniapp-clay)' }}>{a?.jobs?.failed ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>Pending</span>
              <span style={{ color: '#475977' }}>{a?.jobs?.pending ?? 0}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
          <div style={{ fontWeight: 600 }}>Conversion Rate</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--miniapp-primary)' }}>{leadConversionRate}%</div>
          <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>
            {(a?.leads?.by_status?.interested ?? 0)} interested + {(a?.leads?.by_status?.converted ?? 0)} converted of {a?.leads?.total ?? 0} total leads
          </div>
        </div>
      </div>
    </Card>
  )
}

function _statusTone(s: string) {
  const map: Record<string, { bg: string; border: string; accent: string }> = {
    new: { bg: 'rgba(71, 89, 119, 0.08)', border: 'rgba(71, 89, 119, 0.16)', accent: '#475977' },
    contacted: { bg: 'rgba(102, 115, 95, 0.08)', border: 'rgba(102, 115, 95, 0.16)', accent: '#66735f' },
    interested: { bg: 'rgba(54, 102, 78, 0.08)', border: 'rgba(54, 102, 78, 0.16)', accent: '#36664e' },
    converted: { bg: 'rgba(34, 139, 34, 0.08)', border: 'rgba(34, 139, 34, 0.20)', accent: '#228b22' },
    junk: { bg: 'rgba(161, 87, 62, 0.08)', border: 'rgba(161, 87, 62, 0.16)', accent: 'var(--miniapp-clay)' },
    dismissed: { bg: 'rgba(128, 128, 128, 0.08)', border: 'rgba(128, 128, 128, 0.16)', accent: '#808080' },
  }
  return map[s] || map['new']
}
