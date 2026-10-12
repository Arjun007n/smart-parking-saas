// The gate switches of a location. Mirrors server/utils/operations.js: anything not set uses these.
export const OPERATION_DEFAULTS = {
  allowReEntry: true,
  exitAmountEdit: false,
  autoExitHours: 0,
  printTicketNumber: true,
  printPhoto: false,
  photoAutoCapture: false,
  printPassReceipt: true,
}

export const OPERATION_SWITCHES = [
  { key: 'allowReEntry', label: 'Allow re-entry', hint: 'Gate staff can cancel a ticket and issue a new one for the same vehicle (a misread plate, a wrong vehicle type). There is no limit on how often; every re-entry is counted per operator in the admin reports.' },
  { key: 'exitAmountEdit', label: 'Allow changing the amount at exit', hint: 'The person at the exit can collect a different amount than the tariff. A reason is always asked for and everything is recorded.' },
  { key: 'printTicketNumber', label: 'Print the ticket number', hint: 'Show the ticket number in words on the ticket. The QR code is not affected.' },
  { key: 'printPhoto', label: 'Show the entry photo on the ticket', hint: 'The photo taken at entry appears on the ticket and receipt shown on screen.' },
  { key: 'photoAutoCapture', label: 'Take the entry photo automatically', hint: 'When the ticket is made, the entry camera takes the picture by itself if you did not.' },
  { key: 'printPassReceipt', label: 'Give a receipt to pass holders', hint: 'Pass holders pay nothing at exit. Switch off to skip the receipt step for them.' },
]

export function operationSettings(raw) {
  const source = raw || {}
  const out = {}
  for (const { key } of OPERATION_SWITCHES) out[key] = typeof source[key] === 'boolean' ? source[key] : OPERATION_DEFAULTS[key]
  const hours = Number(source.autoExitHours)
  out.autoExitHours = Number.isFinite(hours) && hours > 0 ? Math.min(720, Math.floor(hours)) : 0
  return out
}
