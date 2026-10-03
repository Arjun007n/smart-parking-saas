import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { leadApi } from '../../services/api'
import { leadSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field, Textarea } from '../ui'

// Enquiry form used on the Contact, Product and Partner pages.
//   type: CONTACT | DEMO | PARTNER | PRODUCT     subject: what it is about
export default function LeadForm({ type = 'CONTACT', subject, submitLabel = 'Send message', messageLabel = 'How can we help?' }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(leadSchema),
    defaultValues: { name: '', email: '', phone: '', company: '', message: '', website: '' },
  })

  const send = useMutation({
    mutationFn: ({ phone, company, message, website, ...values }) =>
      leadApi.create({
        ...values,
        type,
        ...(subject ? { subject } : {}),
        ...(phone ? { phone } : {}),
        ...(company ? { company } : {}),
        ...(message ? { message } : {}),
        ...(website ? { website } : {}),
      }),
    onSuccess: () => reset(),
  })

  if (send.isSuccess) {
    return (
      <div className="space-y-4" role="status">
        <Alert type="success">{send.data.message}</Alert>
        <Button variant="secondary" onClick={() => send.reset()}>Send another message</Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit((values) => send.mutate(values))} className="space-y-4" noValidate>
      <Alert>{send.error && errorMessage(send.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Phone (optional)" type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
        <Field label="Company (optional)" autoComplete="organization" error={errors.company?.message} {...register('company')} />
      </div>
      <Textarea label={messageLabel} rows={5} error={errors.message?.message} {...register('message')} />

      {/* Spam trap: hidden from people and from screen readers. Leave it empty. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" type="text" tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>

      <Button type="submit" loading={send.isPending}>{submitLabel}</Button>
    </form>
  )
}
