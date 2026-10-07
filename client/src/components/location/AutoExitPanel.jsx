import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS } from '../../utils/format'
import { Alert, Badge, Button } from '../ui'

const TYPES = Object.keys(VEHICLE_LABELS)

// One row for each vehicle type, filled from what is saved.
const toRows = (location) => {
  const saved = Object.fromEntries(((location.operations && location.operations.autoExitRules) || []).map((r) => [r.vehicleType, r]))
  return TYPES.map((vehicleType) => {
    const rule = saved[vehicleType]
    return { vehicleType, saved: Boolean(rule), active: Boolean(rule && rule.active), days: rule ? rule.days : 15, amount: rule ? rule.amount : 0 }
  })
}

// The "Auto exit" tab of a location: for each vehicle type, how many days a ticket may stay open
// before the system closes it, and what the vehicle still owes when that happens.
export default function AutoExitPanel({ location }) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState(() => toRows(location))
  const [problem, setProblem] = useState('')
  const [ran, setRan] = useState('')
  const set = (type, patch) => setRows((list) => list.map((r) => (r.vehicleType === type ? { ...r, ...patch } : r)))

  const save = useMutation({
    mutationFn: (body) => locationApi.update(location._id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })
  const run = useMutation({
    mutationFn: (type) => locationApi.runAutoExit(location._id, type),
    onSuccess: ({ closed }, type) => {
      setRan(`${closed} ${VEHICLE_LABELS[type]} ticket${closed === 1 ? '' : 's'} closed.`)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })

  const submit = (event) => {
    event.preventDefault()
    setRan('')
    const bad = rows.find((r) => (r.active || r.saved) && (!Number.isInteger(r.days) || r.days < 1 || r.days > 365 || !(r.amount >= 0)))
    if (bad) {
      setProblem(`${VEHICLE_LABELS[bad.vehicleType]}: days must be a whole number from 1 to 365, and the amount cannot be negative.`)
      return
    }
    setProblem('')
    const autoExitRules = rows
      .filter((r) => r.active || r.saved)
      .map((r) => ({ vehicleType: r.vehicleType, active: r.active, days: r.days, amount: r.amount }))
    save.mutate({ operations: { autoExitRules } })
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <p className="max-w-3xl text-sm text-slate-600">
        A vehicle left behind for a long time can be closed by the system. Switch a vehicle type on, say after how many
        days, and what the vehicle still owes. The amount is written on the ticket and in the alert to your company; no
        payment is recorded, so follow it up yourself. A vehicle type that is off follows the &ldquo;Close forgotten tickets&rdquo;
        hours on the Gate rules tab, if you set them. Tickets waiting for payment are never touched.
      </p>
      <Alert>{problem || (save.error && errorMessage(save.error)) || (run.error && errorMessage(run.error))}</Alert>
      <Alert type="success">{(save.isSuccess && !ran && 'Auto exit saved.') || ran}</Alert>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-slate-300 text-slate-600">
            <tr>
              <th className="py-2 pr-3">Vehicle</th>
              <th className="py-2 pr-3">Amount owed (₹)</th>
              <th className="py-2 pr-3">Keep vehicle (days)</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vehicleType} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-medium text-slate-900">{VEHICLE_LABELS[r.vehicleType]}</td>
                <td className="py-2 pr-3">
                  <input aria-label={`${VEHICLE_LABELS[r.vehicleType]} amount owed`} type="number" min="0" className="w-28 rounded-lg border border-slate-300 px-2 py-1"
                    value={r.amount} onChange={(e) => set(r.vehicleType, { amount: Number(e.target.value) })} />
                </td>
                <td className="py-2 pr-3">
                  <input aria-label={`${VEHICLE_LABELS[r.vehicleType]} days`} type="number" min="1" max="365" className="w-24 rounded-lg border border-slate-300 px-2 py-1"
                    value={r.days} onChange={(e) => set(r.vehicleType, { days: Number(e.target.value) })} />
                </td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => set(r.vehicleType, { active: !r.active })} aria-pressed={r.active}>
                    <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Off'}</Badge>
                  </button>
                </td>
                <td className="py-2">
                  {r.saved && r.active ? (
                    <Button
                      type="button" variant="secondary" loading={run.isPending && run.variables === r.vehicleType}
                      onClick={() => {
                        if (window.confirm(`Close every ${VEHICLE_LABELS[r.vehicleType]} ticket that has been open for ${r.days} days or more, without taking a payment?`)) {
                          setRan('')
                          run.mutate(r.vehicleType)
                        }
                      }}
                    >
                      Run now
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-500">Save as active to run</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="submit" loading={save.isPending}>Save auto exit</Button>
    </form>
  )
}
