import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { authApi } from '../../services/api'
import { PRICING } from '../../data/site'
import { planLabel, planPrice } from '../../utils/planPrice'
import { money } from '../../utils/format'
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

// Step 1: choose how to start. Like a plan page on a shop, the plan comes first and the account after it.
// "trial" = 14 free days, "buy" = a paid plan (the account is made, then payment is the next screen).
function PlanStep({ plan, onChange, onContinue }) {
  const price = planPrice({ users: plan.users, months: plan.months })
  const card = (value, title, text) => (
    <label
      className={`block cursor-pointer rounded-xl border p-4 transition ${
        plan.mode === value ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-300 bg-white hover:border-slate-400'
      }`}
    >
      <span className="flex items-start gap-3">
        <input type="radio" name="plan-mode" className="mt-1" checked={plan.mode === value} onChange={() => onChange({ ...plan, mode: value })} />
        <span>
          <span className="block font-semibold text-slate-900">{title}</span>
          <span className="block text-sm text-slate-600">{text}</span>
        </span>
      </span>
    </label>
  )
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Choose your plan</h1>
        <p className="mt-1 text-sm text-slate-600">Parking Management, {money(PRICING.parkingPerUserMonth)} per user per month before discount.</p>
      </div>
      {card('trial', 'Start with the free trial', 'Try everything for 14 days. No payment now; buy a plan whenever you are ready.')}
      {card('buy', 'Buy a plan now', 'Choose users and length. You will pay on the next screen after your account is made.')}

      {plan.mode === 'buy' && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Number of users"
              type="number"
              min="1"
              max="500"
              inputMode="numeric"
              value={plan.users}
              onChange={(e) => onChange({ ...plan, users: Math.min(500, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })}
            />
            <label className="block text-sm font-medium text-slate-700">
              Plan length
              <select
                value={plan.months}
                onChange={(e) => onChange({ ...plan, months: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              >
                {PRICING.tenures.map((t) => (
                  <option key={t.months} value={t.months}>{planLabel(t.months)}{t.discount ? ` (${t.discount}% off)` : ''}</option>
                ))}
              </select>
            </label>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">{plan.users} user{plan.users === 1 ? '' : 's'} × {planLabel(plan.months)}</dt><dd>{money(price.subtotal)}</dd></div>
            {price.discount > 0 && (
              <div className="flex justify-between"><dt className="text-slate-600">Discount ({price.discountPercent}%)</dt><dd className="text-green-700">− {money(price.discount)}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-slate-600">GST ({PRICING.gstPercent}%)</dt><dd>{money(price.gst)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900"><dt>Total to pay</dt><dd>{money(price.total)}</dd></div>
          </dl>
        </div>
      )}
      <Button type="button" className="w-full" onClick={onContinue}>Continue</Button>
      <p className="text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link to="/login" className="text-blue-700 hover:underline">Log in</Link>
      </p>
    </div>
  )
}

// The company code field: the admin picks the code everyone in the company will sign in with.
// It is checked against the server as they type, and suggested from the company name when left empty.
function CompanyCodeField({ register, errors, control, setValue }) {
  const code = (useWatch({ control, name: 'companyCode' }) || '').trim().toUpperCase()
  const name = useWatch({ control, name: 'companyName' }) || ''
  const [settled, setSettled] = useState('')
  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(code), 400)
    return () => clearTimeout(timer)
  }, [code])
  const well = /^[A-Z0-9]{4,12}$/.test(settled)
  const check = useQuery({
    queryKey: ['company-code', settled],
    queryFn: () => authApi.checkCompanyCode(settled),
    enabled: well,
    staleTime: 30_000,
    retry: false,
  })

  const suggest = () => {
    const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (base.length >= 4) setValue('companyCode', base, { shouldValidate: true })
  }

  let status = null
  if (code && well && settled === code) {
    if (check.isLoading) status = <p className="mt-1 text-xs text-slate-500">Checking…</p>
    else if (check.data?.available) status = <p className="mt-1 text-xs font-semibold text-green-700">✓ {code} is available</p>
    else if (check.data) status = <p className="mt-1 text-sm text-red-600">{check.data.reason || 'This company code is already taken'}</p>
  }
  return (
    <div>
      <Field
        label="Company code"
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="For example ACMEPARK"
        hint="You choose it once. You, your admins and your staff type it on the login page, so keep it short and easy to say. It cannot be changed later."
        error={errors.companyCode?.message}
        {...register('companyCode', { setValueAs: (v) => (v || '').toUpperCase() })}
      />
      {status}
      {!code && name.trim().length >= 4 && (
        <button type="button" onClick={suggest} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">
          Suggest one from my company name
        </button>
      )}
    </div>
  )
}

export default function Register() {
  const { register: registerAccount } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const [verified, setVerified] = useState(null)
  // The plan can come from the price calculator on the home page (?plan=buy&users=5&months=12).
  const [plan, setPlan] = useState(() => {
    const months = Number(params.get('months'))
    return {
      mode: params.get('plan') === 'buy' ? 'buy' : 'trial',
      users: Math.min(500, Math.max(1, Number.parseInt(params.get('users'), 10) || 1)),
      months: PRICING.tenures.some((t) => t.months === months) ? months : 12,
    }
  })
  const [step, setStep] = useState(params.get('plan') === 'buy' ? 2 : 1)
  const options = useQuery({ queryKey: ['signup-options'], queryFn: authApi.signupOptions, staleTime: 60_000, retry: false })
  const otpRequired = Boolean(options.data?.otpRequired)
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(registerSchema), defaultValues: { companyCode: '', phone: '', gstNumber: '', city: '', state: '' } })
  const phone = useWatch({ control, name: 'phone' }) || ''

  const onSubmit = async ({ companyName, companyCode, name, email, phone: number, password, gstNumber, city, state }) => {
    setError('')
    if (otpRequired && !(verified && verified.phone === number)) {
      setError('Please verify your mobile number first.')
      return
    }
    try {
      const session = await registerAccount({
        companyName, companyCode, name, email, password,
        ...(number ? { phone: number } : {}),
        ...(gstNumber ? { gstNumber } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(otpRequired ? { phoneToken: verified.token } : {}),
      })
      try {
        // The new company's code is what the login page asks for next time.
        if (session?.company?.code) localStorage.setItem('sp_company_code', session.company.code)
      } catch {
        // Not remembering the code is harmless.
      }
      // A plan chosen up front goes straight to payment, with the choice filled in.
      navigate(plan.mode === 'buy' ? `/dashboard/billing?users=${plan.users}&months=${plan.months}` : '/dashboard', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (step === 1) return <PlanStep plan={plan} onChange={setPlan} onContinue={() => setStep(2)} />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold text-slate-900">Register your company</h1>
        <p className="mt-1 text-sm text-slate-600">You will be the company admin.</p>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <span>
          {plan.mode === 'buy'
            ? `Plan: ${plan.users} user${plan.users === 1 ? '' : 's'} × ${planLabel(plan.months)}, ${money(planPrice(plan).total)} with GST`
            : 'Plan: 14 day free trial'}
        </span>
        <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => setStep(1)}>Change</button>
      </div>
      <Alert>{error}</Alert>
      <Field label="Company name" autoComplete="organization" error={errors.companyName?.message} {...register('companyName')} />
      <CompanyCodeField register={register} errors={errors} control={control} setValue={setValue} />
      <Field label="Your name" autoComplete="name" error={errors.name?.message} {...register('name')} />
      <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
      <MobileCheck
        phone={phone} error={errors.phone?.message} register={register}
        otpRequired={otpRequired} verified={verified} setVerified={setVerified}
      />
      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-700">Billing details (optional)</legend>
        <Field label="GSTIN" placeholder="15 characters, for a GST invoice" error={errors.gstNumber?.message} {...register('gstNumber')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="City" autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
          <Field label="State" autoComplete="address-level1" error={errors.state?.message} {...register('state')} />
        </div>
      </fieldset>
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
        {plan.mode === 'buy' ? 'Create account and continue to payment' : 'Create account'}
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
