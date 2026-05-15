import { useEffect, useMemo, useState } from 'react'

import { MultiGroupSelect } from './components/MultiGroupSelect'
import { TableModal } from './components/TableModal'
import type { ColumnDef } from './components/DataTable'

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
  AgentGroupMemberMessagesPage,
  AgentGroupMembersPage,
  AgentLead,
  AgentLeadPage,
  AutomationTask,
  BulkPreflightResult,
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

const COUNTRY_CODES = [
  { dial: '966', label: 'SA', name: 'Saudi Arabia' },
  { dial: '971', label: 'AE', name: 'UAE' },
  { dial: '974', label: 'QA', name: 'Qatar' },
  { dial: '973', label: 'BH', name: 'Bahrain' },
  { dial: '965', label: 'KW', name: 'Kuwait' },
  { dial: '968', label: 'OM', name: 'Oman' },
  { dial: '967', label: 'YE', name: 'Yemen' },
  { dial: '962', label: 'JO', name: 'Jordan' },
  { dial: '20', label: 'EG', name: 'Egypt' },
  { dial: '212', label: 'MA', name: 'Morocco' },
  { dial: '213', label: 'DZ', name: 'Algeria' },
  { dial: '216', label: 'TN', name: 'Tunisia' },
  { dial: '1', label: 'US', name: 'United States' },
  { dial: '44', label: 'GB', name: 'United Kingdom' },
  { dial: '49', label: 'DE', name: 'Germany' },
  { dial: '33', label: 'FR', name: 'France' },
  { dial: '7', label: 'RU', name: 'Russia' },
  { dial: '86', label: 'CN', name: 'China' },
  { dial: '91', label: 'IN', name: 'India' },
  { dial: '81', label: 'JP', name: 'Japan' },
  { dial: '90', label: 'TR', name: 'Turkey' },
  { dial: '972', label: 'IL', name: 'Israel' },
  { dial: '961', label: 'LB', name: 'Lebanon' },
  { dial: '964', label: 'IQ', name: 'Iraq' },
  { dial: '963', label: 'SY', name: 'Syria' },
  { dial: '92', label: 'PK', name: 'Pakistan' },
  { dial: '93', label: 'AF', name: 'Afghanistan' },
  { dial: '218', label: 'LY', name: 'Libya' },
  { dial: '249', label: 'SD', name: 'Sudan' },
  { dial: '234', label: 'NG', name: 'Nigeria' },
  { dial: '254', label: 'KE', name: 'Kenya' },
  { dial: '251', label: 'ET', name: 'Ethiopia' },
  { dial: '381', label: 'RS', name: 'Serbia' },
  { dial: '998', label: 'UZ', name: 'Uzbekistan' },
]
const SCRAPE_LIMIT_MAX = 50000
const BULK_MESSAGE_TASK_KEY = 'group_member_broadcast'
const BULK_MESSAGE_TASK_META: TaskCatalogItem = {
  key: BULK_MESSAGE_TASK_KEY,
  title: 'Bulk message',
  description: 'Queue a worker job that sends a controlled bulk message through this linked agent.',
  executor_types: ['agent'],
}
const SCRAPE_TASK_KEY = 'scraper_full_group'
const SCRAPE_TASK_META: TaskCatalogItem = {
  key: SCRAPE_TASK_KEY,
  title: 'Database Scraper',
  description: 'Queue a background sync job that scrapes members and messages from a database-indexed group.',
  executor_types: ['agent'],
}
const JOB_TYPE_LABELS: Record<string, string> = {
  group_member_broadcast: 'Bulk message',
  scraper_full_group: 'Database Scraper',
  scraper_members: 'Scrape Members',
  scraper_messages: 'Scrape Messages',
  scraper_group_info: 'Scrape Group Info',
  add_contact: 'Add Contact',
  send_lead_message: 'Send Lead Message',
  automation_task: 'Automation Task',
}

function _parseKeywords(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (!raw) return []
  return String(raw).split(',').map((k) => k.trim()).filter(Boolean)
}

function _formatKeywords(keywords: string[]): string {
  return keywords.join(',')
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
  onRedeemComplete,
}: {
  status: SubscriptionStatusInfo | null
  onRedeemed: (info: SubscriptionStatusInfo) => void
  onRedeemComplete?: () => void
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
      const info: SubscriptionStatusInfo = {
        status: 'active',
        plan: result.plan as 'pro' | 'business' | null,
        expires_at: result.expires_at,
      }
      setSuccess(result.message)
      setCode('')
      onRedeemed(info)
      onRedeemComplete?.()
    } catch (err: any) {
      const msg = err.message || 'Failed to redeem code'

      if (msg.includes('already redeemed') || msg.includes('already promoted')) {
        setSuccess('Promotion already active.')
        setError(null)
        try {
          const freshStatus = await agentsApi.fetchSubscriptionStatus()
          onRedeemed(freshStatus)
          onRedeemComplete?.()
        } catch {
          setError('Failed to refresh subscription status')
        }
      } else {
        setError(msg)
      }
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
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel() {
    if (!isActive || cancelling) return
    setCancelling(true)
    try {
      await agentsApi.cancelSubscription()
      onRedeemed({ status: 'inactive', plan: null, expires_at: null })
    } catch (err: any) {
      setError(err.message || 'Failed to cancel subscription')
    } finally {
      setCancelling(false)
    }
  }

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
        {isActive && (
          <div style={{ marginTop: 4 }}>
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              style={{
                border: 'none', background: 'transparent', cursor: cancelling ? 'default' : 'pointer',
                color: 'var(--miniapp-clay)', fontSize: 12, fontWeight: 600, padding: 0,
                fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline',
                opacity: cancelling ? 0.5 : 1,
              }}
            >
              {cancelling ? 'Cancelling...' : 'Cancel subscription'}
            </button>
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

      <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
        {isActive && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text)' }}>Upgrade or extend your plan:</div>
        )}
        {!isActive && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text)' }}>Or pay with Stripe:</div>
        )}
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

      {!isActive && (
        <div style={{ fontSize: 13, color: 'var(--miniapp-text-secondary)', display: 'grid', gap: 8 }}>
          <strong>Subscribing gives you access to:</strong>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            <li>Linking multiple Telegram accounts as agents</li>
            <li>Running background member scraping jobs</li>
            <li>Automated broadcasts and member messaging</li>
            <li>Real-time agent notifications</li>
          </ul>
        </div>
      )}
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

        <SubscriptionForm status={status} onRedeemed={onRedeemed} onRedeemComplete={onClose} />
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
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          background: 'var(--miniapp-surface)',
          border: '1px solid var(--miniapp-border-soft)',
          borderRadius: 20,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ padding: '24px 24px 0 24px', display: 'grid', gap: 12 }}>
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
        </div>
        <div style={{ overflow: 'auto', padding: 24, display: 'grid', gap: 16 }}>
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
      ) : null}
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
  syncButton,
}: {
  label: string
  query: string
  onQueryChange: (value: string) => void
  groups: AgentManagedGroup[]
  selectedGroup: SelectedGroupChip | null
  onSelect: (group: SelectedGroupChip) => void
  onClear: () => void
  syncButton?: React.ReactNode
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
          <button type="button" onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: '18px', color: 'var(--miniapp-clay)', padding: '4px' }} title="Clear">✕</button>
          {syncButton}
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
      label: 'Leads',
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
  const [subscriptionExpanded, setSubscriptionExpanded] = useState(false)
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('paid') === '1') {
      void refresh()
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

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
            <Card
              title="Subscription"
              subtitle={`${subscription?.status === 'active' ? `${subscription?.plan === 'business' ? 'Business' : 'Pro'} · Active` : 'No active subscription'}`}
            >
              <div style={{ display: 'grid', gap: 0 }}>
                <button
                  type="button"
                  onClick={() => setSubscriptionExpanded(!subscriptionExpanded)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    padding: 0, border: 'none', background: 'transparent', cursor: 'pointer',
                    color: 'var(--miniapp-text-muted)', fontSize: 12, fontFamily: 'var(--miniapp-sans)', fontWeight: 600,
                  }}
                >
                  <span>{subscriptionExpanded ? 'Hide details' : 'Show details'}</span>
                  <span style={{ transform: subscriptionExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: 14 }}>▾</span>
                </button>
                {subscriptionExpanded && (
                  <div style={{ marginTop: 12 }}>
                    <SubscriptionForm
                      key={subscription?.status}
                      status={subscription}
                      onRedeemed={(info) => setSubscription(info)}
                    />
                  </div>
                )}
              </div>
            </Card>
            {subscription?.status === 'active' ? (
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
            ) : null}
            {subscription?.status === 'active' ? <MCPTokensCard /> : null}
          </>
        ) : null}
        {appReady && isAuthenticated && !isWizardInProgress && route.page !== 'settings' ? (
          selectedAccount && selectedAccount.auth_state === 'active' && selectedAccount.status === 'active' ? (
            <>
              {route.page === 'dashboard' ? (
                <>
                  <TaskActivity account={selectedAccount} />
                  <AccountAnalyticsPage account={selectedAccount} />
                </>
              ) : null}
              {route.page === 'tasks' ? (
                <AccountTasksPage account={selectedAccount} onSaved={setStatus} />
              ) : null}
              {route.page === 'groups' ? (
                <AccountLeadsPage account={selectedAccount} />
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
        onRedeemed={(info) => setSubscription(info)}
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

function MCPTokensCard() {
  const [tokens, setTokens] = useState<agentsApi.MCPTokenData[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [expiryDays, setExpiryDays] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadTokens() {
    setLoading(true)
    try {
      setTokens(await agentsApi.listMCPTokens())
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { void loadTokens() }, [])

  async function handleCreate() {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    setCreatedToken(null)
    try {
      const result = await agentsApi.createMCPToken(name.trim(), expiryDays ? Number(expiryDays) : undefined)
      setCreatedToken(result.token)
      setName('')
      setExpiryDays('')
      await loadTokens()
    } catch (err: any) {
      setError(err.message || 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: number) {
    try {
      await agentsApi.revokeMCPToken(id)
      await loadTokens()
    } catch { /* ignore */ }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = token
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }

  const statusBadge = (s: string) => {
    if (s === 'active') return <Badge tone="success">Active</Badge>
    if (s === 'expired') return <Badge tone="warning">Expired</Badge>
    return <Badge tone="neutral">Revoked</Badge>
  }

  return (
    <Card title="MCP Tokens" subtitle="API tokens for external MCP access">
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? (
          <Note>Loading tokens...</Note>
        ) : tokens.length === 0 ? (
          <Note>No tokens yet.</Note>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {tokens.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', border: '1px solid var(--miniapp-border-soft)',
                  borderRadius: 12, background: 'var(--miniapp-surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div style={{ color: 'var(--miniapp-text-muted)', fontSize: 11, marginTop: 2 }}>
                    <code style={{ fontFamily: 'var(--miniapp-mono)', fontSize: 11 }}>{t.prefix}...</code>
                    {' · '}created {t.created_at ? new Date(t.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statusBadge(t.status)}
                  {t.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => void handleRevoke(t.id)}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: 'var(--miniapp-clay)', fontSize: 12, fontWeight: 600,
                        padding: '4px 8px', borderRadius: 6, fontFamily: 'var(--miniapp-sans)',
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {createdToken && (
          <div style={{
            padding: 12, borderRadius: 12, border: '1px solid var(--miniapp-sage-border)',
            background: 'var(--miniapp-sage-dim)', display: 'grid', gap: 8,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-sage)' }}>Token created — copy it now (will not be shown again)</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                readOnly
                value={createdToken}
                style={{
                  flex: 1, background: 'var(--miniapp-bg)', border: '1px solid var(--miniapp-border-soft)',
                  borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--miniapp-mono)', fontSize: 12,
                  color: 'var(--miniapp-text-primary)', outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => void copyToken(createdToken)}
                style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--miniapp-sage-border)',
                  background: 'var(--miniapp-surface)', cursor: 'pointer', fontWeight: 600, fontSize: 12,
                  color: 'var(--miniapp-sage)', fontFamily: 'var(--miniapp-sans)', whiteSpace: 'nowrap',
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {showCreate ? (
          <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12 }}>
            <InputField label="Token name" value={name} onChange={setName} placeholder="My API token" />
            <InputField label="Expires in (days, optional)" value={expiryDays} onChange={(v) => setExpiryDays(v.replace(/\D/g, ''))} placeholder="Leave empty for no expiry" />
            {error && <Note tone="warning">{error}</Note>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void handleCreate()} disabled={creating || !name.trim()}>
                {creating ? 'Creating...' : 'Create token'}
              </Button>
              <Button tone="secondary" onClick={() => { setShowCreate(false); setError(null) }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => { setShowCreate(true); setCreatedToken(null); setError(null) }}>Create token</Button>
        )}
      </div>
    </Card>
  )
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
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--miniapp-bg)',
    border: '1px solid var(--miniapp-border-soft)',
    borderRadius: 'var(--miniapp-radius-sm)',
    padding: '11px 12px',
    fontFamily: 'var(--miniapp-sans)',
    fontSize: 13,
    color: 'var(--miniapp-text-primary)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const dialMatch = COUNTRY_CODES.find((c) => phoneNumber.replace(/\D/g, '').startsWith(c.dial))
  const [countryIndex, setCountryIndex] = useState(() =>
    dialMatch ? COUNTRY_CODES.indexOf(dialMatch) : 0,
  )
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = COUNTRY_CODES[countryIndex]
  const digits = phoneNumber.replace(/\D/g, '')
  const nationalDigits = digits.startsWith(selected.dial) ? digits.slice(selected.dial.length) : digits

  function formatNational(d: string) {
    const parts: string[] = []
    for (let i = 0; i < d.length; i += 3) {
      parts.push(d.slice(i, i + 3))
    }
    return parts.join(' ')
  }

  function handleNationalChange(raw: string) {
    const d = raw.replace(/\D/g, '')
    onPhoneNumberChange(`+${selected.dial}${d}`)
  }

  function selectCountry(idx: number) {
    setCountryIndex(idx)
    setOpen(false)
    setSearch('')
    const c = COUNTRY_CODES[idx]
    const currentDigits = phoneNumber.replace(/\D/g, '')
    const national = currentDigits.startsWith(selected.dial) ? currentDigits.slice(selected.dial.length) : currentDigits
    onPhoneNumberChange(`+${c.dial}${national}`)
  }

  const filtered = COUNTRY_CODES.filter(
    (c) =>
      c.dial.includes(search) ||
      c.label.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>
          Phone number
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              style={{
                ...inputStyle,
                display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                padding: '11px 10px', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >
              <span style={{ fontWeight: 600 }}>+{selected.dial}</span>
              <span style={{ fontSize: 9, color: 'var(--miniapp-text-muted)', lineHeight: 1 }}>▾</span>
            </button>
            {open && (
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, zIndex: 20, minWidth: 220,
                  background: 'var(--miniapp-surface)', border: '1px solid var(--miniapp-border-soft)',
                  borderRadius: 10, boxShadow: 'var(--miniapp-shadow-lg)', maxHeight: 220, overflow: 'auto',
                  marginTop: 4,
                  display: 'grid', gridTemplateRows: 'auto 1fr',
                }}
              >
                <input
                  type="text"
                  placeholder="Search country..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inputStyle, border: 'none', borderBottom: '1px solid var(--miniapp-border-soft)', borderRadius: 0, padding: '10px 12px' }}
                  autoFocus
                />
                <div style={{ overflow: 'auto' }}>
                  {filtered.length ? filtered.map((c) => (
                    <button
                      key={c.dial}
                      type="button"
                      onClick={() => selectCountry(COUNTRY_CODES.indexOf(c))}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
                        border: 'none', background: c.dial === selected.dial ? 'var(--miniapp-coral-dim)' : 'transparent',
                        cursor: 'pointer', fontSize: 13, color: 'var(--miniapp-text-primary)', textAlign: 'left',
                        fontFamily: 'var(--miniapp-sans)',
                      }}
                    >
                      <span style={{ minWidth: 28, fontWeight: 600 }}>{c.label}</span>
                      <span style={{ color: 'var(--miniapp-text-muted)', fontFamily: 'var(--miniapp-mono)', fontSize: 12 }}>+{c.dial}</span>
                      <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 11, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    </button>
                  )) : (
                    <div style={{ padding: '10px 12px', color: 'var(--miniapp-text-muted)', fontSize: 12 }}>No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <input
              type="text"
              inputMode="numeric"
              value={formatNational(nationalDigits)}
              placeholder={'_ _ _  _ _ _  _ _ _'}
              onChange={(e) => handleNationalChange(e.target.value)}
              style={{
                ...inputStyle,
                fontFamily: 'var(--miniapp-mono)',
                letterSpacing: '1px',
              }}
            />
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: -4, marginBottom: 8 }}>
          Enter your Telegram account phone number
        </div>
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={onLink} disabled={isLinking || !phoneNumber.replace(/\D/g, '')}>
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

function SecretInputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--miniapp-text-muted)' }}>{label}</span>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            background: 'var(--miniapp-bg)',
            border: '1px solid var(--miniapp-border-soft)',
            borderRadius: 'var(--miniapp-radius-sm)',
            padding: '11px 44px 11px 12px',
            fontFamily: 'var(--miniapp-mono)',
            fontSize: 13,
            color: 'var(--miniapp-text-primary)',
            outline: 'none',
            boxSizing: 'border-box',
            letterSpacing: '0.5px',
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible(!visible)}
          style={{
            position: 'absolute', right: 0, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 38, border: 'none', background: 'transparent',
            cursor: 'pointer', color: 'var(--miniapp-text-muted)',
            fontSize: 12, fontWeight: 600, fontFamily: 'var(--miniapp-sans)',
            padding: 0,
          }}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  )
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
      <SecretInputField label="Login code" value={code} onChange={setCode} placeholder="Enter the code sent to Telegram" />
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
  onCancel,
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
      <SecretInputField label="Password / 2FA" value={password} onChange={setPassword} placeholder="Enter your Telegram 2FA password" />
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
  const [taskKeywords, setTaskKeywords] = useState<string[]>([])
  const [pendingKeyword, setPendingKeyword] = useState('')
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
  const [bulkTargetType, setBulkTargetType] = useState<'members' | 'groups'>('members')
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkThreshold, setBulkThreshold] = useState('25')
  const [bulkIntervalSeconds, setBulkIntervalSeconds] = useState('5')
  const [bulkTargetGroupQuery, setBulkTargetGroupQuery] = useState('')
  const [bulkTargetGroups, setBulkTargetGroups] = useState<AgentManagedGroup[]>([])
  const [loadingBulkTargetGroups, setLoadingBulkTargetGroups] = useState(false)
  const [bulkSelectedTargetGroups, setBulkSelectedTargetGroups] = useState<SelectedGroupChip[]>([])
  const [bulkMemberQuery, setBulkMemberQuery] = useState('')
  const [bulkMemberResults, setBulkMemberResults] = useState<AgentGroupMember[]>([])
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<AgentGroupMember[]>([])
  const [bulkMemberStatus, setBulkMemberStatus] = useState<string | null>(null)
  const [loadingBulkMembers, setLoadingBulkMembers] = useState(false)
  const [excludeAdmins, setExcludeAdmins] = useState(true)
  const [excludeBots, setExcludeBots] = useState(true)
  const [excludeSent, setExcludeSent] = useState(true)
  const [showFiltersOpen, setShowFiltersOpen] = useState(false)
  const [orderByMsgCount, setOrderByMsgCount] = useState<'desc' | 'asc'>('desc')
  const [bulkMemberPage, setBulkMemberPage] = useState(1)
  const [bulkMemberTotal, setBulkMemberTotal] = useState(0)
  const [syncingAdminsBots, setSyncingAdminsBots] = useState(false)
  const [scrapingGroup, setScrapingGroup] = useState(false)
  const [syncAdminsBotsStatus, setSyncAdminsBotsStatus] = useState<string | null>(null)
  const [bulkSummary, setBulkSummary] = useState<BulkPreflightResult | null>(null)
  const [loadingBulkSummary, setLoadingBulkSummary] = useState(false)
  const [scrapeGroups, setScrapeGroups] = useState<AgentManagedGroup[]>([])
  const [scrapeSelectedGroup, setScrapeSelectedGroup] = useState<AgentManagedGroup | null>(null)
  const [scrapeGroupQuery, setScrapeGroupQuery] = useState('')
  const [scrapeMemberLimit, setScrapeMemberLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [scrapeMessageLimit, setScrapeMessageLimit] = useState(String(SCRAPE_LIMIT_MAX))
  const [scrapeMaxAgeDays, setScrapeMaxAgeDays] = useState('30')
  const [loadingScrapeGroups, setLoadingScrapeGroups] = useState(false)
  const [leadAckTemplate, setLeadAckTemplate] = useState('')
  const [leadLabel, setLeadLabel] = useState('')
  const [leadAskContact, setLeadAskContact] = useState(false)

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
  const groupQuery = (bulkSourceGroupQuery || bulkTargetGroupQuery || taskDestinationGroupQuery || taskGroupsQuery).trim()
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
    const normalized = scrapeGroupQuery.trim()
    if (!normalized || taskKey !== SCRAPE_TASK_KEY) {
      setScrapeGroups([])
      setLoadingScrapeGroups(false)
      return
    }
    const timer = setTimeout(() => {
      setLoadingScrapeGroups(true)
      void agentsApi.fetchAgentGroups(account.id, normalized)
        .then((payload) => setScrapeGroups(payload))
        .catch(() => setScrapeGroups([]))
        .finally(() => setLoadingScrapeGroups(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [account.id, scrapeGroupQuery, taskKey])

  useEffect(() => {
    if (!catalog.length) {
      return
    }
    if (![...catalog, BULK_MESSAGE_TASK_META, SCRAPE_TASK_META].some((item) => item.key === taskKey)) {
      setTaskKey(catalog[0].key)
    }
  }, [catalog, taskKey])

  function resetForm() {
    setEditingTask(null)
    setTaskKey(catalog[0]?.key || 'reply_message')
    setTaskKeyword('')
    setTaskKeywords([])
    setPendingKeyword('')
    setTaskTemplate('')
    setTaskReplyMode('public')
    setTaskDeliveryMode('text')
    setTaskDestinationMode('group')
    setTaskDestinationText('')
    setTaskDestinationGroupQuery('')
    setTaskDestinationGroup(null)
    setTaskGroupsQuery('')
    setTaskGroups([])
    setBulkTargetType('members')
    setBulkSourceGroupQuery('')
    setBulkSourceGroup(null)
    setBulkMessage('')
    setBulkThreshold('25')
    setBulkIntervalSeconds('1')
    setBulkTargetGroupQuery('')
    setBulkTargetGroups([])
    setBulkSelectedTargetGroups([])
    setBulkMemberQuery('')
    setBulkMemberResults([])
    setBulkSelectedMembers([])
    setBulkMemberStatus(null)
    setExcludeAdmins(false)
    setExcludeBots(false)
    setScrapeGroupQuery('')
    setScrapeSelectedGroup(null)
    setScrapeGroups([])
    setScrapeMemberLimit(String(SCRAPE_LIMIT_MAX))
    setScrapeMessageLimit(String(SCRAPE_LIMIT_MAX))
    setScrapeMaxAgeDays('30')
    setLeadAckTemplate('')
    setLeadLabel('')
    setLeadAskContact(false)
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
    setTaskKeywords(task.task_key === 'lead_capture' ? _parseKeywords(task.conditions.text_contains) : [])
    setPendingKeyword('')
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
    setBulkTargetType('members')
    setBulkSourceGroupQuery('')
    setBulkSourceGroup(null)
    setBulkMessage('')
    setBulkThreshold('25')
    setBulkIntervalSeconds('1')
    setBulkTargetGroupQuery('')
    setBulkTargetGroups([])
    setBulkSelectedTargetGroups([])
    setBulkMemberQuery('')
    setBulkMemberResults([])
    setBulkSelectedMembers([])
    setBulkMemberStatus(null)
    setExcludeAdmins(false)
    setExcludeBots(false)
    setLeadAckTemplate(task.task_key === 'lead_capture' ? String(task.config.ack_template || '') : '')
    setLeadLabel(task.task_key === 'lead_capture' ? String(task.config.lead_label || '') : '')
    setLeadAskContact(task.task_key === 'lead_capture' ? Boolean(task.config.ask_contact) : false)
    setIsFormOpen(true)
  }

  function closeForm() {
    setIsFormOpen(false)
    resetForm()
  }

  useEffect(() => {
    if (taskKey !== BULK_MESSAGE_TASK_KEY || !bulkSourceGroup?.tg_group_id) {
      setBulkMemberResults([])
      setBulkMemberTotal(0)
      setBulkMemberStatus(null)
      setLoadingBulkMembers(false)
      return
    }

    const query = bulkMemberQuery.trim()

    let cancelled = false
    setLoadingBulkMembers(true)
    setBulkMemberStatus(null)
    void agentsApi.searchAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id, query || undefined, 20, excludeBots, bulkMemberPage, orderByMsgCount === 'asc' ? 'message_count_asc' : 'message_count', excludeAdmins, false)
      .then((page) => {
        if (cancelled) {
          return
        }
        const members = Array.isArray(page?.members) ? page.members : []
        const selectedIds = new Set(bulkSelectedMembers.map((member) => member.user_id))
        const filteredMembers = members.filter((member) => !selectedIds.has(member.user_id))
        setBulkMemberResults(filteredMembers)
        setBulkMemberTotal(page.total)
        setBulkMemberStatus(filteredMembers.length ? null : 'No matching members found.')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setBulkMemberResults([])
        setBulkMemberTotal(0)
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
  }, [account.id, bulkMemberQuery, bulkSelectedMembers, bulkSourceGroup, taskKey, bulkMemberPage, orderByMsgCount])

  async function saveTask() {
    if (taskKey === SCRAPE_TASK_KEY) {
      if (!scrapeSelectedGroup?.tg_group_id) {
        setStatus('Choose a group first')
        return
      }
      const targetGroupId = Number(scrapeSelectedGroup.tg_group_id)
      setIsSaving(true)
      try {
        await agentsApi.createAgentJob(account.id, SCRAPE_TASK_KEY, {
          tg_group_id: targetGroupId,
          scrape_members: true,
          scrape_messages: true,
          member_limit: clampScrapeLimit(scrapeMemberLimit),
          message_limit: clampScrapeLimit(scrapeMessageLimit),
          max_age_days: Math.max(1, Number(scrapeMaxAgeDays) || 30),
        })
        closeForm()
        setStatus(null)
        onSaved(`Scraping job queued for ${scrapeSelectedGroup.title || targetGroupId}.`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to queue scrape job')
      } finally {
        setIsSaving(false)
      }
      return
    }

    if (taskKey === BULK_MESSAGE_TASK_KEY) {
      if (!bulkMessage.trim()) {
        setStatus('Bulk message text is required')
        return
      }
      if (bulkTargetType === 'members' && !bulkSourceGroup?.tg_group_id) {
        setStatus('Source group is required for bulk message to members')
        return
      }
      if (bulkTargetType === 'groups' && !bulkSelectedTargetGroups.length) {
        setStatus('At least one target group is required')
        return
      }

      const threshold = Number.parseInt(bulkThreshold, 10)
      if (!Number.isFinite(threshold) || threshold <= 0) {
        setStatus('Threshold must be a positive integer')
        return
      }

      const intervalSeconds = Number.parseFloat(bulkIntervalSeconds)
      if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
        setStatus('Interval seconds must be 0 or more')
        return
      }

      if (bulkSummary) {
        setIsSaving(true)
        try {
          const jobPayload: Record<string, unknown> = {
            target_type: bulkTargetType,
            message: bulkMessage.trim(),
            threshold,
            interval_seconds: intervalSeconds,
          }
          if (bulkTargetType === 'members') {
            jobPayload.source_group_id = bulkSourceGroup!.tg_group_id
            jobPayload.source_group_title = bulkSourceGroup!.title
            jobPayload.selected_user_ids = bulkSummary.filtered_user_ids
          } else {
            jobPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id)
          }
          await agentsApi.createAgentJob(account.id, BULK_MESSAGE_TASK_KEY, jobPayload)
          setBulkSummary(null)
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

      setLoadingBulkSummary(true)
      setStatus(null)
      try {
        const preflightPayload: Record<string, unknown> = {
          target_type: bulkTargetType,
          message: bulkMessage.trim(),
          threshold,
          interval_seconds: intervalSeconds,
        }
        if (bulkTargetType === 'members') {
          preflightPayload.source_group_id = bulkSourceGroup!.tg_group_id
          preflightPayload.source_group_title = bulkSourceGroup!.title
          preflightPayload.selected_user_ids = bulkSelectedMembers.map((member) => member.user_id)
        } else {
          preflightPayload.target_group_ids = bulkSelectedTargetGroups.map((g) => g.tg_group_id)
        }
        const result = await agentsApi.preflightBulkMessage(account.id, preflightPayload)
        setBulkSummary(result)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Failed to prepare bulk message')
      } finally {
        setLoadingBulkSummary(false)
      }
      return
    }

    if (taskKey === 'lead_capture') {
      if (!taskKeywords.length) {
        setStatus('At least one keyword is required for lead capture')
        return
      }
      const config: Record<string, unknown> = {}
      if (leadAckTemplate.trim()) {
        config.ack_template = leadAckTemplate.trim()
      }
      if (leadLabel.trim()) {
        config.lead_label = leadLabel.trim()
      }
      if (leadAskContact) {
        config.ask_contact = true
      }
      const payload = {
        task_key: taskKey,
        executor_type: 'agent',
        enabled: true,
        conditions: { text_contains: _formatKeywords(taskKeywords) },
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

  const extendedCatalog = useMemo(() => (catalog.length ? [...catalog, BULK_MESSAGE_TASK_META, SCRAPE_TASK_META] : []), [catalog])
  const selectedTaskMeta = extendedCatalog.find((item) => item.key === taskKey) ?? null
  const isBulkMessageTask = taskKey === BULK_MESSAGE_TASK_KEY
  const isScrapeTask = taskKey === SCRAPE_TASK_KEY
  const isLeadCaptureTask = taskKey === 'lead_capture'

  return (
    <Card title="Tasks" subtitle="Select a task type and save it against this account group.">
      {status ? <Note>{status}</Note> : null}
      {!isFormOpen ? <Button onClick={openCreateForm}>New task</Button> : null}
      {isFormOpen ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <SelectField label="Task type" value={taskKey} onChange={setTaskKey}>
            {extendedCatalog.map((item) => (
              <option key={item.key} value={item.key}>{item.title}</option>
            ))}
          </SelectField>
          {isScrapeTask ? (
            <>
              <InputField label="Find group to scrape" value={scrapeGroupQuery} onChange={setScrapeGroupQuery} placeholder="Type group title or ID" />
              {loadingScrapeGroups ? <Note>Searching database...</Note> : null}
              {!loadingScrapeGroups && scrapeGroups.length ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {scrapeGroups.map((group, index) => (
                    <LinkRow
                      key={`${group.tg_group_id ?? index}-${group.title ?? index}`}
                      active={scrapeSelectedGroup?.tg_group_id === group.tg_group_id}
                      onClick={() => {
                        setScrapeSelectedGroup(group)
                        setScrapeGroupQuery(group.title || '')
                      }}
                    >
                      <strong>{group.title || `Group ${group.tg_group_id ?? index}`}</strong>
                      <div style={{ color: '#655d52', marginTop: 4 }}>
                        {group.tg_group_id ?? 'no tg id'} · members {group.member_count ?? 0}
                      </div>
                    </LinkRow>
                  ))}
                </div>
              ) : null}
              {scrapeSelectedGroup ? (
                <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                  <InputField label="Max members to scrape" value={scrapeMemberLimit} onChange={setScrapeMemberLimit} type="number" />
                  <InputField label="Max messages to scrape" value={scrapeMessageLimit} onChange={setScrapeMessageLimit} type="number" />
                  <InputField label="Max message age in days" value={scrapeMaxAgeDays} onChange={setScrapeMaxAgeDays} type="number" />
                </div>
              ) : null}
            </>
          ) : isBulkMessageTask ? (
            <>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--miniapp-bg)', borderRadius: 10, border: '1px solid var(--miniapp-border-soft)' }}>
                <button
                  type="button"
                  onClick={() => { setBulkTargetType('members'); setBulkSummary(null) }}
                  style={{
                    flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
                    background: bulkTargetType === 'members' ? 'var(--miniapp-surface)' : 'transparent',
                    color: bulkTargetType === 'members' ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)',
                    fontWeight: bulkTargetType === 'members' ? 600 : 400, fontSize: 13,
                    fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  Send to Members
                </button>
                <button
                  type="button"
                  onClick={() => { setBulkTargetType('groups'); setBulkSummary(null) }}
                  style={{
                    flex: 1, padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
                    background: bulkTargetType === 'groups' ? 'var(--miniapp-surface)' : 'transparent',
                    color: bulkTargetType === 'groups' ? 'var(--miniapp-text-primary)' : 'var(--miniapp-text-muted)',
                    fontWeight: bulkTargetType === 'groups' ? 600 : 400, fontSize: 13,
                    fontFamily: 'var(--miniapp-sans)',
                  }}
                >
                  Send to Groups
                </button>
              </div>
              {bulkTargetType === 'members' ? (
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
                      setBulkMemberTotal(0)
                      setBulkSelectedMembers([])
                      setBulkMemberStatus(null)
                    }}
                    onClear={() => {
                      setBulkSourceGroup(null)
                      setBulkSourceGroupQuery('')
                      setBulkMemberQuery('')
                      setBulkMemberResults([])
                      setBulkMemberTotal(0)
                      setBulkSelectedMembers([])
                      setBulkMemberStatus(null)
                    }}
                    syncButton={
                      <button
                        type="button"
                        disabled={syncingAdminsBots}
                        onClick={async () => {
                          if (!account || !bulkSourceGroup) return
                          setSyncingAdminsBots(true)
                          setSyncAdminsBotsStatus(null)
                          try {
                            const result = await agentsApi.syncAgentGroupAdminsBots(account.id, bulkSourceGroup.tg_group_id)
                            setSyncAdminsBotsStatus(result.message || 'Sync completed')
                          } catch (error) {
                            setSyncAdminsBotsStatus(error instanceof Error ? error.message : 'Sync failed')
                          } finally {
                            setSyncingAdminsBots(false)
                          }
                        }}
                        style={{
                          background: 'var(--miniapp-bg)',
                          color: 'var(--miniapp-text-primary)',
                          border: '1px solid var(--miniapp-border-soft)',
                          borderRadius: 12,
                          padding: '10px 12px',
                          fontSize: 18,
                          lineHeight: '18px',
                          cursor: syncingAdminsBots ? 'default' : 'pointer',
                          opacity: syncingAdminsBots ? 0.6 : 1,
                        }}
                      >
                        {syncingAdminsBots ? '…' : '↻'}
                      </button>
                    }
                  />
                  {syncAdminsBotsStatus ? (
                    <Note>{syncAdminsBotsStatus}</Note>
                  ) : null}
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
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {bulkSelectedMembers.length ? (
                      <button
                        type="button"
                        onClick={() => setBulkSelectedMembers([])}
                        style={{
                          background: 'var(--miniapp-bg)',
                          color: 'var(--miniapp-text-primary)',
                          border: '1px solid var(--miniapp-border-soft)',
                          borderRadius: 12,
                          padding: '8px 10px',
                          fontSize: 16,
                          lineHeight: '18px',
                          cursor: 'pointer',
                        }}
                        title={`Clear selected (${bulkSelectedMembers.length})`}
                      >
                        ✕ {bulkSelectedMembers.length}
                      </button>
                    ) : null}
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
                        {member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: 'var(--miniapp-coral)', color: '#fff', fontSize: 9, fontWeight: 700 }}>Owner</span> : null}
                        {member.is_admin && !member.is_creator ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#5b8def', color: '#fff', fontSize: 9, fontWeight: 700 }}>Admin</span> : null}
                        {member.is_bot ? <span style={{ padding: '0px 5px', borderRadius: 999, background: '#8b8b8b', color: '#fff', fontSize: 9, fontWeight: 700 }}>Bot</span> : null}
                        {member.sent_by_agent ? <span style={{ color: 'var(--miniapp-sage)', fontSize: 10, fontWeight: 700 }}>✓</span> : null}
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
                    )) : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--miniapp-clay)' }}>
                    <span>Sort by messages:</span>
                    <button
                      type="button"
                      onClick={() => setOrderByMsgCount(orderByMsgCount === 'asc' ? 'desc' : 'asc')}
                      style={{
                        background: 'none',
                        border: '1px solid var(--miniapp-border-soft)',
                        borderRadius: 8,
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: 'var(--miniapp-text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {orderByMsgCount === 'desc' ? '↓ Most' : '↑ Least'}
                    </button>
                  </div>
                  {bulkSourceGroup && !loadingBulkMembers && bulkMemberTotal === 0 && !bulkMemberQuery.trim() ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, color: 'var(--miniapp-clay)' }}>No scraped members yet.</div>
                      <Button
                        tone="secondary"
                        disabled={scrapingGroup}
                        onClick={async () => {
                          setScrapingGroup(true)
                          try {
                            await agentsApi.scrapeAgentGroupMembers(account.id, bulkSourceGroup.tg_group_id)
                            setBulkMemberQuery(' ')
                          } catch (error) {
                            setBulkMemberStatus(error instanceof Error ? error.message : 'Scrape failed')
                          } finally {
                            setScrapingGroup(false)
                          }
                        }}
                      >
                        {scrapingGroup ? 'Scraping...' : 'Scrape group'}
                      </Button>
                      <div style={{ fontSize: 12, color: 'var(--miniapp-clay)' }}>
                        This may take a few minutes.
                      </div>
                    </div>
                  ) : null}
                  {loadingBulkMembers ? <Note>Searching members...</Note> : null}
                  {bulkMemberStatus ? <Note>{bulkMemberStatus}</Note> : null}
                  {!loadingBulkMembers && bulkMemberResults.length ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button
                          tone="secondary"
                          onClick={() => {
                            const candidates = bulkMemberResults.filter((m) => !(excludeAdmins && (m.is_admin || m.is_creator)) && !(excludeBots && m.is_bot) && !(excludeSent && m.sent_by_agent))
                            setBulkSelectedMembers((current) => {
                              const next = [...current]
                              candidates.forEach((member) => {
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
                        <button
                          type="button"
                          onClick={() => setShowFiltersOpen(!showFiltersOpen)}
                          style={{
                            background: showFiltersOpen || !excludeAdmins || !excludeBots || !excludeSent ? 'var(--miniapp-coral)' : 'var(--miniapp-bg)',
                            color: showFiltersOpen || !excludeAdmins || !excludeBots || !excludeSent ? '#fff' : 'var(--miniapp-text-primary)',
                            border: '1px solid var(--miniapp-border-soft)',
                            borderRadius: 12,
                            padding: '10px 12px',
                            fontSize: 16,
                            lineHeight: '18px',
                            cursor: 'pointer',
                          }}
                          title="Filters"
                        >
                          ☰
                        </button>
                        {showFiltersOpen ? (
                          <div style={{ display: 'grid', gap: 4, width: '100%', padding: '4px 0' }}>
                            {[
                              { label: 'Exclude admins', checked: excludeAdmins, toggle: () => setExcludeAdmins(!excludeAdmins) },
                              { label: 'Exclude bots', checked: excludeBots, toggle: () => setExcludeBots(!excludeBots) },
                              { label: 'Exclude sent', checked: excludeSent, toggle: () => setExcludeSent(!excludeSent) },
                            ].map((item) => (
                              <div
                                key={item.label}
                                onClick={item.toggle}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '6px 4px',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                  lineHeight: '18px',
                                  color: 'var(--miniapp-text-primary)',
                                }}
                              >
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: 4,
                                    border: '2px solid',
                                    borderColor: item.checked ? 'var(--miniapp-coral)' : 'var(--miniapp-border-soft)',
                                    background: item.checked ? 'var(--miniapp-coral)' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#fff',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    flexShrink: 0,
                                  }}
                                >
                                  {item.checked ? '✓' : ''}
                                </span>
                                {item.label}
                              </div>
                            ))}
                          </div>
                        ) : null}
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
                        {(() => {
                          const filtered = bulkMemberResults.filter((m) => !(excludeAdmins && (m.is_admin || m.is_creator)) && !(excludeBots && m.is_bot) && !(excludeSent && m.sent_by_agent))
                          if (!filtered.length) {
                            return <Note>No matching members — try adjusting filters</Note>
                          }
                          const selectedIds = new Set(bulkSelectedMembers.map((m) => m.user_id))
                          return filtered.map((member) => {
                          const isSelected = selectedIds.has(member.user_id)
                          return (
                          <LinkRow
                            key={member.user_id}
                            onClick={() => {
                              setBulkSelectedMembers((current) =>
                                current.some((entry) => entry.user_id === member.user_id) ? current.filter((entry) => entry.user_id !== member.user_id) : [...current, member]
                              )
                            }}
                            style={{ background: isSelected ? 'var(--miniapp-highlight, #e8f4e8)' : undefined }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {isSelected ? <span style={{ color: 'var(--miniapp-sage, #4a8)', fontWeight: 700, fontSize: 16 }}>✓</span> : null}
                              <strong>{member.full_name || member.username || `User ${member.user_id}`}</strong>
                              {member.is_creator ? <span style={{ padding: '1px 6px', borderRadius: 999, background: 'var(--miniapp-coral)', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px' }}>Owner</span> : null}
                              {member.is_admin && !member.is_creator ? <span style={{ padding: '1px 6px', borderRadius: 999, background: '#5b8def', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px' }}>Admin</span> : null}
                              {member.is_bot ? <span style={{ padding: '1px 6px', borderRadius: 999, background: '#8b8b8b', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '18px' }}>Bot</span> : null}
                              {member.sent_by_agent ? <span style={{ color: 'var(--miniapp-sage)', fontSize: 12, fontWeight: 600 }}>✓ Sent</span> : null}
                            </div>
                            <div style={{ color: '#655d52', marginTop: 4 }}>
                              {member.username ? `@${member.username} · ` : ''}{member.user_id}{member.phone ? ` · ${member.phone}` : ''}
                              {(typeof member.message_count === 'number' && member.message_count > 0) ? (
                                <span style={{ marginLeft: 4 }}>· {member.message_count} msg{member.message_count !== 1 ? 's' : ''}</span>
                              ) : null}
                              {(typeof member.group_count === 'number' && member.group_count > 0) ? (
                                <span style={{ marginLeft: 4 }}>· {member.group_count} group{member.group_count !== 1 ? 's' : ''}</span>
                              ) : null}
                            </div>
                          </LinkRow>
                        )
                      })
                      })()}
                      </div>
                      {bulkMemberTotal > 20 ? (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', fontSize: 12, color: 'var(--miniapp-clay)' }}>
                          <Button tone="secondary" disabled={bulkMemberPage <= 1} onClick={() => setBulkMemberPage((p) => Math.max(1, p - 1))}>
                            Previous
                          </Button>
                          <span>{bulkMemberPage} / {Math.ceil(bulkMemberTotal / 20)}</span>
                          <Button tone="secondary" disabled={bulkMemberPage >= Math.ceil(bulkMemberTotal / 20)} onClick={() => setBulkMemberPage((p) => p + 1)}>
                            Next
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <MultiGroupSelect
                    query={bulkTargetGroupQuery}
                    onQueryChange={setBulkTargetGroupQuery}
                    groups={groups}
                    selected={bulkSelectedTargetGroups}
                    onToggle={(group) => {
                      setBulkSelectedTargetGroups((current) =>
                        current.some((g) => g.tg_group_id === group.tg_group_id)
                          ? current.filter((g) => g.tg_group_id !== group.tg_group_id)
                          : [...current, group]
                      )
                    }}
                  />
                  <TextAreaField
                    label="Message"
                    value={bulkMessage}
                    onChange={setBulkMessage}
                    rows={5}
                    placeholder="Hello, this is our latest update."
                  />
                </>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                <div style={{ flex: 1 }}>
                  <InputField label="Threshold" value={bulkThreshold} onChange={setBulkThreshold} type="number" />
                </div>
              </div>
              <InputField label="Interval seconds" value={bulkIntervalSeconds} onChange={setBulkIntervalSeconds} type="number" />
            </>
          ) : isLeadCaptureTask ? (
            <>
              <TextAreaField
                label="Acknowledgment template (optional)"
                value={leadAckTemplate}
                onChange={setLeadAckTemplate}
                rows={4}
                placeholder="تم استلام طلبك، وسيتواصل معك الفريق قريباً."
              />
              <InputField label="Lead label (optional)" value={leadLabel} onChange={setLeadLabel} placeholder="general" />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--miniapp-clay)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={leadAskContact}
                  onChange={(event) => setLeadAskContact(event.target.checked)}
                  style={{ accentColor: 'var(--miniapp-accent)' }}
                />
                Ask for contact details
              </label>
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-text-primary)' }}>
                  Keyword condition
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {taskKeywords.map((kw, i) => (
                    <span key={i} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 999,
                      background: 'var(--miniapp-coral-dim)', color: 'var(--miniapp-coral)',
                      fontSize: 13, fontWeight: 500,
                    }}>
                      {kw}
                      <button type="button" onClick={() => setTaskKeywords((prev) => prev.filter((_, j) => j !== i))} style={{
                        border: 'none', background: 'none', cursor: 'pointer',
                        color: 'inherit', fontSize: 15, lineHeight: 1, padding: 0,
                      }}>&times;</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={pendingKeyword}
                  onChange={(e) => setPendingKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pendingKeyword.trim()) {
                      e.preventDefault()
                      setTaskKeywords((prev) => prev.includes(pendingKeyword.trim()) ? prev : [...prev, pendingKeyword.trim()])
                      setPendingKeyword('')
                    }
                  }}
                  placeholder="support"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--miniapp-border)',
                    background: 'var(--miniapp-surface)',
                    color: 'var(--miniapp-text-primary)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
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
              />
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
              />
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
          {bulkSummary ? (
            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: 12,
                border: '1px solid var(--miniapp-border-soft)',
                borderRadius: 12,
                background: 'var(--miniapp-bg)',
                fontSize: 13,
              }}
            >
              <strong style={{ fontSize: 14 }}>Send summary</strong>
              <div>Total {bulkSummary.target_type === 'groups' ? 'groups' : 'matched'}: {bulkSummary.total}</div>
              {bulkSummary.target_type !== 'groups' ? (
                <>
                  {bulkSummary.admins_excluded > 0 ? <div>Admins excluded: {bulkSummary.admins_excluded}</div> : null}
                  {bulkSummary.bots_excluded > 0 ? <div>Bots excluded: {bulkSummary.bots_excluded}</div> : null}
                  {bulkSummary.already_sent_excluded > 0 ? <div>Already sent excluded: {bulkSummary.already_sent_excluded}</div> : null}
                </>
              ) : null}
              <div style={{ fontWeight: 700, color: 'var(--miniapp-coral)' }}>
                Final {bulkSummary.target_type === 'groups' ? 'groups' : 'recipients'}: {bulkSummary.final_count}
              </div>
              {bulkSummary.final_count === 0 ? (
                <div style={{ color: 'var(--miniapp-coral)', fontSize: 13 }}>
                  {bulkSummary.target_type === 'groups' ? 'No target groups selected.' : 'No recipients left after excluding admins, bots, and already-sent users.'}
                </div>
              ) : null}
            </div>
          ) : null}
          {loadingBulkSummary ? <Note>Preparing summary...</Note> : null}
          <FormActions
            submitLabel={bulkSummary ? 'Confirm & Send' : loadingBulkSummary ? 'Preparing...' : isBulkMessageTask || isScrapeTask ? 'Queue job' : editingTask ? 'Save task' : 'Create task'}
            submitDisabled={bulkSummary !== null && bulkSummary.final_count === 0}
            onSubmit={() => void saveTask()}
            onCancel={closeForm}
          />
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 8 }}>
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

function AccountLeadsPage({ account }: { account: Agent }) {
  const [leads, setLeads] = useState<AgentLead[]>([])
  const [leadPage, setLeadPage] = useState<AgentLeadPage | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [contactingLead, setContactingLead] = useState<AgentLead | null>(null)
  const [contactMessage, setContactMessage] = useState('')
  const [contactMode, setContactMode] = useState<'private' | 'public' | 'forward'>('private')
  const [includeOriginal, setIncludeOriginal] = useState(true)
  const [isSending, setIsSending] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const result = await agentsApi.fetchAgentLeads(account.id, {
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
  }, [account.id, page])

  async function dismissLead(lead: AgentLead) {
    try {
      await agentsApi.updateAgentLead(account.id, lead.id, { status: 'dismissed' })
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to dismiss lead')
    }
  }

  function openContact(lead: AgentLead) {
    setContactingLead(lead)
    setContactMessage('')
    setContactMode('private')
    setIncludeOriginal(true)
  }

  function closeContact() {
    setContactingLead(null)
    setContactMessage('')
  }

  async function sendContact() {
    if (!contactingLead) return
    const isForward = contactMode === 'forward'
    if (isForward && !contactingLead.source_message_id) {
      setStatus('No original message to forward')
      return
    }
    setIsSending(true)
    try {
      const notes = isForward
        ? `Original message forwarded${contactMessage.trim() ? ` with message: ${contactMessage.trim()}` : ''}`
        : `Contacted via ${contactMode}: ${contactMessage.trim()}${includeOriginal && contactingLead.message_text ? `\n\n${contactingLead.message_text}` : ''}`
      await agentsApi.updateAgentLead(account.id, contactingLead.id, {
        status: 'contacted',
        notes,
      })
      await agentsApi.createAgentJob(account.id, 'send_lead_message', {
        tg_user_id: contactingLead.tg_user_id,
        message: contactMessage.trim(),
        mode: contactMode,
        include_original: isForward ? false : includeOriginal,
        original_text: !isForward && includeOriginal ? contactingLead.message_text : null,
        source_group_tg_id: contactingLead.source_group_tg_id,
        source_message_id: contactingLead.source_message_id,
      })
      closeContact()
      setStatus(null)
      void refresh()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to contact lead')
    } finally {
      setIsSending(false)
    }
  }

  const totalPages = leadPage?.total_pages ?? 1

  return (
    <Card title="Leads" subtitle="Capture, contact, and manage your leads.">
      {status ? <Note>{status}</Note> : null}
      <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>
        {loading ? 'Loading...' : 'Refresh'}
      </Button>
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
                <div style={{ minWidth: 0 }}>
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
                  whiteSpace: 'nowrap',
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
              {lead.status !== 'dismissed' ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button onClick={() => openContact(lead)}>Contact</Button>
                  <Button tone="secondary" onClick={() => void dismissLead(lead)}>Dismiss</Button>
                </div>
              ) : null}
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
      {contactingLead ? (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(32, 25, 16, 0.55)',
            display: 'grid', placeItems: 'center',
            padding: 16, zIndex: 1100,
          }}
          onClick={closeContact}
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
            <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>
              Contact {contactingLead.first_name || contactingLead.username || `User ${contactingLead.tg_user_id}`}
            </h2>
            {contactMode === 'forward' ? (
              <>
                <Note>Forward the lead's original message to their private chat, then send your message below.</Note>
                {contactingLead.message_text ? (
                  <div style={{
                    padding: 12, borderRadius: 10,
                    background: 'var(--miniapp-bg-soft)',
                    border: '1px solid var(--miniapp-border-soft)',
                    fontSize: 13, color: '#655d52', lineHeight: 1.5,
                    maxHeight: 140, overflow: 'auto',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {contactingLead.message_text}
                  </div>
                ) : null}
              </>
            ) : null}
            <TextAreaField
              label="Message"
              value={contactMessage}
              onChange={setContactMessage}
              rows={5}
              placeholder="Type your message to this lead..."
            />
            {contactingLead.message_text ? (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#655d52', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeOriginal}
                      onChange={(e) => setIncludeOriginal(e.target.checked)}
                      style={{ accentColor: 'var(--miniapp-coral)' }}
                    />
                    Include original message
                  </label>
                ) : null}
            <SelectField label="Send mode" value={contactMode} onChange={(v) => setContactMode(v as 'private' | 'public' | 'forward')}>
              <option value="private">Private (direct message)</option>
              <option value="public">Public (in group)</option>
              <option value="forward">Forward original message</option>
            </SelectField>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                onClick={() => void sendContact()}
                disabled={isSending || (contactMode === 'forward' && !contactingLead.source_message_id)}
              >
                {isSending ? 'Sending...' : contactMode === 'forward' ? 'Forward' : 'Send'}
              </Button>
              <Button tone="secondary" onClick={closeContact}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(dateStr).toLocaleString()
}

function FilterSelect({ value, options, onChange }: { value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      padding: '6px 10px', borderRadius: 8, border: '1px solid var(--miniapp-border-soft)',
      background: 'var(--miniapp-surface)', color: 'var(--miniapp-text-primary)',
      fontSize: 12, fontFamily: 'var(--miniapp-sans)', cursor: 'pointer', outline: 'none',
    }}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function TaskActivity({ account }: { account: Agent }) {
  const [jobs, setJobs] = useState<AgentJobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [logsJobId, setLogsJobId] = useState<number | null>(null)
  const [logs, setLogs] = useState<SendLogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [actingJobId, setActingJobId] = useState<number | null>(null)

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDate, setFilterDate] = useState('all')
  const [filterType, setFilterType] = useState('all')

  useEffect(() => {
    void load()
    const interval = setInterval(() => void refreshJobs(), 15000)
    return () => clearInterval(interval)
  }, [account.id])

  async function load() {
    setLoading(true)
    setStatusMsg(null)
    try {
      await agentsApi.reconcileStaleJobs(1)
      const jobsData = await agentsApi.fetchAgentJobs(account.id, undefined, 100)
      setJobs(jobsData)
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : 'Failed to load task activity')
    } finally {
      setLoading(false)
    }
  }

  async function refreshJobs() {
    try {
      const jobsData = await agentsApi.fetchAgentJobs(account.id, undefined, 100)
      setJobs(jobsData)
    } catch { /* silent auto-refresh */ }
  }

  async function handleCancel(jobId: number) {
    setActingJobId(jobId)
    try {
      await agentsApi.cancelAgentJob(account.id, jobId)
      await refreshJobs()
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : 'Failed to cancel job')
    } finally {
      setActingJobId(null)
    }
  }

  async function handleRetry(jobId: number) {
    setActingJobId(jobId)
    try {
      await agentsApi.retryAgentJob(account.id, jobId)
      await refreshJobs()
    } catch (error) {
      setStatusMsg(error instanceof Error ? error.message : 'Failed to retry job')
    } finally {
      setActingJobId(null)
    }
  }

  useEffect(() => {
    if (logsJobId === null) return
    setLogsLoading(true)
    void agentsApi.fetchAgentSendLogs(account.id, 500, undefined, logsJobId)
      .then((data) => setLogs(data.logs))
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false))
  }, [account.id, logsJobId])

  const sendLogColumns = useMemo<ColumnDef<SendLogEntry>[]>(() => [
    {
      key: 'recipient', label: 'Recipient', sortable: true, width: '1.5fr',
      render: (log) => (
        <span style={{ fontWeight: 600 }}>
          {log.username ? `@${log.username}` : log.tg_user_id ? `User ${log.tg_user_id}` : `Group ${log.tg_group_id}`}
          {log.phone_number ? <span style={{ fontWeight: 400, color: 'var(--miniapp-text-muted)', marginLeft: 6 }}>{log.phone_number}</span> : null}
        </span>
      ),
    },
    {
      key: 'type', label: 'Type', width: '60px',
      render: (log) => log.username || log.tg_user_id ? '👤' : '👥',
    },
    {
      key: 'status', label: 'Status', sortable: true, width: '80px',
      render: (log) => (
        <span style={{
          padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
          background: log.status === 'sent' ? 'var(--miniapp-sage-dim)' : 'rgba(161,87,62,0.12)',
          color: log.status === 'sent' ? 'var(--miniapp-sage)' : 'var(--miniapp-clay)',
        }}>
          {log.status}
        </span>
      ),
    },
    {
      key: 'message', label: 'Message', width: '2fr',
      render: (log) => (
        <span style={{ color: 'var(--miniapp-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {(log.message_preview || '').slice(0, 120)}
        </span>
      ),
    },
    {
      key: 'time', label: 'Time', sortable: true, align: 'right' as const, width: '120px',
      render: (log) => log.sent_at ? (
        <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 11 }}>{new Date(log.sent_at).toLocaleString()}</span>
      ) : '—',
    },
  ], [])

  const filteredJobs = useMemo(() => {
    let result = [...jobs]

    if (filterStatus !== 'all') {
      result = result.filter((j) => j.status === filterStatus)
    }

    if (filterDate !== 'all') {
      const now = Date.now()
      const cutoffs: Record<string, number> = {
        'today': now - 86400000,
        '24h': now - 86400000,
        '7d': now - 7 * 86400000,
        '30d': now - 30 * 86400000,
      }
      const cutoff = cutoffs[filterDate]
      if (cutoff) {
        result = result.filter((j) => j.created_at && new Date(j.created_at).getTime() > cutoff)
      }
    }

    if (filterType !== 'all') {
      result = result.filter((j) => j.job_type === filterType)
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((j) => {
        const idMatch = String(j.id).includes(q)
        const nameMatch = (j.message_preview || '').toLowerCase().includes(q)
        const groupMatch = (j.source_group_title || '').toLowerCase().includes(q)
        const typeMatch = (j.target_type || '').toLowerCase().includes(q)
        return idMatch || nameMatch || groupMatch || typeMatch
      })
    }

    return result
  }, [jobs, filterStatus, filterDate, filterType, search])

  const taskTypes = useMemo(() => {
    const types = new Set(jobs.map((j) => j.job_type))
    return Array.from(types)
  }, [jobs])

  return (
    <Card title="Task Activity" subtitle="Monitor bulk messaging tasks and send logs.">
      {statusMsg ? <Note>{statusMsg}</Note> : null}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <Button tone="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search task..."
          style={{
            flex: '1 1 160px', minWidth: 120, padding: '7px 10px', borderRadius: 8,
            border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)',
            color: 'var(--miniapp-text-primary)', fontSize: 12, fontFamily: 'var(--miniapp-sans)', outline: 'none',
          }}
        />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} options={[
          { label: 'All status', value: 'all' }, { label: 'Running', value: 'running' },
          { label: 'Completed', value: 'completed' }, { label: 'Failed', value: 'failed' },
          { label: 'Pending', value: 'pending' }, { label: 'Queued', value: 'queued' },
        ]} />
        <FilterSelect value={filterDate} onChange={setFilterDate} options={[
          { label: 'All time', value: 'all' }, { label: 'Today', value: 'today' },
          { label: 'Last 24h', value: '24h' }, { label: 'Last 7 days', value: '7d' },
          { label: 'Last 30 days', value: '30d' },
        ]} />
        {taskTypes.length > 1 ? (
          <FilterSelect value={filterType} onChange={setFilterType} options={[
            { label: 'All types', value: 'all' },
            ...taskTypes.map((t) => ({ label: JOB_TYPE_LABELS[t] || t.replace(/_/g, ' '), value: t })),
          ]} />
        ) : null}
      </div>

      {loading ? <Note>Loading...</Note> : null}

      {!loading && filteredJobs.length === 0 ? <Note>{jobs.length === 0 ? 'No tasks yet.' : 'No tasks match the selected filters.'}</Note> : null}

      {!loading && filteredJobs.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {filteredJobs.map((job) => {
            const p = job.progress || {}
            const total = p.total_count ?? 0
            const sent = p.success_count ?? 0
            const failed = p.failure_count ?? 0
            const done = sent + failed
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const successRate = done > 0 ? Math.round((sent / done) * 100) : 0
            const isRunning = job.status === 'running'
            const isQueued = job.status === 'queued'
            const isCompleted = job.status === 'completed'
            const isFailed = job.status === 'failed'
            const isStopped = p.stop_reason != null
            const taskName = job.message_preview
              ? `${job.message_preview.slice(0, 48)}${job.message_preview.length > 48 ? '...' : ''}`
              : `${job.target_type === 'groups' ? 'Broadcast' : 'Members'} #${job.id}`
            return (
              <div key={job.id} style={{
                padding: 10, borderRadius: 10, border: '1px solid var(--miniapp-border-soft)',
                background: 'var(--miniapp-surface)', display: 'grid', gap: 5,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 13, lineHeight: 1.3 }}>{taskName}</strong>
                    {job.created_at ? (
                      <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--miniapp-text-muted)' }}>
                        {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>
                  <span style={{
                    flexShrink: 0, marginLeft: 8, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                    background: isCompleted ? 'var(--miniapp-sage-dim)' : isFailed ? 'rgba(161,87,62,0.12)' : isRunning ? 'rgba(71,89,119,0.12)' : isQueued ? 'rgba(71,89,119,0.08)' : 'var(--miniapp-bg-deep)',
                    color: isCompleted ? 'var(--miniapp-sage)' : isFailed ? 'var(--miniapp-clay)' : isRunning ? '#475977' : isQueued ? '#9b9186' : 'var(--miniapp-text-muted)',
                  }}>
                    {isStopped ? 'Stopped' : job.status}
                  </span>
                </div>

                {total > 0 ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{sent} / {total}</span>
                      <span style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>
                        {job.target_type === 'groups' ? 'groups' : 'members'}
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--miniapp-bg-deep)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`, borderRadius: 2,
                        background: isFailed && pct < 100 ? 'var(--miniapp-clay)' : isRunning ? '#475977' : 'var(--miniapp-sage)',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </>
                ) : <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{job.status.charAt(0).toUpperCase() + job.status.slice(1)}</div>}

                <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>Sent: <strong>{sent}</strong></span>
                  {failed > 0 ? <span style={{ color: 'var(--miniapp-clay)' }}>Failed: <strong>{failed}</strong></span> : null}
                  {done > 0 ? <span>Success: <strong>{successRate}%</strong></span> : null}
                  {job.updated_at ? <span style={{ color: 'var(--miniapp-text-muted)' }}>{timeAgo(job.updated_at)}</span> : null}
                  {isStopped ? <span style={{ color: 'var(--miniapp-clay)' }}>· {p.stop_reason}</span> : null}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {(isRunning || isQueued) && job.status !== 'aborted' ? (
                      <button type="button" disabled={actingJobId === job.id} onClick={() => void handleCancel(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: actingJobId === job.id ? 'default' : 'pointer',
                          color: 'var(--miniapp-clay)', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                          opacity: actingJobId === job.id ? 0.5 : 1,
                        }}>
                        {actingJobId === job.id ? 'Stopping...' : 'Stop'}
                      </button>
                    ) : null}
                    {(isFailed || job.status === 'aborted') ? (
                      <button type="button" disabled={actingJobId === job.id} onClick={() => void handleRetry(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: actingJobId === job.id ? 'default' : 'pointer',
                          color: '#475977', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                          opacity: actingJobId === job.id ? 0.5 : 1,
                        }}>
                        {actingJobId === job.id ? 'Retrying...' : 'Retry'}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => setLogsJobId(job.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475977', fontSize: 11, fontWeight: 600, fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0 }}>
                      View Logs
                    </button>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {(function logsModal() {
        const logJob = jobs.find((j) => j.id === logsJobId)
        const logProgress = logJob?.progress || {}
        const logTotal = logProgress.total_count ?? 0
        const logSent = logProgress.success_count ?? 0
        const logFailed = logProgress.failure_count ?? 0
        const logSummary = logTotal > 0 ? `${logSent} sent, ${logFailed} failed of ${logTotal}` : ''
        return (
          <TableModal<SendLogEntry>
            open={logsJobId !== null}
            onClose={() => setLogsJobId(null)}
            title="Send Logs"
            subtitle={
              `Job #${logsJobId}` +
              (logJob?.message_preview ? ` · ${logJob.message_preview}` : '') +
              (logSummary ? ` · ${logSummary}` : '')
            }
            data={logs}
            columns={sendLogColumns}
            keyField="id"
            searchAccessor={(log) => `${log.username || ''} ${log.phone_number || ''} ${log.tg_user_id || ''} ${log.tg_group_id || ''} ${log.message_preview || ''}`}
            pageSize={25}
            loading={logsLoading}
            emptyMessage={
              logTotal > 0
                ? `No individual send records found. Job progress: ${logSent} sent, ${logFailed} failed of ${logTotal}.${logFailed > 0 && !logFailed ? ' All sends failed — the account may not have permission to post in the target groups.' : ''}`
                : 'No send logs for this job. Messages may still be in progress.'
            }
            renderExpanded={(log) => (
              <div style={{ padding: '4px 0', lineHeight: 1.6, color: 'var(--miniapp-text)' }}>
                {log.message_full || log.message_preview}
              </div>
            )}
          />
        )
      })()}
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
            placeholder="e.g. 5"
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
