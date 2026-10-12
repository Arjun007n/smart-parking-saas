import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passChargeApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, money } from '../../utils/format'
import { Alert, Button, PageLoader } from '../../components/ui'
import { IconButton, PageTitle } from '../../components/pass/ListKit'

const BLANK = { locationId: '', vehicleType: '', monthlyRate: '', dailyRate: '' }

// Pass Management > Pass Charges: the price of a pass for each location and vehicle type. When the dates of a new pass
// are chosen, the Create Pass form works the total out from these two prices.
export default function PassCharges() {
  const queryClient = useQueryClient()
  const { locations, defaultId } = useMyLocations()
  const [form, setForm] = useState({ ...BLANK, locationId: defaultId })
  const [problem, setProblem] = useState('')
  const list = useQuery({ queryKey: ['pass-charges'], queryFn: passChargeApi.list })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['pass-charges'] })
  const save = useMutation({
    mutationFn: () => passChargeApi.save({
      locationId: form.locationId, vehicleType: form.vehicleType, monthlyRate: Number(form.monthlyRate), dailyRate: Number(form.dailyRate),
    }),
    onSuccess: () => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['pass-charge-quote'] })
      setForm((f) => ({ ...BLANK, locationId: f.locationId }))
    },
  })
  const remove = useMutation({
    mutationFn: (charge) => passChargeApi.remove(charge._id),
    onSuccess: () => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['pass-charge-quote'] })
    },
  })
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  const submit = (event) => {
    event.preventDefault()
    setProblem('')
    if (!form.locationId || !form.vehicleType) return setProblem('Choose the location and the vehicle type.')
    if (form.monthlyRate === '' || form.dailyRate === '' || Number(form.monthlyRate) < 0 || Number(form.dailyRate) < 0) {
      return setProblem('Enter both prices (0 or more).')
    }
    return save.mutate()
  }

  const charges = list.data ? list.data.charges : []
  return (
    <div className="space-y-5">
      <PageTitle title="Pass Charges" />
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm text-slate-600">
          Set the price of a pass for each location and vehicle type. When you choose the validity dates of a new pass, the charges are worked
          out by themselves: every full month at the <strong>monthly price</strong>, and each day left over at the <strong>daily price</strong>.
          For example, 1-10-2026 to 31-10-2026 is one month; 1-10-2026 to 10-12-2026 is 2 months and 10 days.
        </p>
        <form onSubmit={submit} noValidate className="space-y-3">
          <Alert>{problem || (save.error && errorMessage(save.error))}</Alert>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm font-medium text-slate-700">
              Location *
              <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2" value={form.locationId} onChange={set('locationId')}>
                <option value="">-Select One-</option>
                {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Vehicle Type *
              <select className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2" value={form.vehicleType} onChange={set('vehicleType')}>
                <option value="">--Select One--</option>
                {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Monthly Charges (₹) *
              <input type="number" min="0" inputMode="decimal" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" value={form.monthlyRate} onChange={set('monthlyRate')} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Daily Charges (₹) *
              <input type="number" min="0" inputMode="decimal" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2" value={form.dailyRate} onChange={set('dailyRate')} />
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit" loading={save.isPending}>Save Charges</Button>
              {(form.vehicleType || form.monthlyRate || form.dailyRate) && (
                <Button type="button" variant="danger" onClick={() => setForm({ ...BLANK, locationId: form.locationId })}>Clear</Button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">Saving a location and vehicle type that is already in the table changes its prices.</p>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <Alert>{list.error ? errorMessage(list.error) : remove.error ? errorMessage(remove.error) : ''}</Alert>
        {list.isLoading ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border border-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {['SN', 'Location', 'Vehicle Type', 'Monthly Charges', 'Daily Charges', 'Action'].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 && (
                  <tr><td colSpan={6} className="p-4 text-center text-slate-500">No charges yet. Add the first one above, then create a pass: its charges fill in by themselves.</td></tr>
                )}
                {charges.map((c, i) => (
                  <tr key={c._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 font-medium text-slate-900">{c.locationName}</td>
                    <td className="p-2">{VEHICLE_LABELS[c.vehicleType] || c.vehicleType}</td>
                    <td className="whitespace-nowrap p-2">{money(c.monthlyRate)}</td>
                    <td className="whitespace-nowrap p-2">{money(c.dailyRate)}</td>
                    <td className="p-2">
                      <span className="flex gap-1">
                        <IconButton
                          title={`Edit ${c.locationName} ${c.vehicleType}`}
                          onClick={() => setForm({ locationId: c.locationId, vehicleType: c.vehicleType, monthlyRate: String(c.monthlyRate), dailyRate: String(c.dailyRate) })}
                        >
                          Edit
                        </IconButton>
                        <IconButton
                          title={`Delete ${c.locationName} ${c.vehicleType}`}
                          tone="danger"
                          disabled={remove.isPending}
                          onClick={() => window.confirm(`Delete the charges of ${VEHICLE_LABELS[c.vehicleType] || c.vehicleType} at ${c.locationName}?`) && remove.mutate(c)}
                        >
                          Delete
                        </IconButton>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
