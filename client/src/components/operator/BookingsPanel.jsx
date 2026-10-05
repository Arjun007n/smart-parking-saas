import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bookingApi } from '../../services/api'
import { useBookings } from '../../hooks/useBookings'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime, localInput, money } from '../../utils/format'
import { Alert, Button, Card, Field, Select } from '../ui'

// What a booking's money looks like to staff: "Online · ₹60 paid", "Online · ₹60 awaiting payment", ...
const PAY_TEXT = { PENDING: 'awaiting payment', PAID: 'paid', FAILED: 'payment failed', REFUND_DUE: 'refund due' }
const payLine = (b) => (b.source === 'ONLINE' ? `Online · ${b.amount > 0 ? `${money(b.amount)} ${PAY_TEXT[b.payment?.state] || ''}`.trim() : 'free'}` : null)

// Customers who told the parking they are coming. Staff can add one, pick one to
// fill in the entry form, or cancel one. A booking does not hold a space.
export default function BookingsPanel({ location, vehicleTypes, onUse, onClose }) {
  const queryClient = useQueryClient()
  const { bookings, isLoading, error } = useBookings(location?._id)
  const [form, setForm] = useState({ vehicleNumber: '', vehicleType: vehicleTypes[0] || 'CAR', customerName: '', phone: '', expectedAt: localInput(new Date()), note: '' })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bookings'] })

  const create = useMutation({
    mutationFn: () =>
      bookingApi.create({
        locationId: location._id,
        vehicleNumber: form.vehicleNumber,
        vehicleType: form.vehicleType,
        ...(form.customerName.trim() ? { customerName: form.customerName.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        expectedAt: new Date(form.expectedAt).toISOString(),
      }),
    onSuccess: () => {
      setForm((f) => ({ ...f, vehicleNumber: '', customerName: '', phone: '', note: '', expectedAt: localInput(new Date()) }))
      refresh()
    },
  })
  const cancel = useMutation({ mutationFn: (id) => bookingApi.cancel(id), onSuccess: refresh })

  return (
    <Card
      title={`Customer bookings${location ? ` · ${location.name}` : ''}`}
      className="no-print"
      action={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {!location ? (
        <p className="text-sm text-slate-500">Choose a location first.</p>
      ) : (
        <div className="space-y-5">
          {error && <Alert>{errorMessage(error)}</Alert>}
          {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-slate-500">No active customer bookings.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {bookings.map((b) => (
                <li key={b._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="text-sm">
                    <p>
                      <span className="font-mono text-base font-bold tracking-wider text-slate-900">{b.vehicleNumber}</span>{' '}
                      <span className="text-slate-500">{VEHICLE_LABELS[b.vehicleType]}</span>
                    </p>
                    <p className="text-slate-600">
                      {[b.customerName, b.phone].filter(Boolean).join(' · ') || 'No name given'} · expected {dateTime(b.expectedAt)}
                    </p>
                    {payLine(b) && (
                      <p className={`text-xs ${b.payment?.state === 'PAID' ? 'font-semibold text-green-700' : 'text-slate-500'}`}>{payLine(b)}</p>
                    )}
                    {b.note && <p className="text-xs text-slate-500">{b.note}</p>}
                  </div>
                  <div className="flex gap-2">
                    {onUse && b.status === 'BOOKED' && <Button onClick={() => onUse(b)}>Use for entry</Button>}
                    <Button variant="secondary" loading={cancel.isPending && cancel.variables === b._id} onClick={() => cancel.mutate(b._id)}>
                      {b.payment?.state === 'PAID' ? 'Cancel and flag refund' : 'Cancel'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            className="space-y-4 border-t border-slate-200 pt-4"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            <h3 className="text-sm font-semibold text-slate-800">Add a booking</h3>
            <Alert>{create.error && errorMessage(create.error)}</Alert>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vehicle number" name="booking-plate" required autoComplete="off" className="[&_input]:uppercase" value={form.vehicleNumber} onChange={(event) => set({ vehicleNumber: event.target.value })} />
              <Select label="Vehicle type" name="booking-type" value={form.vehicleType} onChange={(event) => set({ vehicleType: event.target.value })}>
                {vehicleTypes.map((type) => (
                  <option key={type} value={type}>{VEHICLE_LABELS[type] || type}</option>
                ))}
              </Select>
              <Field label="Customer name (optional)" name="booking-name" autoComplete="off" value={form.customerName} onChange={(event) => set({ customerName: event.target.value })} />
              <Field label="Phone (optional)" name="booking-phone" inputMode="tel" autoComplete="off" value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
              <Field label="Expected arrival" name="booking-time" type="datetime-local" required value={form.expectedAt} onChange={(event) => set({ expectedAt: event.target.value })} />
              <Field label="Note (optional)" name="booking-note" autoComplete="off" value={form.note} onChange={(event) => set({ note: event.target.value })} />
            </div>
            <Button type="submit" loading={create.isPending}>Add booking</Button>
          </form>
        </div>
      )}
    </Card>
  )
}
