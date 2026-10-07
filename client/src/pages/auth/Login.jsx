import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { loginSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { homePathFor } from '../../utils/roles'
import { Alert, Button, Field } from '../../components/ui'

// The company code of the last sign-in on this computer, so gate staff do not retype it every shift.
const CODE_KEY = 'sp_company_code'
const readCode = () => {
  try {
    return localStorage.getItem(CODE_KEY) || ''
  } catch {
    return ''
  }
}
const rememberCode = (code) => {
  try {
    if (code) localStorage.setItem(CODE_KEY, code)
  } catch {
    // Not remembering the code is harmless.
  }
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { companyCode: readCode() } })

  const onSubmit = async ({ companyCode, identifier, password }) => {
    setError('')
    try {
      // An email has an @; a Login ID never does.
      const who = identifier.includes('@') ? { email: identifier } : { loginId: identifier }
      const session = await login({ ...(companyCode ? { companyCode } : {}), ...who, password })
      rememberCode(session.company?.code)
      navigate(location.state?.from || homePathFor(session.user, session.permissions), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h1 className="text-xl font-bold text-slate-900">Log in</h1>
      <Alert type="success">{location.state?.notice}</Alert>
      <Alert>{error}</Alert>
      <Field
        label="Company code"
        autoComplete="organization"
        autoCapitalize="characters"
        hint="The code of your parking company, shown on My profile. Your admin can tell you."
        error={errors.companyCode?.message}
        {...register('companyCode')}
      />
      <Field
        label="Login ID or email"
        autoComplete="username"
        autoCapitalize="none"
        error={errors.identifier?.message}
        {...register('identifier')}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Log in
      </Button>
      <div className="flex justify-between text-sm">
        <Link to="/forgot-password" className="text-blue-700 hover:underline">
          Forgot password?
        </Link>
        <Link to="/register" className="text-blue-700 hover:underline">
          Create an account
        </Link>
      </div>
      <p className="text-center text-sm">
        <Link to="/government/login" className="text-blue-700 hover:underline">
          Government officer login
        </Link>
      </p>
      <p className="text-xs text-slate-500">
        Signed in with a Login ID and forgot the password? Ask your company admin to set a new one.
      </p>
    </form>
  )
}
