// Turns a ticket or a receipt of the website into the slip that the Bluetooth printer prints, and prints it.
import { PAYMENT_LABELS, VEHICLE_LABELS, dateTime, duration, money } from '../utils/format'
import { operationSettings } from '../utils/operations'
import { receiptSettings } from '../utils/receiptSettings'
import { billSlip, testSlip, ticketSlip } from './escpos'
import { printBytes, savedPrinter } from './printer'

const widthOf = (printer) => (printer || savedPrinter())?.width || 58

// A new or repeated entry ticket. `session` is the parking session, as the Entry page has it.
export async function printTicketOnPhone({ session, locationName, settings, operations }) {
  const look = receiptSettings(settings)
  const ops = operationSettings(operations)
  const printer = savedPrinter()
  const bytes = ticketSlip(
    {
      place: locationName,
      note: look.headerNote,
      ticketNumber: ops.printTicketNumber ? session.ticketNumber : '',
      vehicle: session.vehicleNumber,
      kind: VEHICLE_LABELS[session.vehicleType] || session.vehicleType,
      entry: dateTime(session.entryTime),
      gate: session.entryGate,
      advance: session.advance?.amount > 0 ? `${money(session.advance.amount)} (${PAYMENT_LABELS[session.advance.method] || session.advance.method})` : '',
      qr: look.showQr !== 'OFF' ? session.ticketNumber : '',
      footer: look.ticketFooter,
    },
    { width: widthOf(printer) },
  )
  await printBytes(bytes, printer)
}

// The exit bill. `r` is the receipt from the server (parkingApi.receipt).
export async function printBillOnPhone(r) {
  const look = receiptSettings(r.settings)
  const b = r.amount.breakdown
  const printer = savedPrinter()
  const address = [r.location.address?.line1, r.location.address?.city, r.location.address?.state, r.location.address?.pincode].filter(Boolean).join(', ')
  const rows = [
    { label: 'Receipt', value: r.receiptNumber },
    { label: 'Ticket', value: r.ticketNumber },
    { label: 'Vehicle', value: `${r.vehicle.number} (${VEHICLE_LABELS[r.vehicle.type] || r.vehicle.type})` },
    { label: 'In', value: dateTime(r.entryTime) },
    { label: 'Out', value: dateTime(r.exitTime) },
  ]
  if (r.durationMinutes != null) rows.push({ label: 'Duration', value: duration(r.durationMinutes) })
  rows.push({ label: 'Parking fee', value: money(b.base) })
  if (b.overnight > 0) rows.push({ label: 'Overnight', value: money(b.overnight) })
  if (b.lostTicket > 0) rows.push({ label: 'Lost ticket', value: money(b.lostTicket) })
  if (b.discount > 0) rows.push({ label: 'Discount', value: `-${money(b.discount)}` })
  if (r.amount.taxPercent > 0) {
    rows.push({ label: 'Before tax', value: money(r.amount.subtotal) })
    rows.push({ label: `Tax ${r.amount.taxPercent}%`, value: money(r.amount.tax) })
  }
  rows.push({ label: 'Total', value: money(r.amount.total), strong: true })
  if (r.advance) rows.push({ label: 'Advance paid', value: money(r.advance.amount) })
  rows.push({ label: 'Paid', value: money(r.paid), strong: true })
  if (r.payment) rows.push({ label: 'Paid by', value: PAYMENT_LABELS[r.payment.method] || r.payment.method })
  if (r.pass) rows.push({ label: 'Pass', value: `${r.pass.passNumber}` })
  if (r.operators?.exit) rows.push({ label: 'Operator', value: r.operators.exit })

  const bytes = billSlip(
    {
      company: r.company.legalName || r.company.name,
      place: r.location.name,
      address: look.showAddress ? address : '',
      gst: look.showGst ? r.company.gstNumber : '',
      note: look.headerNote,
      rows,
      qr: look.showQr !== 'OFF' ? r.ticketNumber : '',
      reference: r.reference,
      footer: look.receiptFooter,
    },
    { width: widthOf(printer) },
  )
  await printBytes(bytes, printer)
}

// A short test slip for the printer set-up screen. `printer` may be one that is not saved yet.
export async function printTestSlip(printer) {
  await printBytes(testSlip(printer.name, { width: printer.width }), printer)
}
