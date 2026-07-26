import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

import { storeAuth, getStoredAccounts, switchAccount, removeAccount, type AuthUser } from '../lib/auth'
import { fetchCurrentUser, login, telegramLogin } from '../lib/api'
import { Button, Card, Field, Input } from '../components/ui/primitives'
import { I18nProvider, useI18n } from '../lib/i18n'

type TelegramAuthCallback = (user: Record<string, unknown>) => void
type WindowWithTelegramAuth = Window & typeof globalThis & Record<string, TelegramAuthCallback | undefined>

function LoginInner() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t, lang, setLang } = useI18n()
  const searchParams = new URLSearchParams(location.search)
  const switching = searchParams.get('switch') === '1'
  const loggingOut = searchParams.get('logout') === '1'
  const redirectTo = searchParams.get('redirect') || '/'

  function afterLogin() {
    if (redirectTo !== '/') {
      window.location.href = redirectTo
    } else {
      navigate('/')
    }
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [storedAccounts, setStoredAccounts] = useState<AuthUser[]>(getStoredAccounts)
  const [showNewAccount, setShowNewAccount] = useState(!switching && storedAccounts.length === 0)
  const [telegramBotId, setTelegramBotId] = useState<string>('')
  const [telegramKey, setTelegramKey] = useState(0)

  useEffect(() => {
    if (loggingOut) {
      setTelegramKey((k) => k + 1)
    }
  }, [loggingOut])

  useEffect(() => {
    const container = document.getElementById('telegram-login-widget')
    if (!container) return
    let cancelled = false
    const callbackName = 'onTelegramDashboardAuth'
    const authWindow = window as WindowWithTelegramAuth
    authWindow[callbackName] = (telegramUser) => {
      void (async () => {
        setLoading(true)
        setError('')
        try {
          const { token } = await telegramLogin(telegramUser)
          const me = await fetchCurrentUser(token)
          storeAuth(token, {
            id: me.user.id,
            username: me.user.username || me.user.first_name || 'telegram',
            role: me.is_bot_owner ? 'owner' : 'user',
            telegramId: me.user.id,
          })
          afterLogin()
        } catch {
          setError('Telegram login failed')
        } finally {
          setLoading(false)
        }
      })()
    }
    void (async () => {
      try {
        const response = await fetch('/auth/telegram/widget-config')
        if (!response.ok || cancelled) return
        const config = (await response.json()) as { bot_username?: string; bot_id?: string }
        if (!config.bot_username) return
        if (config.bot_id) setTelegramBotId(config.bot_id)
        const script = document.createElement('script')
        script.src = 'https://telegram.org/js/telegram-widget.js?22'
        script.setAttribute('data-telegram-login', config.bot_username)
        script.setAttribute('data-size', 'large')
        script.setAttribute('data-radius', '8')
        script.setAttribute('data-onauth', `${callbackName}(user)`)
        script.setAttribute('data-request-access', 'write')
        script.async = true
        container.appendChild(script)
      } catch {
        setError('Unable to load Telegram login')
      }
    })()
    return () => {
      cancelled = true
      container.innerHTML = ''
      delete authWindow[callbackName]
    }
  }, [telegramKey])

  function handleSwitchTelegram() {
    const params = new URLSearchParams({
      bot_id: telegramBotId,
      origin: window.location.origin,
      request_access: 'write',
      return_to: window.location.href,
    })
    window.open(`https://oauth.telegram.org/auth?${params}`, '_blank')
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { token } = await login(email, password)
      const me = await fetchCurrentUser(token)
      storeAuth(token, {
        id: me.user.id,
        username: me.user.username || me.user.first_name || 'dashboard',
        role: me.is_bot_owner ? 'owner' : 'admin',
        telegramId: me.user.id,
      })
      afterLogin()
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dashboard-auth-shell" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.2fr 1fr', background: 'var(--ui-bg)' }}>
      <div style={{ padding: 56, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#1d2b36', color: '#f8fbfb', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: 48, height: 48, borderRadius: 10, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.94 8.19l-2.02 9.52c-.15.68-.54.84-1.08.52l-3-2.21-1.45 1.4c-.16.16-.3.3-.61.3l.21-3.04 5.53-5c.24-.21-.05-.33-.37-.12L6.26 14.5l-2.95-.92c-.64-.2-.65-.64.14-.95l11.56-4.46c.53-.19.99.13.93.02z"/></svg>
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>{t('app.name')}</div>
          <div style={{ fontSize: 15, color: 'rgba(248,251,251,0.72)', marginBottom: 24, maxWidth: 420 }}>{t('app.desc')}</div>
          {[t('nav.rules'), t('nav.automation'), t('nav.owner')].map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: 'rgba(255,255,255,0.85)' }}>
            <span style={{ width: 18, height: 18, borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: '#dff8fb', display: 'grid', placeItems: 'center', fontSize: 12 }}>✓</span>
            {item}
          </div>
        ))}
      </div>
      <div style={{ padding: 48, display: 'grid', placeItems: 'center' }}>
        <Card style={{ width: 'min(460px, 100%)', padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{t('login.title')}</div>
            <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>{t('lang.switch')}</button>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'grid', gap: 12 }}>
            <Field label={t('login.email')}><Input placeholder={t('login.email')} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t('login.password')}><Input type="password" placeholder={t('login.password')} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? '…' : t('login.submit')}
            </Button>
          </form>
          <div style={{ position: 'relative', margin: '20px 0', textAlign: 'center' }}>
            <div style={{ height: 1, background: 'var(--ui-border)' }} />
            <span style={{ position: 'absolute', left: '50%', top: 0, transform: 'translate(-50%, -50%)', background: 'var(--ui-surface)', padding: '0 8px', fontSize: 12, color: 'var(--ui-text-muted)' }}>or</span>
          </div>
          <div id="telegram-login-widget" />
          <button
            onClick={handleSwitchTelegram}
            disabled={!telegramBotId}
            style={{ background: 'none', border: 'none', padding: '8px 0 0', color: 'var(--ui-text-muted)', cursor: telegramBotId ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, width: '100%', textAlign: 'center', opacity: telegramBotId ? 1 : 0.5 }}
          >
            {telegramBotId ? 'Use another Telegram account' : 'Loading Telegram…'}
          </button>
          {error ? <div style={{ color: 'var(--ui-danger)', fontSize: 13, marginTop: 12 }}>{error}</div> : null}
          {!showNewAccount && storedAccounts.length > 0 ? (
            <>
              <div style={{ position: 'relative', margin: '20px 0', textAlign: 'center' }}>
                <div style={{ height: 1, background: 'var(--ui-border)' }} />
                <span style={{ position: 'absolute', left: '50%', top: 0, transform: 'translate(-50%, -50%)', background: 'var(--ui-surface)', padding: '0 8px', fontSize: 12, color: 'var(--ui-text-muted)' }}>Accounts</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {storedAccounts.map(account => (
                  <button
                    key={account.id}
                    onClick={() => {
                      switchAccount(account)
                      afterLogin()
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--ui-border)', background: 'var(--ui-surface-strong)', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--ui-primary)', color: 'var(--ui-primary-text)', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                      {account.username[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{account.username}</div>
                      <div style={{ fontSize: 12, color: 'var(--ui-text-muted)' }}>{account.role}</div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        removeAccount(account.id)
                        setStoredAccounts(getStoredAccounts())
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--ui-text-muted)', cursor: 'pointer', fontSize: 18, padding: '4px 8px', lineHeight: 1 }}
                      title="Remove account"
                    >×</button>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowNewAccount(true)}
                style={{ width: '100%', marginTop: 8, padding: '10px 14px', borderRadius: 10, border: '1px dashed var(--ui-border)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--ui-text-muted)', fontWeight: 600 }}
              >
                + Sign in with another account
              </button>
            </>
          ) : storedAccounts.length > 0 ? (
            <button
              onClick={() => setShowNewAccount(false)}
              style={{ width: '100%', marginTop: 16, padding: '10px 14px', borderRadius: 10, border: '1px dashed var(--ui-border)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--ui-text-muted)', fontWeight: 600 }}
            >
              ← Back to accounts
            </button>
          ) : null}
        </Card>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <I18nProvider>
      <LoginInner />
    </I18nProvider>
  )
}
