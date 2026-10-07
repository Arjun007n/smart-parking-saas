import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { loginSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field } from '../../components/ui'

// The sign-in page for government officers. It asks for the same things as the normal login but tells the
// server this is the Government login ("portal"), so only officer accounts get in, and only the other
// way round: officers cannot use the normal login page.
export default function GovernmentLogin() {
  usePageTitle('Government login')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) })

  const onSubmit = async ({ companyCode, identifier, password }) => {
    setError('')
    try {
      const who = identifier.includes('@') ? { email: identifier } : { loginId: identifier }
      await login({ ...(companyCode ? { companyCode } : {}), ...who, password, portal: 'government' })
      navigate('/government', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold text-slate-900">Government login</h1>
        <p className="mt-1 text-sm text-slate-600">For government officers. You can see the reports of vehicles that entered and left.</p>
      </div>
      <Alert>{error}</Alert>
      <Field
        label="Company code"
        autoCapitalize="characters"
        hint="The code of the parking company. The company admin who made your account can tell you."
        error={errors.companyCode?.message}
        {...register('companyCode')}
      />
      <Field label="Login ID or email" autoComplete="username" autoCapitalize="none" error={errors.identifier?.message} {...register('identifier')} />
      <Field label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Log in
      </Button>
      <p className="text-xs text-slate-500">Forgot the password? Ask the company admin to set a new one.</p>
      <p className="text-center text-sm">
        <Link to="/login" className="text-blue-700 hover:underline">
          Staff and admin login
        </Link>
      </p>
    </form>
  )
}
