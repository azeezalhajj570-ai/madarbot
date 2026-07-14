import { NavLink } from 'react-router-dom'
import { Activity, Bot, Cpu, Crown, HelpCircle, LayoutDashboard, LogOut, RefreshCw, ScrollText, Search, Settings, ShieldAlert, Shield, Ticket, UserPlus, Users, Heart, Briefcase, ClipboardList, Tag, FileText } from 'lucide-react'

import { radius, spacing, uiVars } from '../../../shared/ui-system/tokens'
import { clearAuth, getStoredUser, addAccount } from '../lib/auth'
import { useI18n } from '../lib/i18n'

const NAV = [
  { to: '/admin/health', label: 'nav.admin.health', icon: Heart },
  { to: '/admin/agents', label: 'nav.admin.agents', icon: Bot },
  { to: '/admin/jobs', label: 'nav.admin.jobs', icon: ClipboardList },
  { to: '/admin/bulk-add', label: 'nav.admin.bulkadd', icon: UserPlus },
  { to: '/admin/subscriptions', label: 'nav.admin.subscriptions', icon: Ticket },
  { to: '/admin/promo-codes', label: 'nav.admin.promocodes', icon: Tag },
  { to: '/admin/audit', label: 'nav.admin.audit', icon: FileText },
]

export default function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const user = getStoredUser()
  const { t, lang, setLang } = useI18n()

  function handleSwitchAccount() {
    const current = getStoredUser()
    if (current) addAccount(current)
    clearAuth()
    window.location.href = '/dashboard/login?switch=1'
  }

  return (
    <aside
      style={{
        width: 252,
        display: 'flex',
        flexDirection: 'column',
        padding: `${spacing.lg}px 0`,
        borderRight: `1px solid ${uiVars.border}`,
        background: uiVars.surface,
        height: '100%',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Language toggle */}
        <div style={{ padding: `0 ${spacing.lg}px ${spacing.sm}px`, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            {t('lang.switch')}
          </button>
        </div>

        {/* Brand */}
        <div style={{ padding: `${spacing.xl}px ${spacing.lg}px`, borderBottom: `1px solid ${uiVars.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: radius.md, background: uiVars.primary, color: uiVars.primaryText, display: 'grid', placeItems: 'center' }}>
              <Shield size={16} />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: uiVars.text }}>{t('app.name')}</div>
              <div style={{ fontSize: 13, color: uiVars.textMuted }}>{t('app.desc')}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: `${spacing.sm}px`, overflowY: 'auto', display: 'grid', gap: 2, alignContent: 'start' }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            color: uiVars.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            padding: `0 ${spacing.sm}px ${spacing.xs}px`,
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
                padding: '10px 12px',
                borderRadius: radius.md,
                color: isActive ? uiVars.text : uiVars.textMuted,
                background: isActive ? uiVars.bgMuted : 'transparent',
                border: `1px solid ${isActive ? uiVars.borderStrong : 'transparent'}`,
                fontWeight: isActive ? 700 : 600,
              })}
            >
              <Icon size={15} />
              {t(label)}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div style={{ padding: `${spacing.lg}px`, borderTop: `1px solid ${uiVars.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: radius.md, background: uiVars.bgMuted, color: uiVars.primary, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>
              {user?.username?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{user?.username ?? 'User'}</div>
              <div style={{ fontSize: 12, color: uiVars.textMuted }}>{user?.role ?? 'admin'}</div>
            </div>
          </div>
          <button onClick={handleSwitchAccount} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 8, color: uiVars.textMuted, cursor: 'pointer', fontWeight: 700 }}>
            <RefreshCw size={13} />
            {t('sidebar.switchAccount')}
          </button>
          <button onClick={() => { clearAuth(); window.location.href = '/dashboard/login?logout=1'; }} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 8, color: uiVars.textMuted, cursor: 'pointer', fontWeight: 400, fontSize: 12, marginTop: 4 }}>
            <LogOut size={11} />
            {t('sidebar.logout')}
          </button>
        </div>
      </div>
    </aside>
  )
}
