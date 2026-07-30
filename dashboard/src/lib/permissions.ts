import { getStoredUser } from './auth'

export type Role = 'owner' | 'admin' | 'user'

export const ROLES: Record<string, Role> = {
  OWNER: 'owner',
  ADMIN: 'admin',
  USER: 'user',
}

const GUARDS: Record<string, Role[]> = {
  '/workspace': [],
  '/agents': ['owner', 'admin'],
  '/scraper': [],
  '/usage': [],
  '/blacklist': [],
  '/jobs': [],
  '/bulk-add': [],
  '/profile': [],
  '/admin/profile': ['owner', 'admin'],
  '/settings': [],
  '/settings/ai': [],
  '/admin/health': ['owner', 'admin'],
  '/admin/agents': ['owner', 'admin'],
  '/admin/jobs': ['owner', 'admin'],
  '/admin/subscriptions': ['owner', 'admin'],
  '/admin/promo-codes': ['owner', 'admin'],
  '/admin/bulk-add': ['owner', 'admin'],
  '/admin/audit': ['owner', 'admin'],
  '/admin/ai-settings': ['owner', 'admin'],
  '/admin/knowledge': ['owner', 'admin'],
  '/admin/admissions': ['owner', 'admin'],
  '/admin/workspace': ['owner', 'admin'],
  '/admin/usage': [],
  '/admin/scraper': ['owner', 'admin'],
}

function getRole(): Role {
  const user = getStoredUser()
  if (!user) return 'user'
  if (user.role === 'owner') return 'owner'
  if (user.role === 'admin') return 'admin'
  return 'user'
}

export function canAccess(path: string): boolean {
  const allowed = GUARDS[path]
  if (!allowed) return false
  if (allowed.length === 0) return true
  return allowed.includes(getRole())
}

export function filterNav<T extends { to: string }>(items: T[]): T[] {
  const role = getRole()
  return items.filter(item => {
    const allowed = GUARDS[item.to]
    if (!allowed) return false
    if (allowed.length === 0) return true
    return allowed.includes(role)
  })
}


