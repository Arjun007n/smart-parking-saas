// How a location's ticket and receipt look. Mirrors server/utils/receiptSettings.js:
// anything not set falls back to these defaults.
export const RECEIPT_DEFAULTS = {
  headerNote: '',
  ticketFooter: 'Keep this ticket safe. A lost ticket is charged extra.',
  receiptFooter: 'Thank you. Drive safe!',
  showAddress: true,
  showGst: true,
  showQr: 'DEVICE',
}

export const QR_MODES = [
  { value: 'DEVICE', label: 'Follow the gate printer setting' },
  { value: 'ON', label: 'Always print a QR code' },
  { value: 'OFF', label: 'Never print a QR code' },
]

export function receiptSettings(raw) {
  const source = raw || {}
  const text = (key) => (typeof source[key] === 'string' && source[key].trim() ? source[key].trim() : RECEIPT_DEFAULTS[key])
  const flag = (key) => (typeof source[key] === 'boolean' ? source[key] : RECEIPT_DEFAULTS[key])
  return {
    headerNote: typeof source.headerNote === 'string' ? source.headerNote.trim() : '',
    ticketFooter: text('ticketFooter'),
    receiptFooter: text('receiptFooter'),
    showAddress: flag('showAddress'),
    showGst: flag('showGst'),
    showQr: QR_MODES.some((m) => m.value === source.showQr) ? source.showQr : 'DEVICE',
  }
}
