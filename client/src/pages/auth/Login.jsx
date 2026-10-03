import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../../hooks/useAuth'
import { loginSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { homePathFor } from '../../utils/roles'
import { Alert, Button, Field } from '../../components/ui'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (values) => {
    setError('')
    try {
      const session = await login(values)
      navigate(location.state?.from || homePathFor(session.user.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h1 className="text-xl font-bold text-slate-900">Log in</h1>
      <Alert type="success">{location.state?.notice}</Alert>
      <Alert>{error}</Alert>
      <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
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
    </form>
  )
}
