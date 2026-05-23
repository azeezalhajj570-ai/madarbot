export interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'owner'
  telegramId?: number
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('auth_user')
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function storeAuth(token: string, user: AuthUser) {
  localStorage.setItem('auth_token', token)
  localStorage.setItem('auth_user', JSON.stringify(user))
  addAccount(user)
}

export function clearAuth() {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
}

export function isAuthenticated(): boolean {
  return !!localStorage.getItem('auth_token')
}

export function getStoredAccounts(): AuthUser[] {
  try {
    const raw = localStorage.getItem('auth_accounts')
    return raw ? (JSON.parse(raw) as AuthUser[]) : []
  } catch {
    return []
  }
}

export function addAccount(user: AuthUser) {
  const accounts = getStoredAccounts().filter(a => a.id !== user.id)
  accounts.unshift(user)
  if (accounts.length > 10) accounts.length = 10
  localStorage.setItem('auth_accounts', JSON.stringify(accounts))
}

export function removeAccount(userId: number) {
  const accounts = getStoredAccounts().filter(a => a.id !== userId)
  localStorage.setItem('auth_accounts', JSON.stringify(accounts))
}

export function switchAccount(user: AuthUser) {
  const token = localStorage.getItem('auth_token')
  if (token) addAccount(getStoredUser()!)
  localStorage.setItem('auth_user', JSON.stringify(user))
}
