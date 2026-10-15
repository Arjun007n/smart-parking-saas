import { useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { authApi, tokenStore } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { changePasswordSchema, profileSchema } from '../validators/schemas'
import { errorMessage } from '../utils/errors'
import { roleLabel } from '../utils/roles'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { PageBar } from '../components/operator/GateBar'

// The signed-in user's own account: who they are, and changing their password.
export default function Account() {
  const { user, company, can, setUser } = useAuth()
  // On a phone the operator area shows this page with its own top bar (the admin area keeps its usual header).
  const inOperatorArea = useLocation().pathname.startsWith('/operator')
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }) => authApi.changePassword({ currentPassword, newPassword }),
    onSuccess: (data) => {
      // The old token stops working; keep this device signed in with the new one.
      tokenStore.set(data.token)
      reset()
    },
  })

  const {
    register: registerProfile,
    handleSubmit: handleProfile,
    formState: { errors: profileErrors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user.name || '', phone: user.phone || '' },
  })
  const saveProfile = useMutation({
    mutationFn: (values) => authApi.updateProfile(values),
    onSuccess: (data) => setUser({ name: data.user.name, phone: data.user.phone || '' }),
  })

  const savePreferences = useMutation({
    mutationFn: (changes) => authApi.updatePreferences(changes),
    onSuccess: (data) => setUser({ emailAlerts: data.user.emailAlerts, phoneAlerts: data.user.phoneAlerts }),
  })

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className={`text-2xl font-bold text-slate-900 ${inOperatorArea ? 'max-md:sr-only' : ''}`}>My profile</h1>
      {inOperatorArea && <PageBar title="My profile" />}
      {inOperatorArea && <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#1d4ed8] to-[#3b82f6] p-4 text-white shadow md:hidden">
        <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl font-extrabold">{(user.name || '?').slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-lg font-extrabold">{user.name}</p>
          <p className="truncate text-sm opacity-90">{roleLabel(user)}{company?.name ? ` · ${company.name}` : ''}</p>
        </div>
      </div>}

      <Card title="Details">
        <dl className="space-y-2 text-sm">
          {[
            ['Name', user.name],
            user.email && ['Email', user.email],
            user.loginId && ['Login ID', user.loginId],
            company?.code && ['Company code', company.code],
            ['Role', roleLabel(user)],
            company && ['Company', company.name],
          ]
            .filter(Boolean)
            .map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-slate-500">{label}</dt>
                <dd className="text-right font-medium text-slate-900">{value}</dd>
              </div>
            ))}
        </dl>
      </Card>

      <Card title="Edit profile">
        <form onSubmit={handleProfile((values) => saveProfile.mutate(values))} className="space-y-4" noValidate>
          <Alert>{saveProfile.error && errorMessage(saveProfile.error)}</Alert>
          <Alert type="success">{saveProfile.isSuccess && 'Profile updated.'}</Alert>
          <Field label="Name" autoComplete="name" error={profileErrors.name?.message} {...registerProfile('name')} />
          <Field
            label="Mobile"
            type="tel"
            autoComplete="tel"
            hint="Optional. Your email or Login ID is how you sign in, so it cannot be changed here."
            error={profileErrors.phone?.message}
            {...registerProfile('phone')}
          />
          <Button type="submit" loading={saveProfile.isPending}>Update profile</Button>
        </form>
      </Card>

      {can('LOCATION_MANAGE') && (
        <Card title="Email alerts">
          <div className="space-y-3">
            <Alert>{savePreferences.error && errorMessage(savePreferences.error)}</Alert>
            <Alert type="success">{savePreferences.isSuccess && 'Saved.'}</Alert>
            <Select
              label="Send me alerts by email"
              name="emailAlerts"
              value={user.emailAlerts || 'CRITICAL'}
              disabled={savePreferences.isPending}
              onChange={(event) => savePreferences.mutate({ emailAlerts: event.target.value })}
            >
              <option value="CRITICAL">Urgent alerts only (recommended)</option>
              <option value="IMPORTANT">Warnings and urgent alerts</option>
              <option value="ALL">Every alert</option>
              <option value="OFF">Never, I will check the app</option>
            </Select>
            <p className="text-xs text-slate-500">
              Alerts are always shown in the app. Email is sent only once email sending has been set up for this platform.
            </p>
            <Select
              label="Send me alerts by SMS / WhatsApp"
              name="phoneAlerts"
              value={user.phoneAlerts || 'CRITICAL'}
              disabled={savePreferences.isPending}
              onChange={(event) => savePreferences.mutate({ phoneAlerts: event.target.value })}
            >
              <option value="CRITICAL">Urgent alerts only (recommended)</option>
              <option value="IMPORTANT">Warnings and urgent alerts</option>
              <option value="ALL">Every alert</option>
              <option value="OFF">Never</option>
            </Select>
            <p className="text-xs text-slate-500">
              Sent to the mobile number in your profile, only once text messages have been set up for this platform.
            </p>
          </div>
        </Card>
      )}

      <Card title="Change password">
        <form onSubmit={handleSubmit((values) => change.mutate(values))} className="space-y-4" noValidate>
          <Alert>{change.error && errorMessage(change.error)}</Alert>
          <Alert type="success">{change.isSuccess && 'Password changed. Your other devices have been logged out.'}</Alert>
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters"
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" loading={change.isPending}>Change password</Button>
        </form>
      </Card>
    </div>
  )
}
