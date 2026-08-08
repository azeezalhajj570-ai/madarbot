import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link2, KeyRound, Smartphone, CheckCircle2 } from 'lucide-react'

import { Dialog, Button, Input, Field } from './ui/primitives'
import { startAgentAuth, submitAgentCode, submitAgentPassword } from '../lib/api'
import type { Agent } from '../lib/types'

type Step = 'phone' | 'code' | 'password'

export default function AgentActivationDialog({ agent, open, onClose }: {
  agent: Agent | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (open && agent) {
      setStep('phone')
      setPhone(agent.phone_number || '')
      setCode('')
      setPassword('')
      setError(null)
      setSuccess(false)
    }
  }, [open, agent])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['owner', 'agents'] })
    queryClient.invalidateQueries({ queryKey: ['owner', 'stats'] })
    queryClient.invalidateQueries({ queryKey: ['my-agents'] })
  }

  const startMutation = useMutation({
    mutationFn: async (phoneNumber: string): Promise<{ agent: Agent }> => {
      const res = await startAgentAuth(null, phoneNumber, agent!.id)
      return res as { agent: Agent }
    },
    onSuccess: (data) => {
      const next = data.agent
      setStep(next.auth_state === 'pending_2fa' ? 'password' : 'code')
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const codeMutation = useMutation({
    mutationFn: async (value: string): Promise<{ agent: Agent }> => {
      const res = await submitAgentCode(agent!.id, value)
      return res as { agent: Agent }
    },
    onSuccess: (data) => {
      const next = data.agent
      if (next.auth_state === 'pending_2fa') {
        setStep('password')
        setCode('')
        setError(null)
        return
      }
      setSuccess(true)
      refresh()
    },
    onError: (err: Error) => setError(err.message),
  })

  const passwordMutation = useMutation({
    mutationFn: (value: string) => submitAgentPassword(agent!.id, value),
    onSuccess: () => {
      setSuccess(true)
      refresh()
    },
    onError: (err: Error) => setError(err.message),
  })

  const busy = startMutation.isPending || codeMutation.isPending || passwordMutation.isPending

  if (!agent) return null

  const dialogTitle = success
    ? 'Account activated'
    : step === 'phone'
      ? 'Activate account'
      : step === 'password'
        ? 'Two-step verification'
        : 'Enter confirmation code'

  return (
    <Dialog open={open} title={dialogTitle} onClose={busy ? () => {} : onClose}>
      {success ? (
        <>
          <div style={{ display: 'grid', placeItems: 'center', gap: 12, padding: '24px 0', textAlign: 'center' }}>
            <CheckCircle2 size={48} style={{ color: 'var(--ui-success, #16a34a)' }} />
            <div style={{ fontWeight: 700 }}>
              {agent.external_account_id} is now an active linked account and can be used for bulk operations.
            </div>
          </div>
          <Button onClick={onClose}>Done</Button>
        </>
      ) : step === 'phone' ? (
        <>
          <p style={{ margin: 0, color: 'var(--ui-text-muted)' }}>
            Enter the Telegram phone number of the account you logged in with. Telegram will send a
            confirmation code to this account.
          </p>
          <Field label="Phone number" hint="International format, e.g. +966501234567">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+966501234567"
              inputMode="tel"
            />
          </Field>
          {error ? <ErrorText text={error} /> : null}
          <Button
            onClick={() => startMutation.mutate(phone.trim())}
            disabled={busy || !phone.trim()}
          >
            <Smartphone size={16} /> Send code
          </Button>
        </>
      ) : step === 'code' ? (
        <>
          <p style={{ margin: 0, color: 'var(--ui-text-muted)' }}>
            Enter the confirmation code that Telegram sent to <strong>{phone}</strong>.
          </p>
          <Field label="Confirmation code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="00000"
              inputMode="numeric"
              autoFocus
            />
          </Field>
          {error ? <ErrorText text={error} /> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => codeMutation.mutate(code.trim())}
              disabled={busy || !code.trim()}
            >
              <KeyRound size={16} /> Verify code
            </Button>
            <Button variant="ghost" onClick={() => { setStep('phone'); setError(null) }} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--ui-text-muted)' }}>
            This account has two-step verification enabled. Enter your Telegram cloud password.
          </p>
          <Field label="Cloud password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
            />
          </Field>
          {error ? <ErrorText text={error} /> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              onClick={() => passwordMutation.mutate(password)}
              disabled={busy || !password}
            >
              <Link2 size={16} /> Finish linking
            </Button>
            <Button variant="ghost" onClick={() => { setStep('code'); setError(null) }} disabled={busy}>
              Back
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}

function ErrorText({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--ui-danger, #dc2626)', background: 'color-mix(in srgb, var(--ui-danger, #dc2626) 8%, transparent)', padding: '10px 12px', borderRadius: 8 }}>
      {text}
    </div>
  )
}
