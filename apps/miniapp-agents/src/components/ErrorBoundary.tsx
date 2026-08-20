import { Component, type ReactNode } from 'react'

import i18n from '../i18n'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (this.state.hasError) {
      const t = (key: string) => i18n.t(key)
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 24,
            backgroundColor: 'var(--tg-theme-bg-color, #1a1a1a)',
            color: 'var(--tg-theme-text-color, #fff)',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{t('error.title')}</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--tg-theme-hint-color, #999)', fontSize: 14, maxWidth: 320 }}>
            {t('error.message')}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null, hasError: false })
            }}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: 'var(--tg-theme-button-color, #2481cc)',
              color: 'var(--tg-theme-button-text-color, #fff)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('error.tryAgain')}
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: '10px 24px',
              borderRadius: 8,
              border: '1px solid var(--tg-theme-hint-color, #555)',
              background: 'transparent',
              color: 'var(--tg-theme-hint-color, #999)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {t('error.reload')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
