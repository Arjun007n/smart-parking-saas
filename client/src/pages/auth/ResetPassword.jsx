import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { authApi } from '../../services/api'
import { resetPasswordSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field } from '../../components/ui'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetPasswordSchema) })

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert>This reset link is not valid.</Alert>
        <Link to="/forgot-password" className="text-sm text-blue-700 hover:underline">
          Request a new link
        </Link>
      </div>
    )
  }

  const onSubmit = async ({ password }) => {
    setError('')
    try {
      const result = await authApi.resetPassword({ token, password })
      navigate('/login', { replace: true, state: { notice: result.message } })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h1 className="text-xl font-bold text-slate-900">Choose a new password</h1>
      <Alert>{error}</Alert>
      <Field
        label="New password"
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
        Update password
      </Button>
    </form>
  )
}
