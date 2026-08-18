export interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'owner' | 'user'
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
  localStorage.removeItem('auth_accounts')
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

export function switchAccount(_user: AuthUser) {
  // Account switching clears the current session and redirects to login.
  // The stored accounts list is preserved so the user can pick from it.
  // Re-authentication is required because JWT tokens are per-account and
  // we don't store tokens for other accounts.
  localStorage.removeItem('auth_token')
  localStorage.removeItem('auth_user')
}
