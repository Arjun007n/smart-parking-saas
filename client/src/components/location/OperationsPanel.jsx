import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { OPERATION_SWITCHES, operationSettings } from '../../utils/operations'
import { Alert, Button, Field, Textarea } from '../ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The "Gate rules" tab of a location: the switches that change how the gate works, and who
// gets this location's own end-of-day report by email.
export default function OperationsPanel({ location }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => operationSettings(location.operations))
  const [recipients, setRecipients] = useState((location.reportRecipients || []).join('\n'))
  const [problem, setProblem] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = useMutation({
    mutationFn: (body) => locationApi.update(location._id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })

  const submit = (event) => {
    event.preventDefault()
    const list = recipients.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)
    const bad = list.find((e) => !EMAIL.test(e))
    if (bad) {
      setProblem(`"${bad}" is not an email address.`)
      return
    }
    if (list.length > 10) {
      setProblem('At most 10 email addresses.')
      return
    }
    setProblem('')
    save.mutate({ operations: form, reportRecipients: [...new Set(list)] })
  }

  return (
    <form className="max-w-3xl space-y-6" onSubmit={submit}>
      <p className="text-sm text-slate-600">
        These switches change how the gate of <strong>{location.name}</strong> works. They apply at once, on every screen and printer of this location.
      </p>
      <Alert>{problem || (save.error && errorMessage(save.error))}</Alert>
      <Alert type="success">{save.isSuccess && 'Gate rules saved.'}</Alert>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-slate-800">Switches</legend>
        {OPERATION_SWITCHES.map(({ key, label, hint }) => (
          <label key={key} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={form[key]} onChange={(event) => set({ [key]: event.target.checked })} />
            <span>
              <span className="block text-sm font-medium text-slate-900">{label}</span>
              <span className="block text-sm text-slate-600">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="rounded-lg border border-slate-200 p-3">
        <Field
          label="Close forgotten tickets after (hours)"
          name="ops-auto-exit"
          type="number"
          min="0"
          max="720"
          value={form.autoExitHours}
          onChange={(event) => set({ autoExitHours: Math.max(0, Math.min(720, Number(event.target.value) || 0)) })}
          hint="0 = never. A ticket still open after this long is closed with no payment and the company is told. Tickets waiting for payment are never touched."
        />
      </div>

      <div className="space-y-2">
        <Textarea
          label="Send this location's end-of-day report to"
          name="ops-recipients"
          rows={3}
          placeholder="one email address per line"
          value={recipients}
          onChange={(event) => setRecipients(event.target.value)}
        />
        <p className="text-xs text-slate-500">
          They get the same report as the company, reduced to this location. It is sent when the company&apos;s daily report email is switched on (Company &gt; Daily report email).
        </p>
      </div>

      <Button type="submit" loading={save.isPending}>Save gate rules</Button>
    </form>
  )
}
