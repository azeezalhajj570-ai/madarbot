import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { acceptInvitation } from '../lib/api'
import { isAuthenticated } from '../lib/auth'

export default function AcceptPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'login_required'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    let token = params.get('token')

    if (!token) {
      token = sessionStorage.getItem('pending_accept_token')
      if (token) {
        sessionStorage.removeItem('pending_accept_token')
      }
    }

    if (!token) {
      setStatus('error')
      setMessage('Invalid or missing invitation link')
      return
    }

    if (!isAuthenticated()) {
      sessionStorage.setItem('pending_accept_token', token)
      window.location.href = '/dashboard/login?redirect=' + encodeURIComponent('/dashboard/accept')
      return
    }

    sessionStorage.removeItem('pending_accept_token')
    acceptInvitation(token)
      .then((res) => {
        setStatus('success')
        setMessage(`Joined "${res.workspace_name}" as ${res.role}`)
        setTimeout(() => {
          window.location.href = '/dashboard/'
        }, 2000)
      })
      .catch((err) => {
        const detail = err?.response?.data?.detail || 'Failed to accept invitation'
        setStatus('error')
        setMessage(detail)
      })
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        padding: 40,
        borderRadius: 16,
        background: '#1a1a1a',
        textAlign: 'center',
        maxWidth: 400,
        width: '90%',
      }}>
        {status === 'loading' && (
          <>
            <Loader2 size={48} style={{ animation: 'spin 1s linear infinite', marginBottom: 16, color: '#6366f1' }} />
            <h2 style={{ margin: 0, fontSize: 18 }}>Accepting invitation...</h2>
          </>
        )}
        {status === 'login_required' && (
          <>
            <Loader2 size={48} style={{ animation: 'spin 1s linear infinite', marginBottom: 16, color: '#f59e0b' }} />
            <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#f59e0b' }}>Login Required</h2>
            <p style={{ margin: 0, color: '#999', fontSize: 14 }}>{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} style={{ marginBottom: 16, color: '#22c55e' }} />
            <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#22c55e' }}>Welcome!</h2>
            <p style={{ margin: 0, color: '#ccc', fontSize: 14 }}>{message}</p>
            <p style={{ margin: '16px 0 0', color: '#666', fontSize: 12 }}>Redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={48} style={{ marginBottom: 16, color: '#ef4444' }} />
            <h2 style={{ margin: '0 0 8px', fontSize: 18, color: '#ef4444' }}>Error</h2>
            <p style={{ margin: 0, color: '#ccc', fontSize: 14 }}>{message}</p>
            <button
              onClick={() => window.location.href = '/dashboard/'}
              style={{
                marginTop: 20,
                padding: '10px 24px',
                borderRadius: 8,
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
