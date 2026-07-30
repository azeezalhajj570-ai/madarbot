import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { Button, Card, Field, Input } from '../../components/ui/primitives'
import { useI18n } from '../../lib/i18n'
import { PageShell } from '../../lib/page-shell'
import { useToast } from '../../components/ui/toast'
import { fetchCurrentUser, updateProfile, changePassword } from '../../lib/api'
import { spacing, typeScale, uiVars } from '../../../../shared/ui-system/tokens'

interface ProfileUser {
  id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  phone_number: string | null
  has_password: boolean
}

function errorDetail(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export default function AdminProfilePage() {
  const { t } = useI18n()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: me, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => fetchCurrentUser(),
  })
  const user: ProfileUser | undefined = me?.user

  const [fullName, setFullName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || user.username || '')
    }
  }, [user?.full_name, user?.username])

  const profileMutation = useMutation({
    mutationFn: () => updateProfile({ full_name: fullName || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success(t('profile.saved'))
    },
    onError: (error) => toast.error(errorDetail(error, t('profile.saveError'))),
  })

  const passwordMutation = useMutation({
    mutationFn: () =>
      changePassword({
        current_password: user?.has_password ? currentPassword : undefined,
        new_password: newPassword,
      }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success(t('profile.passwordChanged'))
    },
    onError: (error) => toast.error(errorDetail(error, t('profile.passwordError'))),
  })

  const passwordsMismatch = newPassword.length > 0 && newPassword !== confirmPassword
  const canSubmitPassword =
    newPassword.length >= 6 &&
    !passwordsMismatch &&
    (!user?.has_password || currentPassword.length > 0)

  function handleSaveProfile() {
    profileMutation.mutate()
  }

  function handleSavePassword() {
    passwordMutation.mutate()
  }

  return (
    <PageShell titleKey="page.admin.profile" descriptionKey="page.admin.profile.desc" loading={isLoading}>
      {user ? (
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))', alignItems: 'start' }}>
          <Card style={{ display: 'grid', gap: spacing.lg }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: typeScale.body, marginBottom: 4 }}>{t('profile.details')}</div>
              <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>
                {t('profile.telegramUsername')}: {user.username ? `@${user.username}` : t('profile.none')}
              </div>
            </div>

            <Field label={t('profile.phoneNumber')}>
              {user.phone_number ? (
                <Input type="tel" value={user.phone_number} disabled style={{ opacity: 0.6 }} />
              ) : (
                <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted, padding: '8px 0' }}>
                  {t('common.none')} — set via phone login
                </div>
              )}
            </Field>

            <Field label={t('profile.fullName')}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>

            <div style={{ borderTop: `1px solid ${uiVars.border}`, paddingTop: spacing.md, display: 'grid', gap: spacing.md }}>
              <div style={{ fontWeight: 800, fontSize: typeScale.body }}>
                {user.has_password ? t('profile.changePassword') : t('profile.setPassword')}
              </div>

              {user.has_password ? (
                <Field label={t('profile.currentPassword')}>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </Field>
              ) : (
                <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>
                  {t('profile.setPasswordDesc')}
                </div>
              )}

              <Field label={t('profile.newPassword')} hint={t('profile.newPasswordHint')}>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>

              <Field label={t('profile.confirmPassword')}>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>

              {passwordsMismatch ? (
                <div style={{ fontSize: typeScale.caption, color: uiVars.danger }}>
                  {t('profile.passwordMismatch')}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end', borderTop: `1px solid ${uiVars.border}`, paddingTop: spacing.md }}>
              <Button
                onClick={handleSavePassword}
                disabled={passwordMutation.isPending || !canSubmitPassword}
                variant="outline"
              >
                {passwordMutation.isPending
                  ? t('profile.saving')
                  : user.has_password
                    ? t('profile.changePassword')
                    : t('profile.setPassword')}
              </Button>
              <Button
                onClick={handleSaveProfile}
                disabled={profileMutation.isPending}
              >
                {profileMutation.isPending ? t('profile.saving') : t('profile.save')}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </PageShell>
  )
}
