import { useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Heart, Bot, Search, ClipboardList, Tag, Menu, X } from 'lucide-react'

import { spacing, uiVars } from '../../../shared/ui-system/tokens'
import { isAuthenticated } from '../lib/auth'
import { I18nProvider, useI18n } from '../lib/i18n'
import Sidebar from './Sidebar'

const NAV = [
  { to: '/admin/health', label: 'nav.admin.health', icon: Heart },
  { to: '/admin/agents', label: 'nav.admin.agents', icon: Bot },
  { to: '/admin/scraper', label: 'nav.scraper', icon: Search },
  { to: '/admin/jobs', label: 'nav.admin.jobs', icon: ClipboardList },
  { to: '/admin/promo-codes', label: 'nav.admin.promocodes', icon: Tag },
]

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
