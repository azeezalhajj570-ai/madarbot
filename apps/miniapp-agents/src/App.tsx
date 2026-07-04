import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDate, formatTime, formatDateTime, formatNumber } from './i18n/format'

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

import { useLanguage } from './i18n/useLanguage'
import './i18n/rtl.css'
import { LanguageSwitcher } from './components/LanguageSwitcher'
import { CampaignsPage } from './pages/CampaignsPage'
import { LeadsAcquisitionSection } from './features/leads/LeadsAcquisitionSection'
import { AutomationTasksSection } from './features/tasks/AutomationTasksSection'
import { ConfirmModal } from './components/ConfirmModal'
import { FormActions } from './components/FormActions'
import { GroupAutocompleteField } from './components/GroupAutocompleteField'
import { GroupDestinationField } from './components/GroupDestinationField'

type AgentsPage = 'dashboard' | 'leads' | 'campaigns' | 'tasks' | 'settings'
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
const SCRAPE_LIMIT_MAX = 1_000_000
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
  const { t } = useTranslation()
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
          <span style={{ fontWeight: 600 }}>{t('subscription.currentPlan')}</span>
          <Badge tone={isActive ? 'success' : 'neutral'}>
            {isActive ? (isLifetime ? t('subscription.lifetime') : t('subscription.active')) : t('subscription.noActive')}
          </Badge>
        </div>
        {isActive && expiryDate && (
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)' }}>
            {t('subscription.validUntil')} {formatDate(expiryDate)} {formatTime(expiryDate)}
          </div>
        )}
        {!isActive && (
          <div style={{ fontSize: 13, color: 'var(--miniapp-text-muted)' }}>
            {t('subscription.redeemInfo')}
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
              {cancelling ? t('subscription.cancelling') : t('subscription.cancel')}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <InputField
          label={t('subscription.redeemLabel')}
          value={code}
          onChange={(val) => setCode(val.toUpperCase())}
          placeholder={t('subscription.redeemPlaceholder')}
        />
        {error && <Note tone="warning">{error}</Note>}
        {success && <Note>{success}</Note>}
        <Button onClick={() => void handleRedeem()} disabled={loading || !code.trim()}>
          {loading ? t('subscription.redeeming') : t('subscription.redeemButton')}
        </Button>
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
        {isActive && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text)' }}>{t('subscription.upgradeOrExtend')}</div>
        )}
        {!isActive && (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text)' }}>{t('subscription.payWithStripe')}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { plan: 'pro', label: t('subscription.pro'), price: '$29', desc: t('subscription.priceMonthly'), days: 30 },
            { plan: 'business', label: t('subscription.business'), price: '$79', desc: t('subscription.priceMonthly'), days: 30 },
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
                {checkoutPlan === p.plan ? t('subscription.checkoutLoading') : p.price}
              </div>
              <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {!isActive && (
        <div style={{ fontSize: 13, color: 'var(--miniapp-text-secondary)', display: 'grid', gap: 8 }}>
          <strong>{t('subscription.subscribingGives')}</strong>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
            <li>{t('subscription.featureMultiAccounts')}</li>
            <li>{t('subscription.featureScraping')}</li>
            <li>{t('subscription.featureBroadcasts')}</li>
            <li>{t('subscription.featureNotifications')}</li>
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
  const { t } = useTranslation()
  if (!open) return null

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
          display: 'grid',
          gap: 20,
          boxShadow: '0 22px 60px rgba(32, 25, 16, 0.22)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 22 }}>{t('subscription.modalTitle')}</h2>
          <Button tone="secondary" onClick={onClose}>{t('subscription.close')}</Button>
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
  const { t } = useTranslation()
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
            <h2 style={{ margin: 0, fontFamily: 'var(--miniapp-serif)', fontSize: 20 }}>{t('notifications.title')}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button tone="secondary" onClick={() => void markAllSeen()} disabled={isMarkingSeen || loading}>{t('notifications.markAllSeen')}</Button>
              <Button tone="secondary" onClick={onClose}>{t('notifications.close')}</Button>
            </div>
          </div>
          {status ? <Note>{status}</Note> : null}
          <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? t('common.loading') : t('common.refresh')}
          </Button>
          {loading ? <Note>{t('notifications.loading')}</Note> : null}
          {!loading && visibleNotifications.length === 0 ? <Note>{t('notifications.noUnseen')}</Note> : null}
        </div>
        <div style={{ overflow: 'auto', padding: 24, display: 'grid', gap: 16 }}>
          {visibleNotifications.map((notification) => {
            const tone = notificationTone(notification.kind)
            const chips = notificationChips(t, notification)
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
                      {notificationKindLabel(t, notification.kind)}
                    </span>
                    <span style={{ color: 'var(--miniapp-coral)', fontSize: 12, fontWeight: 700 }}>NEW</span>
                  </div>
                  <div style={{ color: '#7d746a', fontSize: 12, whiteSpace: 'nowrap' }}>{notificationTimeLabel(t, notification.created_at)}</div>
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
    scraping: 'leads',
    tasks: 'tasks',
    leads: 'leads',
    groups: 'leads',
    campaigns: 'campaigns',
    settings: 'settings',
    dashboard: 'dashboard',
  }

  const page = pageMap[rawPage] || 'leads'

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

function notificationTimeLabel(t: (key: string) => string, createdAt?: string | null) {
  if (!createdAt) {
    return t('notifications.unknownTime')
  }
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? createdAt : formatDateTime(date)
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

function notificationKindLabel(t: (key: string) => string, kind: string) {
  if (kind.startsWith('bulk_message')) return t('notifications.kindBulkMessage')
  if (kind.startsWith('scrape')) return t('notifications.kindScrape')
  if (kind.startsWith('task')) return t('notifications.kindTask')
  if (kind === 'job_queued') return t('notifications.kindQueued')
  if (kind === 'job_failed') return t('notifications.kindJobFailed')
  return kind.replace(/_/g, ' ')
}

function notificationChips(t: (key: string, options?: Record<string, unknown>) => string, notification: AgentNotification) {
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
  if (keyword) chips.push(t('notifications.chipKeyword', { keyword }))
  if (destination) chips.push(t('notifications.chipTo', { destination }))
  if (selectedCount && notification.kind === 'job_queued') chips.push(t('notifications.chipSelected', { count: selectedCount }))
  if (attemptedCount && notification.kind === 'bulk_message_completed') chips.push(t('notifications.chipAttempted', { count: attemptedCount }))
  if (sentCount) chips.push(t('notifications.chipSent', { count: sentCount }))
  if (failedCount) chips.push(t('notifications.chipFailed', { count: failedCount }))
  if (membersCount && notification.kind.startsWith('scrape')) chips.push(t('notifications.chipMembers', { count: membersCount }))
  if (messagesCount && notification.kind.startsWith('scrape')) chips.push(t('notifications.chipMessages', { count: messagesCount }))

  return chips.slice(0, 4)
}

function mapTaskGroups(t: (key: string, options?: Record<string, unknown>) => string, task: AutomationTask) {
  const tgGroupIds = Array.isArray(task.group_tg_ids) ? task.group_tg_ids : []
  const titles = Array.isArray(task.group_titles) ? task.group_titles : []
  return tgGroupIds.map((tgGroupId, index) => ({
    tg_group_id: Number(tgGroupId),
    title: String(titles[index] || t('automation.groupFallback', { tgGroupId })),
  }))
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
  const { t } = useTranslation()
  return (
    <Card title={t('noAccount.title')} subtitle={t('noAccount.subtitle')}>
      <Note tone="warning">
        {t('noAccount.note')}
      </Note>
      <div style={{ marginTop: 10 }}>
        <Button onClick={onLink}>{t('noAccount.goToAccounts')}</Button>
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
  const { t } = useTranslation()
  const [isSyncing, setIsSyncing] = useState(false)
  const isActive = account.auth_state === 'active' && account.status === 'active'

  async function syncWorkspace() {
    setIsSyncing(true)
    onStatus(t('settings.syncingStatus', { name: accountLabel(account) }))
    try {
      await agentsApi.syncAgentWorkspace(account.id)
      onStatus(t('settings.syncFinished', { name: accountLabel(account) }))
    } catch (error) {
      onStatus(error instanceof Error ? error.message : t('settings.syncFailed'))
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
          {accountLabel(account) ? `${accountLabel(account)} · ` : ''}{t('settings.status')} {account.status} · {t('settings.auth')} {account.auth_state}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isActive ? (
          <>
            <Button onClick={onOpen}>{t('settings.openWorkspace')}</Button>
            <Button tone="secondary" onClick={() => void syncWorkspace()} disabled={isSyncing}>
              {isSyncing ? t('settings.syncing') : t('settings.sync')}
            </Button>
          </>
        ) : (
          <Button onClick={onResume}>{t('settings.resumeSetup')}</Button>
        )}
        <Button tone="danger" onClick={onDelete}>{t('settings.delete')}</Button>
      </div>
    </div>
  )
}

function BottomNav({ currentPage, onNavigate }: { currentPage: AgentsPage; onNavigate: (page: AgentsPage) => void }) {
  const { t } = useTranslation()
  const tabs: { id: AgentsPage; label: string; icon: React.ReactNode }[] = [
    {
      id: 'dashboard',
      label: t('nav.dashboard'),
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
      id: 'leads',
      label: t('nav.leads'),
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
      id: 'campaigns',
      label: t('nav.campaigns'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'tasks',
      label: t('nav.tasks'),
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: t('nav.settings'),
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

function FooterLinks() {
  const { t } = useTranslation()
  const links = [
    { href: '/docs', key: 'legal.docs' },
    { href: '/legal/tos', key: 'legal.tos' },
    { href: '/legal/privacy', key: 'legal.privacy' },
    { href: '/legal/cookies', key: 'legal.cookies' },
    { href: '/legal/disclaimer', key: 'legal.disclaimer' },
    { href: '/legal/refund', key: 'legal.refund' },
    { href: '/legal/contact', key: 'legal.contact' },
    { href: '/legal/data-deletion', key: 'legal.dataDeletion' },
    { href: '/legal/aup', key: 'legal.aup' },
  ]
  return (
    <footer style={{
      marginTop: 8,
      padding: '16px 0 32px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px 18px',
      justifyContent: 'center',
    }}>
      {links.map((link, i) => (
        <span key={link.href} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <a
            href={link.href}
            style={{
              color: 'var(--miniapp-text-muted)',
              textDecoration: 'none',
              fontSize: 11.5,
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => { (e.target as HTMLAnchorElement).style.color = 'var(--miniapp-text-primary)' }}
            onMouseLeave={(e) => { (e.target as HTMLAnchorElement).style.color = 'var(--miniapp-text-muted)' }}
          >
            {t(link.key)}
          </a>
          {i < links.length - 1 ? (
            <span style={{ color: 'var(--miniapp-border)', fontSize: 11 }}>·</span>
          ) : null}
        </span>
      ))}
    </footer>
  )
}

export default function App() {
  useLanguage()
  const { t } = useTranslation()
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
{t('app.upgrade')}
            </button>
          )}
        </div>
      )
    }
    return label
  }, [selectedAccount, subscription, t])

  return (
    <AppShell title={t('app.title')} subtitle={headerSubtitle} actions={
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
          <Card title={t('app.loading')} subtitle={t('app.preparing')}>
            <Note>{t('app.waitingWorkspace')}</Note>
          </Card>
        ) : null}
        {appReady && !isAuthenticated ? (
          <Card title={t('app.authRequired')} subtitle={t('app.authRequiredDesc')}>
            <Note tone="warning">{session.error || t('app.authUnavailable')}</Note>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}>
              <LanguageSwitcher />
            </div>
            <Card
              title={t('subscription.title')}
              subtitle={subscription?.status === 'active' ? `${subscription?.plan === 'business' ? t('subscription.businessActive') : t('subscription.proActive')}` : t('subscription.noActive')}
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
                  <span>{subscriptionExpanded ? t('subscription.hideDetails') : t('subscription.showDetails')}</span>
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
                <Card title={t('settings.linkedAccounts')} subtitle={t('settings.linkedAccountsSubtitle')}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {accounts.length ? accounts.map((account) => (
                      <LinkedAccountCard
                        key={account.id}
                        account={account}
                        onOpen={() => navigate(accountPath(account.id, 'leads'))}
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
                    )) : <Note>{t('settings.noLinkedAccounts')}</Note>}
                  </div>
                </Card>
                <Card title={t('settings.linkNewAccount')}>
                  {subscription?.plan === 'pro' && accounts.length >= 1 ? (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <Note tone="warning">
                        {t('settings.proAccountLimit')}
                      </Note>
                      <Button onClick={() => setShowSubscription(true)}>{t('settings.upgradePlan')}</Button>
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
                <AccountAnalyticsPage account={selectedAccount} />
              ) : null}
               {route.page === 'leads' ? (
                <>
                  <LeadsAcquisitionSection account={selectedAccount} onSaved={setStatus} />
                  <AccountLeadsPage account={selectedAccount} />
                </>
              ) : null}
              {route.page === 'campaigns' ? (
                <CampaignsPage account={selectedAccount} onSaved={setStatus} />
              ) : null}
              {route.page === 'tasks' ? (
                <>
                  <AutomationTasksSection account={selectedAccount} onSaved={setStatus} />
                  <TaskActivity account={selectedAccount} />
                </>
              ) : null}
            </>
          ) : (
            <NoAccountNotice onLink={() => navigate('/accounts')} />
          )
        ) : null}
      </Grid>

      <FooterLinks />

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
          title={t('settings.deleteAccountTitle')}
          message={t('settings.deleteAccountConfirm', { name: accountLabel(deleteTarget) })}
          confirmLabel={t('settings.delete')}
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
  const { t } = useTranslation()
  return <Button onClick={onOpen} disabled={disabled}>{t('settings.linkNewAccount')}</Button>
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

  const { t } = useTranslation()

  const statusBadge = (s: string) => {
    if (s === 'active') return <Badge tone="success">{t('settings.tokenActive')}</Badge>
    if (s === 'expired') return <Badge tone="warning">{t('settings.tokenExpired')}</Badge>
    return <Badge tone="neutral">{t('settings.tokenRevoked')}</Badge>
  }

  return (
    <Card title={t('settings.mcpTokens')} subtitle={t('settings.mcpTokensSubtitle')}>
      <div style={{ display: 'grid', gap: 12 }}>
        {loading ? (
          <Note>{t('settings.mcpTokensLoading')}</Note>
        ) : tokens.length === 0 ? (
          <Note>{t('settings.noTokens')}</Note>
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
                    {' · '}created {t.created_at ? formatDate(t.created_at) : ''}
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
{t('settings.revoke')}
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
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--miniapp-sage)' }}>{t('settings.tokenCopied')}</div>
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
                {t('settings.copy')}
              </button>
            </div>
          </div>
        )}

        {showCreate ? (
          <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid var(--miniapp-border-soft)', borderRadius: 12 }}>
            <InputField label={t('settings.tokenName')} value={name} onChange={setName} placeholder={t('settings.tokenNamePlaceholder')} />
            <InputField label={t('settings.tokenExpiresLabel')} value={expiryDays} onChange={(v) => setExpiryDays(v.replace(/\D/g, ''))} placeholder={t('settings.tokenExpiresPlaceholder')} />
            {error && <Note tone="warning">{error}</Note>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={() => void handleCreate()} disabled={creating || !name.trim()}>
                {creating ? t('settings.creatingToken') : t('settings.createToken')}
              </Button>
              <Button tone="secondary" onClick={() => { setShowCreate(false); setError(null) }}>{t('subscription.close')}</Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => { setShowCreate(true); setCreatedToken(null); setError(null) }}>{t('settings.createToken')}</Button>
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
  const { t } = useTranslation()
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
    <Card title={t('notifications.title')} subtitle={t('notifications.subtitle')}>
      {status ? <Note>{status}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>{t('common.refresh')}</Button>
        <Button onClick={() => void markAllSeen()} disabled={isMarkingSeen || loading}>{t('notifications.markAllSeen')}</Button>
      </div>
      {loading ? <Note>{t('notifications.loading')}</Note> : null}
      {!loading && visibleNotifications.length === 0 ? <Note>{t('notifications.noUnseen')}</Note> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {visibleNotifications.map((notification) => (
          (() => {
            const tone = notificationTone(notification.kind)
            const chips = notificationChips(t, notification)
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
                      {notificationKindLabel(t, notification.kind)}
                    </span>
                    <span style={{ color: 'var(--miniapp-coral)', fontSize: 12, fontWeight: 700 }}>NEW</span>
                  </div>
                  <div style={{ color: '#7d746a', fontSize: 12, whiteSpace: 'nowrap' }}>{notificationTimeLabel(t, notification.created_at)}</div>
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

function AccountLeadsPage({ account }: { account: Agent }) {
  const { t } = useTranslation()
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
    <Card title={t('leads.title')} subtitle={t('leads.subtitle')}>
      {status ? <Note>{status}</Note> : null}
      <Button tone="secondary" onClick={() => void refresh()} disabled={loading}>
        {loading ? t('common.loading') : t('common.refresh')}
      </Button>
      {!loading && leads.length === 0 ? <Note>{t('leads.noLeads')}</Note> : null}
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
                {lead.source_group_title ? <span>{t('leads.groupLabel', { group: lead.source_group_title })}</span> : null}
                {lead.lead_label ? <span>{t('leads.leadLabel', { label: lead.lead_label })}</span> : null}
                {lead.captured_at ? <span>{formatDate(lead.captured_at)}</span> : null}
              </div>
              {lead.status !== 'dismissed' ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button onClick={() => openContact(lead)}>{t('leads.contact')}</Button>
                  <Button tone="secondary" onClick={() => void dismissLead(lead)}>{t('leads.dismiss')}</Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {totalPages > 1 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
          <Button tone="secondary" onClick={() => setPage((c) => Math.max(1, c - 1))} disabled={page <= 1}>
            {t('leads.previous')}
          </Button>
          <Note>{t('leads.pageOf', { page, totalPages, total: leadPage?.total ?? 0 })}</Note>
          <Button tone="secondary" onClick={() => setPage((c) => Math.min(totalPages, c + 1))} disabled={page >= totalPages}>
            {t('leads.next')}
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
              {t('leads.contactHeading', { name: contactingLead.first_name || contactingLead.username || `User ${contactingLead.tg_user_id}` })}
            </h2>
            {contactMode === 'forward' ? (
              <>
                <Note>{t('leads.forwardNote')}</Note>
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
              label={t('leads.messageLabel')}
              value={contactMessage}
              onChange={setContactMessage}
              rows={5}
              placeholder={t('leads.messagePlaceholder')}
            />
            {contactingLead.message_text ? (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#655d52', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeOriginal}
                      onChange={(e) => setIncludeOriginal(e.target.checked)}
                      style={{ accentColor: 'var(--miniapp-coral)' }}
                    />
                    {t('leads.includeOriginal')}
                  </label>
                ) : null}
            <SelectField label={t('leads.sendMode')} value={contactMode} onChange={(v) => setContactMode(v as 'private' | 'public' | 'forward')}>
              <option value="private">{t('leads.modePrivate')}</option>
              <option value="public">{t('leads.modePublic')}</option>
              <option value="forward">{t('leads.modeForward')}</option>
            </SelectField>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                onClick={() => void sendContact()}
                disabled={isSending || (contactMode === 'forward' && !contactingLead.source_message_id)}
              >
                {isSending ? t('leads.sending') : contactMode === 'forward' ? t('leads.forward') : t('leads.send')}
              </Button>
              <Button tone="secondary" onClick={closeContact}>{t('leads.cancel')}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function timeAgo(t: (key: string, options?: Record<string, unknown>) => string, dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 5) return t('time.justNow')
  if (sec < 60) return t('time.secondsAgo', { sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('time.minutesAgo', { min })
  const hours = Math.floor(min / 60)
  if (hours < 24) return t('time.hoursAgo', { hours })
  return formatDateTime(dateStr)
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
  const { t } = useTranslation()
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
      key: 'recipient', label: t('tasks.logRecipient'), sortable: true, width: '2fr',
      render: (log) => (
        <div style={{ display: 'grid', gap: 1 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            {log.username ? `@${log.username}` : log.group_title || (log.tg_user_id ? `User ${log.tg_user_id}` : `Group ${log.tg_group_id}`)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', fontFamily: 'var(--miniapp-mono, monospace)' }}>
            {log.tg_user_id ? log.tg_user_id : log.tg_group_id}{log.phone_number ? ` · ${log.phone_number}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'type', label: t('tasks.logType'), width: '60px',
      render: (log) => log.username || log.tg_user_id ? '👤' : '👥',
    },
    {
      key: 'status', label: t('tasks.logStatus'), sortable: true, width: '80px',
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
      key: 'message', label: t('tasks.logMessage'), width: '2fr',
      render: (log) => (
        <span style={{ color: 'var(--miniapp-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {(log.message_preview || '').slice(0, 120)}
        </span>
      ),
    },
    {
      key: 'time', label: t('tasks.logTime'), sortable: true, align: 'right' as const, width: '120px',
      render: (log) => log.sent_at ? (
        <span style={{ color: 'var(--miniapp-text-muted)', fontSize: 11 }}>{formatDateTime(log.sent_at)}</span>
      ) : '—',
    },
  ], [t])

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
    <Card title={t('tasks.activityTitle')} subtitle={t('tasks.activitySubtitle')}>
      {statusMsg ? <Note>{statusMsg}</Note> : null}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <Button tone="secondary" onClick={() => void load()} disabled={loading}>{t('common.refresh')}</Button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t('tasks.searchPlaceholder')}
          style={{
            flex: '1 1 160px', minWidth: 120, padding: '7px 10px', borderRadius: 8,
            border: '1px solid var(--miniapp-border-soft)', background: 'var(--miniapp-surface)',
            color: 'var(--miniapp-text-primary)', fontSize: 12, fontFamily: 'var(--miniapp-sans)', outline: 'none',
          }}
        />
        <FilterSelect value={filterStatus} onChange={setFilterStatus} options={[
          { label: t('tasks.filterAll'), value: 'all' }, { label: t('tasks.filterRunning'), value: 'running' },
          { label: t('tasks.filterCompleted'), value: 'completed' }, { label: t('tasks.filterFailed'), value: 'failed' },
          { label: t('tasks.filterPending'), value: 'pending' }, { label: t('tasks.filterQueued'), value: 'queued' },
          { label: t('tasks.filterScheduled'), value: 'scheduled' },
        ]} />
        <FilterSelect value={filterDate} onChange={setFilterDate} options={[
          { label: t('tasks.filterAllTime'), value: 'all' }, { label: t('tasks.filterToday'), value: 'today' },
          { label: t('tasks.filterLast24h'), value: '24h' }, { label: t('tasks.filterLast7d'), value: '7d' },
          { label: t('tasks.filterLast30d'), value: '30d' },
        ]} />
        {taskTypes.length > 1 ? (
          <FilterSelect value={filterType} onChange={setFilterType} options={[
            { label: t('tasks.filterAllTypes'), value: 'all' },
            ...taskTypes.map((jtype) => ({ label: JOB_TYPE_LABELS[jtype] || jtype.replace(/_/g, ' '), value: jtype })),
          ]} />
        ) : null}
      </div>

      {loading ? <Note>{t('common.loading')}</Note> : null}

      {!loading && filteredJobs.length === 0 ? <Note>{jobs.length === 0 ? t('tasks.noTasks') : t('tasks.noTasksFiltered')}</Note> : null}

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
            const isScheduled = job.status === 'scheduled'
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
                        {formatTime(job.created_at)}
                      </span>
                    ) : null}
                  </div>
                  <span style={{
                    flexShrink: 0, marginLeft: 8, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                    background: isCompleted ? 'var(--miniapp-sage-dim)' : isFailed ? 'rgba(161,87,62,0.12)' : isRunning ? 'rgba(71,89,119,0.12)' : isQueued ? 'rgba(71,89,119,0.08)' : isScheduled ? 'rgba(200,160,80,0.12)' : 'var(--miniapp-bg-deep)',
                    color: isCompleted ? 'var(--miniapp-sage)' : isFailed ? 'var(--miniapp-clay)' : isRunning ? '#475977' : isQueued ? '#9b9186' : isScheduled ? '#b8960a' : 'var(--miniapp-text-muted)',
                  }}>
                    {isStopped ? t('tasks.stopped') : job.status}
                  </span>
                </div>

                {isScheduled && job.scheduled_at ? (
                  <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>
                    {t('tasks.scheduledFor', { date: formatDateTime(job.scheduled_at) })}
                  </div>
                ) : total > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{sent} / {total}</span>
                    <span style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>
                      {job.target_type === 'groups' ? t('tasks.groups') : t('tasks.members')}
                    </span>
                  </div>
                ) : <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)' }}>{job.status.charAt(0).toUpperCase() + job.status.slice(1)}</div>}

                <div style={{ display: 'flex', gap: 10, fontSize: 11, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{t('tasks.sent')}: <strong>{sent}</strong></span>
                  {failed > 0 ? <span style={{ color: 'var(--miniapp-clay)' }}>{t('tasks.failed')}: <strong>{failed}</strong></span> : null}
                  {done > 0 ? <span>{t('tasks.success')}: <strong>{successRate}%</strong></span> : null}
                  {job.updated_at ? <span style={{ color: 'var(--miniapp-text-muted)' }}>{timeAgo(t, job.updated_at)}</span> : null}
                  {isStopped ? <span style={{ color: 'var(--miniapp-clay)' }}>· {p.stop_reason}</span> : null}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {isScheduled ? (
                      <button type="button" disabled={actingJobId === job.id} onClick={() => void handleCancel(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: actingJobId === job.id ? 'default' : 'pointer',
                          color: 'var(--miniapp-clay)', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                          opacity: actingJobId === job.id ? 0.5 : 1,
                        }}>
                        {actingJobId === job.id ? t('tasks.cancelling') : t('tasks.cancel')}
                      </button>
                    ) : null}
                    {(isRunning || isQueued) && job.status !== 'aborted' ? (
                      <button type="button" disabled={actingJobId === job.id} onClick={() => void handleCancel(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: actingJobId === job.id ? 'default' : 'pointer',
                          color: 'var(--miniapp-clay)', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                          opacity: actingJobId === job.id ? 0.5 : 1,
                        }}>
                        {actingJobId === job.id ? t('tasks.stopping') : t('tasks.stop')}
                      </button>
                    ) : null}
                    {(isFailed || job.status === 'aborted') ? (
                      <button type="button" disabled={actingJobId === job.id} onClick={() => void handleRetry(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: actingJobId === job.id ? 'default' : 'pointer',
                          color: 'var(--miniapp-sage)', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                          opacity: actingJobId === job.id ? 0.5 : 1,
                        }}>
                        {actingJobId === job.id ? t('tasks.retrying') : t('tasks.retry')}
                      </button>
                    ) : null}
                    {isCompleted && job.id ? (
                      <button type="button" onClick={() => setLogsJobId(job.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--miniapp-text-muted)', fontSize: 11, fontWeight: 600,
                          fontFamily: 'var(--miniapp-sans)', textDecoration: 'underline', padding: 0,
                        }}>
                        {t('tasks.viewLogs')}
                      </button>
                    ) : null}
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
            title={t('tasks.sendLogs')}
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
                ? t('tasks.logsEmptyWithProgress', { sent: logSent, failed: logFailed, total: logTotal })
                : t('tasks.logsEmptyNoProgress')
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
  const { t } = useTranslation()
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

  if (loading) return <Card title={t('analytics.title')} subtitle={t('analytics.subtitle')}><Note>{t('common.loading')}</Note></Card>

  const a = analytics
  const totalJobs = a?.jobs.total ?? 0
  const jobSuccessRate = totalJobs > 0 ? Math.round((a?.jobs.completed ?? 0) / totalJobs * 100) : 0
  const leadConversionRate = (a?.leads?.total ?? 0) > 0
    ? Math.round(((a?.leads?.by_status?.converted ?? 0) + (a?.leads?.by_status?.interested ?? 0)) / (a?.leads?.total ?? 1) * 100)
    : 0

  return (
    <Card title={t('analytics.title')} subtitle={t('analytics.subtitle')}>
      {status ? <Note>{status}</Note> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button tone="secondary" onClick={() => void refresh()}>{t('common.refresh')}</Button>
        <Button onClick={() => setShowSafety(!showSafety)}>
          {showSafety ? t('subscription.close') : t('analytics.configureSafety')}
        </Button>
      </div>

      {showSafety ? (
        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 16, marginTop: 12 }}>
          <div style={{ fontWeight: 600 }}>{t('analytics.safetyConfigTitle')}</div>
          <InputField
            label={t('analytics.maxActionsPerHour')}
            value={safetyMaxPerHour}
            onChange={setSafetyMaxPerHour}
            type="number"
            placeholder={t('analytics.maxActionsPerHourPlaceholder')}
          />
          <InputField
            label={t('analytics.maxMessagesPerDay')}
            value={safetyMaxPerDay}
            onChange={setSafetyMaxPerDay}
            type="number"
            placeholder={t('analytics.maxMessagesPerDayPlaceholder')}
          />
          <InputField
            label={t('analytics.minDelay')}
            value={safetyMinDelay}
            onChange={setSafetyMinDelay}
            type="number"
            placeholder={t('analytics.minDelayPlaceholder')}
          />
          <InputField
            label={t('analytics.cooldown')}
            value={safetyCooldown}
            onChange={setSafetyCooldown}
            type="number"
            placeholder={t('analytics.cooldownPlaceholder')}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={safetyEnabled}
                onChange={(e) => setSafetyEnabled(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              {t('analytics.safetyModeEnabled')}
            </label>
          </div>
          {safetyEnabled ? (
            <SelectField label={t('analytics.safetyModeDuration')} value={safetyHours} onChange={setSafetyHours}>
              <option value="0">{t('analytics.keepCurrent')}</option>
              <option value="24">{t('analytics.hours', { count: 24 })}</option>
              <option value="48">{t('analytics.hours', { count: 48 })}</option>
              <option value="72">{t('analytics.hours', { count: 72 })}</option>
              <option value="168">{t('analytics.days', { count: 7 })}</option>
            </SelectField>
          ) : null}
          <Button onClick={() => void saveSafety()} disabled={savingSafety}>
            {savingSafety ? t('analytics.saving') : t('analytics.saveSettings')}
          </Button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--miniapp-primary)' }}>{a?.leads?.total ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('analytics.totalLeads')}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#36664e' }}>{a?.leads?.by_status?.converted ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('analytics.converted')}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#475977' }}>{a?.jobs?.total ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('analytics.totalJobs')}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: a?.notifications?.unseen ? 'var(--miniapp-coral)' : 'var(--miniapp-sage)' }}>{a?.notifications?.unseen ?? 0}</div>
            <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)', marginTop: 4 }}>{t('analytics.unseenAlerts')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
          <div style={{ fontWeight: 600 }}>{t('analytics.safetyStatus')}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.safetyMode')}</span>
              <Badge tone={a?.safety?.safety_mode_enabled ? 'success' : 'warning'}>
                {a?.safety?.safety_mode_enabled ? t('analytics.enabled') : t('analytics.disabled')}
              </Badge>
            </div>
            {a?.safety?.safety_mode_until ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.safeUntil')}</span>
                <span>{formatDateTime(a.safety.safety_mode_until)}</span>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.maxActionsPerHourLabel')}</span>
              <span>{a?.safety?.max_actions_per_hour || t('analytics.notSet')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.maxMessagesPerDayLabel')}</span>
              <span>{a?.safety?.max_messages_per_day || t('analytics.notSet')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.minDelayLabel')}</span>
              <span>{a?.safety?.min_delay_seconds ? `${a.safety.min_delay_seconds}s` : t('analytics.notSet')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.cooldownLabel')}</span>
              <span>{a?.safety?.cooldown_minutes ? `${a.safety.cooldown_minutes}m` : t('analytics.notSet')}</span>
            </div>
          </div>
        </div>

        {a?.leads ? (
          <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
            <div style={{ fontWeight: 600 }}>{t('analytics.leadPipeline')}</div>
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
          <div style={{ fontWeight: 600 }}>{t('analytics.jobHealth')}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.successRate')}</span>
              <Badge tone={jobSuccessRate >= 80 ? 'success' : jobSuccessRate >= 50 ? 'warning' : 'warning'}>
                {jobSuccessRate}%
              </Badge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.completed')}</span>
              <span style={{ color: '#36664e' }}>{a?.jobs?.completed ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.failed')}</span>
              <span style={{ color: 'var(--miniapp-clay)' }}>{a?.jobs?.failed ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--miniapp-text-muted)' }}>{t('analytics.pending')}</span>
              <span style={{ color: '#475977' }}>{a?.jobs?.pending ?? 0}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, padding: 16, background: 'var(--miniapp-bg)', borderRadius: 14 }}>
          <div style={{ fontWeight: 600 }}>{t('analytics.conversionRate')}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--miniapp-primary)' }}>{leadConversionRate}%</div>
          <div style={{ fontSize: 12, color: 'var(--miniapp-text-muted)' }}>
            {t('analytics.conversionSummary', { interested: a?.leads?.by_status?.interested ?? 0, converted: a?.leads?.by_status?.converted ?? 0, total: a?.leads?.total ?? 0 })}
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
