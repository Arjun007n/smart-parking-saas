import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { authApi } from '../../services/api'
import { forgotPasswordSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field } from '../../components/ui'

export default function ForgotPassword() {
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = async (values) => {
    setError('')
    try {
      setResult(await authApi.forgotPassword(values))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-900">Check your email</h1>
        <Alert type="success">{result.message}</Alert>
        {/* The API returns this only while running in development. */}
        {result.devResetToken && (
          <Alert type="info">
            Development mode: email is not set up yet.{' '}
            <Link className="font-semibold underline" to={`/reset-password?token=${result.devResetToken}`}>
              Open the reset page
            </Link>
          </Alert>
        )}
        <Link to="/login" className="block text-sm text-blue-700 hover:underline">
          Back to log in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-bold text-slate-900">Forgot password</h1>
        <p className="mt-1 text-sm text-slate-600">Enter your email and we will send a reset link.</p>
      </div>
      <Alert>{error}</Alert>
      <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Send reset link
      </Button>
      <Link to="/login" className="block text-center text-sm text-blue-700 hover:underline">
        Back to log in
      </Link>
    </form>
  )
}
