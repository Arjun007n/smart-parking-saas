import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { authApi } from '../../services/api'
import { registerSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field } from '../../components/ui'

// Asks for the mobile number and, when the server needs it, a code texted to that number.
// `verified` holds { phone, token } once the number is proven; changing the number clears it.
function MobileCheck({ phone, error, register, otpRequired, verified, setVerified }) {
  const [sent, setSent] = useState(null) // { devCode? } after a code was sent
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(0)

  // Counts the seconds before another code may be asked for.
  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearInterval(timer)
  }, [wait > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () => authApi.sendOtp(phone),
    onSuccess: (result) => {
      setSent({ devCode: result.devCode })
      setCode('')
      setWait(result.resendInSeconds || 30)
    },
  })
  const verify = useMutation({
    mutationFn: () => authApi.verifyOtp(phone, code.trim()),
    onSuccess: (result) => setVerified({ phone, token: result.phoneToken }),
  })

  const isVerified = Boolean(verified && verified.phone === phone)
  return (
    <div className="space-y-2">
      <Field
        label={otpRequired ? 'Mobile number' : 'Phone (optional)'}
        type="tel"
        autoComplete="tel"
        error={error}
        hint={otpRequired ? 'We text a 6 digit code to this number to check it is yours.' : undefined}
        {...register('phone', { onChange: () => { setVerified(null); setSent(null) } })}
      />
      {otpRequired && !isVerified && (
        <>
          <Button type="button" variant="secondary" onClick={() => send.mutate()} loading={send.isPending} disabled={wait > 0 || phone.trim().length < 6}>
            {sent ? (wait > 0 ? `Send again in ${wait}s` : 'Send the code again') : 'Send code'}
          </Button>
          <Alert>{send.error && errorMessage(send.error)}</Alert>
          {sent && (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-sm text-slate-700">We sent a code to {phone}. It works for 10 minutes.</p>
              {sent.devCode && <p className="text-xs font-semibold text-amber-700">Practice mode: the code is {sent.devCode}</p>}
              <div className="flex items-end gap-2">
                <Field
                  label="Code" className="flex-1" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <Button type="button" onClick={() => verify.mutate()} loading={verify.isPending} disabled={code.length < 4}>Verify</Button>
              </div>
              <Alert>{verify.error && errorMessage(verify.error)}</Alert>
            </div>
          )}
        </>
      )}
      {otpRequired && isVerified && <p className="text-sm font-semibold text-green-700">✓ Mobile number verified</p>}
    </div>
  )
}

export default function Register() {
  const { register: registerAccount } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(null)
  const options = useQuery({ queryKey: ['signup-options'], queryFn: authApi.signupOptions, staleTime: 60_000, retry: false })
  const otpRequired = Boolean(options.data?.otpRequired)
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(registerSchema), defaultValues: { phone: '' } })
  const phone = useWatch({ control, name: 'phone' }) || ''

  const onSubmit = async ({ companyName, name, email, phone: number, password }) => {
    setError('')
    if (otpRequired && !(verified && verified.phone === number)) {
      setError('Please verify your mobile number first.')
      return
    }
    try {
      await registerAccount({
        companyName, name, email, password,
        ...(number ? { phone: number } : {}),
        ...(otpRequired ? { phoneToken: verified.token } : {}),
      })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold text-slate-900">Register your company</h1>
        <p className="mt-1 text-sm text-slate-600">You will be the company admin. The trial is free.</p>
      </div>
      <Alert>{error}</Alert>
      <Field label="Company name" autoComplete="organization" error={errors.companyName?.message} {...register('companyName')} />
      <Field label="Your name" autoComplete="name" error={errors.name?.message} {...register('name')} />
      <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
      <MobileCheck
        phone={phone} error={errors.phone?.message} register={register}
        otpRequired={otpRequired} verified={verified} setVerified={setVerified}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 8 characters"
        error={errors.password?.message}
        {...register('password')}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link to="/login" className="text-blue-700 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  )
}
