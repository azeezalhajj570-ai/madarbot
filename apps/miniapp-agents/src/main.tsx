import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'

import './i18n'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

const isTelegram = !!(window as any).Telegram?.WebApp

function AppShell() {
  const [sdkReady, setSdkReady] = useState(false)

  useEffect(() => {
    if (isTelegram) {
      import('@telegram-apps/sdk')
        .then(({ init }) => init())
        .catch((err: unknown) => console.warn('Telegram SDK init failed:', err))
        .finally(() => setSdkReady(true))
    } else {
      setSdkReady(true)
    }
  }, [])

  if (!sdkReady) return null

  return isTelegram ? (
    <AppRoot>
      <App />
    </AppRoot>
  ) : (
    <App />
  )
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </StrictMode>,
)
