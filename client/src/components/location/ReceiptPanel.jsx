import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { QR_MODES, RECEIPT_DEFAULTS, receiptSettings } from '../../utils/receiptSettings'
import { Alert, Button, Field, Select } from '../ui'
import QrCode from '../QrCode'

const stored = (location) => {
  const r = location.receiptSettings || {}
  return {
    headerNote: r.headerNote || '',
    ticketFooter: r.ticketFooter || '',
    receiptFooter: r.receiptFooter || '',
    showAddress: r.showAddress !== false,
    showGst: r.showGst !== false,
    showQr: r.showQr || 'DEVICE',
    upiId: r.upiId || '',
  }
}

// What the printed slip will look like, using made-up vehicle details.
function Preview({ title, form, location, gst, receipt }) {
  const look = receiptSettings(form)
  const address = [location.address?.line1, location.address?.city].filter(Boolean).join(', ')
  return (
    <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 text-center text-xs text-slate-700">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title} preview</p>
      <p className="text-sm font-bold text-slate-900">Your company</p>
      <p>{location.name}</p>
      {look.showAddress && address && <p className="text-slate-500">{address}</p>}
      {look.showGst && gst && <p className="text-slate-500">GSTIN: {gst}</p>}
      {look.headerNote && <p className="mt-1">{look.headerNote}</p>}
      <hr className="my-2 border-slate-300" />
      <p className="font-semibold uppercase">{receipt ? 'Parking receipt' : 'Parking ticket'}</p>
      {!receipt && <p className="font-mono text-base font-bold text-slate-900">T-261003-ABC234</p>}
      <p className="mt-1 text-left">Vehicle: MH12AB1234</p>
      <p className="text-left">Entry: 03 Oct 2026, 10:00</p>
      {receipt && (
        <>
          <p className="text-left">Exit: 03 Oct 2026, 12:35</p>
          <p className="text-left font-semibold">Total: Rs. 50.00</p>
        </>
      )}
      <hr className="my-2 border-slate-300" />
      {look.showQr !== 'OFF' && (
        <div className="mb-2 flex justify-center">
          <QrCode value="T-261003-ABC234" size={64} label="Sample QR code" />
        </div>
      )}
      <p>{receipt ? look.receiptFooter : look.ticketFooter}</p>
      {look.showQr === 'DEVICE' && <p className="mt-1 text-[10px] text-slate-400">On the gate printer the QR code follows that printer&apos;s own setting.</p>}
    </div>
  )
}

// The "Receipt" tab of a location: wording and options for tickets and receipts.
export default function ReceiptPanel({ location, company }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => stored(location))
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = useMutation({
    mutationFn: () => locationApi.update(location._id, { receiptSettings: form }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['location', location._id], updated)
      queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <p className="text-sm text-slate-600">
          What the tickets and receipts of <strong>{location.name}</strong> say. This applies to the screen, to printing from the browser and to the gate printer. Leave a footer empty to use the standard wording.
        </p>
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        <Alert type="success">{save.isSuccess && 'Receipt settings saved.'}</Alert>

        <Field label="Extra line under the address (optional)" name="receipt-header" maxLength={120} placeholder="For example: Open 24 hours · Helpline 98xxxxxx" value={form.headerNote} onChange={(event) => set({ headerNote: event.target.value })} />
        <Field label="Ticket footer" name="receipt-ticket-footer" maxLength={200} placeholder={RECEIPT_DEFAULTS.ticketFooter} value={form.ticketFooter} onChange={(event) => set({ ticketFooter: event.target.value })} />
        <Field label="Receipt footer" name="receipt-footer" maxLength={200} placeholder={RECEIPT_DEFAULTS.receiptFooter} value={form.receiptFooter} onChange={(event) => set({ receiptFooter: event.target.value })} />

        <div className="flex flex-wrap gap-6 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={form.showAddress} onChange={(event) => set({ showAddress: event.target.checked })} />
            Show the address
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={form.showGst} onChange={(event) => set({ showGst: event.target.checked })} />
            Show the GST number
          </label>
        </div>

        <Select label="QR code" name="receipt-qr" value={form.showQr} onChange={(event) => set({ showQr: event.target.value })}>
          {QR_MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </Select>

        <Field label="UPI id for payments (optional)" name="receipt-upi" maxLength={60} placeholder="yourshop@okaxis" hint="The phone exit screen shows a QR code for this id with the amount to pay when the operator picks UPI." value={form.upiId} onChange={(event) => set({ upiId: event.target.value.trim() })} />

        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>Save receipt settings</Button>
          <Button type="button" variant="secondary" onClick={() => setForm(stored({}))}>Use standard wording</Button>
        </div>
      </form>

      <div className="space-y-4">
        <Preview title="Ticket" form={form} location={location} gst={company?.gstNumber} />
        <Preview title="Receipt" form={form} location={location} gst={company?.gstNumber} receipt />
      </div>
    </div>
  )
}
