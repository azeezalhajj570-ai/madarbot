import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Search, ClipboardList, Menu, X, Building2, Bot, Brain, UserPlus, Gauge } from 'lucide-react'

import { spacing, uiVars } from '../../../shared/ui-system/tokens'
import { isAuthenticated } from '../lib/auth'
import { I18nProvider, useI18n } from '../lib/i18n'
import { filterNav } from '../lib/permissions'
import Sidebar from './Sidebar'

const NAV = filterNav([
  { to: '/workspace', label: 'nav.admin.workspace', icon: Building2 },
  { to: '/agents', label: 'nav.agents', icon: Bot },
  { to: '/scraper', label: 'nav.scraper', icon: Search },
  { to: '/usage', label: 'nav.admin.usage', icon: Gauge },
  { to: '/jobs', label: 'nav.jobs', icon: ClipboardList },
  { to: '/bulk-add', label: 'nav.admin.bulkadd', icon: UserPlus },
  { to: '/settings/ai', label: 'nav.admin.ai', icon: Brain },
])

function LayoutInner() {
  const { t, lang, setLang, dir } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />
  }

  return (
    <div
      className="dashboard-layout"
      style={{
        display: 'flex',
        height: '100vh',
        background: uiVars.bg,
        overflow: 'hidden',
        color: uiVars.text,
      }}
    >
      {/* Mobile overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'mobile-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Mobile hamburger */}
      <button
        className="mobile-hamburger"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {/* Sidebar */}
      <div className={`dashboard-sidebar ${sidebarOpen ? 'mobile-open' : ''}`}>
        <Sidebar onNavClick={() => setSidebarOpen(false)} />
      </div>

      {/* Main */}
      <main
        className="dashboard-main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

export default function Layout() {
  return (
    <I18nProvider>
      <LayoutInner />
    </I18nProvider>
  )
}
