import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { passApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Field, Select } from '../ui'

const ACTIONS = [
  ['EXTEND', 'Add days to the last day'],
  ['SET_DATES', 'Set first and last day'],
  ['SUSPEND', 'Suspend'],
  ['RESUME', 'Resume'],
  ['CANCEL', 'Cancel'],
]

// Changes the chosen passes at once. No money is taken here: renew a pass to take a payment.
export default function PassBulkBar({ ids, onDone }) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState('EXTEND')
  const [days, setDays] = useState('30')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')

  const run = useMutation({
    mutationFn: () =>
      passApi.bulk({
        ids,
        action,
        ...(action === 'EXTEND' ? { days: Number(days) } : {}),
        ...(action === 'SET_DATES' ? { startDate, endDate } : {}),
        ...(action === 'SUSPEND' || action === 'CANCEL' ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passes'] })
      queryClient.invalidateQueries({ queryKey: ['pass-summary'] })
      queryClient.invalidateQueries({ queryKey: ['pass-vehicles'] })
    },
  })

  const needsReason = action === 'SUSPEND' || action === 'CANCEL'
  const ready =
    (action !== 'EXTEND' || (Number(days) >= 1 && Number(days) <= 366)) &&
    (action !== 'SET_DATES' || (startDate && endDate && endDate >= startDate)) &&
    (!needsReason || reason.trim().length >= 5)

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm font-semibold text-blue-900">{ids.length} pass{ids.length === 1 ? '' : 'es'} chosen</p>
      <Alert>{run.error && errorMessage(run.error)}</Alert>
      {run.isSuccess && (
        <Alert type="success">
          {run.data.changed} changed{run.data.skipped.length ? `, ${run.data.skipped.length} skipped (${[...new Set(run.data.skipped.map((s) => s.reason))].join(', ')})` : ''}.
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Select className="w-60" label="Change" name="bulk-action" value={action} onChange={(e) => { setAction(e.target.value); run.reset() }}>
          {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {action === 'EXTEND' && <Field className="w-28" label="Days" name="bulk-days" type="number" min="1" max="366" value={days} onChange={(e) => setDays(e.target.value)} />}
        {action === 'SET_DATES' && (
          <>
            <Field label="First day" name="bulk-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Field label="Last day" name="bulk-end" type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </>
        )}
        {needsReason && <Field className="min-w-56" label="Reason" name="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
        <Button loading={run.isPending} disabled={!ready} onClick={() => run.mutate()}>Apply</Button>
        <Button variant="secondary" onClick={onDone}>Clear choice</Button>
      </div>
    </div>
  )
}
