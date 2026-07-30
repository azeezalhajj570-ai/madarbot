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
  const [phoneNumber, setPhoneNumber] = useState('')
  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '')
      setPhoneNumber(user.phone_number || '')
    }
  }, [user?.full_name, user?.phone_number])

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const profileMutation = useMutation({
    mutationFn: () => updateProfile({ full_name: fullName, phone_number: phoneNumber || undefined }),
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

  return (
    <PageShell titleKey="page.admin.profile" descriptionKey="page.admin.profile.desc" loading={isLoading}>
      {user ? (
        <div style={{ display: 'grid', gap: 20, maxWidth: 480 }}>
          <Card style={{ display: 'grid', gap: spacing.md }}>
            <div style={{ fontWeight: 800, fontSize: typeScale.body }}>{t('profile.details')}</div>
            <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>
              {t('profile.telegramUsername')}: {user.username ? `@${user.username}` : t('profile.none')}
            </div>
            <Field label={t('profile.fullName')}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label={t('profile.phoneNumber')} hint={t('profile.phoneNumberHint')}>
              <Input
                type="tel"
                placeholder={t('login.phonePlaceholder')}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </Field>
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={profileMutation.isPending}
              style={{ justifySelf: 'start' }}
            >
              {profileMutation.isPending ? t('profile.saving') : t('profile.save')}
            </Button>
          </Card>

          <Card style={{ display: 'grid', gap: spacing.md }}>
            <div style={{ fontWeight: 800, fontSize: typeScale.body }}>
              {user.has_password ? t('profile.changePassword') : t('profile.setPassword')}
            </div>
            {!user.has_password ? (
              <div style={{ fontSize: typeScale.caption, color: uiVars.textMuted }}>
                {t('profile.setPasswordDesc')}
              </div>
            ) : null}
            {user.has_password ? (
              <Field label={t('profile.currentPassword')}>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
            ) : null}
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
            <Button
              onClick={() => passwordMutation.mutate()}
              disabled={passwordMutation.isPending || !canSubmitPassword}
              style={{ justifySelf: 'start' }}
            >
              {passwordMutation.isPending
                ? t('profile.saving')
                : user.has_password
                  ? t('profile.changePassword')
                  : t('profile.setPassword')}
            </Button>
          </Card>
        </div>
      ) : null}
    </PageShell>
  )
}
