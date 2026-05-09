import React, { useState } from 'react'

export interface SidebarNavItem {
  id: string
  label: string
  icon: string
  active: boolean
  onClick: () => void
}

interface SidebarLayoutProps {
  title: string
  subtitle: React.ReactNode
  accountName?: string
  navItems: SidebarNavItem[]
  children: React.ReactNode
}

const NAV_ICONS: Record<string, string> = {
  accounts: 'manage_accounts',
  groups: 'person_search',
  scraping: 'travel_explore',
  tasks: 'assignment',
  leads: 'person_search',
  analytics: 'monitoring',
  notifications: 'notifications',
  analysis: 'analytics',
}

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  title,
  subtitle,
  accountName,
  navItems,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(false)
  const sidebarWidth = collapsed ? 56 : 220

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--miniapp-bg)', fontFamily: 'var(--miniapp-sans)' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: sidebarWidth,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--miniapp-surface)',
          borderRight: '1px solid var(--miniapp-border-soft)',
          transition: 'width 0.25s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 10px',
            borderBottom: '1px solid var(--miniapp-border-soft)',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--miniapp-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--miniapp-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                {accountName || subtitle}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            style={{
              flexShrink: 0,
              width: 30,
              height: 30,
              borderRadius: 6,
              border: 'none',
              background: 'var(--miniapp-bg)',
              color: 'var(--miniapp-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {collapsed ? 'menu_open' : 'menu'}
            </span>
          </button>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {navItems.map((item) => {
            const countMatch = item.label.match(/\((\d+)\)/)
            const badgeCount = countMatch ? countMatch[1] : null
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: collapsed ? 0 : 10,
                  width: '100%',
                  padding: collapsed ? '10px 0' : '10px 14px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  fontSize: 13,
                  fontWeight: item.active ? 500 : 400,
                  color: item.active ? 'var(--miniapp-coral)' : 'var(--miniapp-text-secondary)',
                  background: item.active ? 'var(--miniapp-coral-dim)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderRight: item.active ? '2px solid var(--miniapp-coral)' : '2px solid transparent',
                  transition: 'background 0.15s, color 0.15s',
                  fontFamily: 'var(--miniapp-sans)',
                  position: 'relative',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20, flexShrink: 0 }}>
                  {NAV_ICONS[item.id] || 'circle'}
                </span>
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {badgeCount ? item.label.replace(` (${badgeCount})`, '') : item.label}
                    </span>
                    {badgeCount && (
                      <span
                        style={{
                          flexShrink: 0,
                          minWidth: 20,
                          height: 20,
                          borderRadius: 10,
                          background: 'var(--miniapp-coral)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 5px',
                        }}
                      >
                        {badgeCount}
                      </span>
                    )}
                  </>
                )}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px 40px', maxWidth: 720, margin: '0 auto' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
