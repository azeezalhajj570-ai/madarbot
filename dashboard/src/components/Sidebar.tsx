import { NavLink } from 'react-router-dom'
import { Activity, Bot, Brain, BookOpen, Cpu, Crown, GraduationCap, HelpCircle, LayoutDashboard, LogOut, Monitor, Moon, RefreshCw, ScrollText, Search, Settings, ShieldAlert, Shield, Sun, Ticket, UserPlus, Users, Heart, Briefcase, ClipboardList, Tag, FileText } from 'lucide-react'

import { radius, spacing, typeScale, uiVars } from '../../../shared/ui-system/tokens'
import { clearAuth, getStoredUser, addAccount } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { useTheme } from '../lib/theme'

const NAV = [
  { to: '/admin/health', label: 'nav.admin.health', icon: Heart },
  { to: '/admin/agents', label: 'nav.admin.agents', icon: Bot },
  { to: '/admin/jobs', label: 'nav.admin.jobs', icon: ClipboardList },
  { to: '/admin/bulk-add', label: 'nav.admin.bulkadd', icon: UserPlus },
  { to: '/admin/subscriptions', label: 'nav.admin.subscriptions', icon: Ticket },
  { to: '/admin/promo-codes', label: 'nav.admin.promocodes', icon: Tag },
  { to: '/admin/audit', label: 'nav.admin.audit', icon: FileText },
  { to: '/admin/ai-settings', label: 'nav.admin.ai', icon: Brain },
  { to: '/admin/knowledge', label: 'nav.admin.knowledge', icon: BookOpen },
  { to: '/admin/admissions', label: 'nav.admin.admission', icon: GraduationCap },
]

export default function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const user = getStoredUser()
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()

  function handleSwitchAccount() {
    const current = getStoredUser()
    if (current) addAccount(current)
    clearAuth()
    window.location.href = '/dashboard/login?switch=1'
  }

  return (
    <aside
      style={{
        width: 240,
        display: 'flex',
        flexDirection: 'column',
        background: uiVars.surface,
        borderInlineEnd: `1px solid ${uiVars.border}`,
        height: '100%',
      }}
    >
      {/* Brand */}
      <div style={{ padding: `${spacing.xl}px ${spacing.lg}px`, borderBottom: `1px solid ${uiVars.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: radius.md, background: uiVars.primary, color: uiVars.primaryText, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Shield size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: '20px', color: uiVars.text }}>{t('app.name')}</div>
            <div style={{ fontSize: 12, color: uiVars.textMuted }}>{t('app.desc')}</div>
          </div>
        </div>
      </div>

      {/* Theme + Language toggles */}
      <div style={{ padding: `${spacing.sm}px ${spacing.lg}px`, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          className="lang-toggle"
          onClick={() => {
            const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
            const idx = order.indexOf(theme)
            setTheme(order[(idx + 1) % order.length])
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px' }}
          title={theme === 'light' ? t('theme.light') : theme === 'dark' ? t('theme.dark') : t('theme.system')}
        >
          {theme === 'light' ? <Moon size={13} /> : theme === 'dark' ? <Monitor size={13} /> : <Sun size={13} />}
        </button>
        <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          {t('lang.switch')}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: `0 ${spacing.sm}px ${spacing.sm}px`, overflowY: 'auto', display: 'grid', gap: 1, alignContent: 'start' }}>
        <div style={{
          fontSize: typeScale.micro,
          fontWeight: 700,
          color: uiVars.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          padding: `${spacing.md}px ${spacing.sm}px ${spacing.xs}px`,
        }}>
          Admin
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavClick}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: radius.md,
              color: isActive ? uiVars.text : uiVars.textMuted,
              background: isActive ? uiVars.primarySoft : 'transparent',
              fontWeight: isActive ? 700 : 500,
              fontSize: 14,
              transition: 'background 0.1s, color 0.1s',
            })}
          >
            <Icon size={15} />
            {t(label)}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div style={{ padding: `${spacing.md}px ${spacing.lg}px`, borderTop: `1px solid ${uiVars.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: radius.md, background: uiVars.bgMuted, color: uiVars.primary, display: 'grid', placeItems: 'center', fontSize: typeScale.caption, fontWeight: 800, flexShrink: 0 }}>
            {user?.username?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, lineHeight: '16px' }}>{user?.username ?? 'User'}</div>
            <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>{user?.role ?? 'admin'}</div>
          </div>
        </div>
        <button onClick={handleSwitchAccount} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 6, color: uiVars.textMuted, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
          <RefreshCw size={11} />
          {t('sidebar.switchAccount')}
        </button>
        <button onClick={() => { clearAuth(); window.location.href = '/dashboard/login?logout=1' }} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 6, color: uiVars.textSubtle, cursor: 'pointer', fontWeight: 500, fontSize: 12, marginTop: 2 }}>
          <LogOut size={10} />
          {t('sidebar.logout')}
        </button>
      </div>
    </aside>
  )
}

