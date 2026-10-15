import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Button, Card } from '../../components/ui'
import { forgetPrinter, openBluetoothSettings, pairedDevices, printerAvailable, savePrinter, savedPrinter } from '../../native/printer'
import { printTestSlip } from '../../native/slips'
import { errorMessage } from '../../utils/errors'

const WIDTHS = [
  { value: 58, label: '58 mm (small, 32 characters)' },
  { value: 80, label: '80 mm (wide, 48 characters)' },
]

// The Bluetooth printer of the phone app: pick the paired printer once, then tickets and bills print by themselves.
export default function PrinterSetup() {
  const [printer, setPrinter] = useState(savedPrinter)
  const [devices, setDevices] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const run = async (name, action) => {
    setBusy(name)
    setError('')
    setDone('')
    try {
      await action()
    } catch (problem) {
      setError(problem?.message || errorMessage(problem))
    } finally {
      setBusy('')
    }
  }

  const load = () => run('list', async () => setDevices(await pairedDevices()))

  const choose = (device) => {
    const next = { address: device.address, name: device.name, width: printer?.width || 58 }
    savePrinter(next)
    setPrinter(next)
    setDone(`${device.name} is chosen. Print a test slip to check it.`)
  }

  const setWidth = (width) => {
    if (!printer) return
    const next = { ...printer, width }
    savePrinter(next)
    setPrinter(next)
  }

  const test = () =>
    run('test', async () => {
      await printTestSlip(printer)
      setDone('Test slip sent. If it came out cut off or unreadable, change the paper size.')
    })

  const forget = () => {
    forgetPrinter()
    setPrinter(null)
    setDone('')
  }

  if (!printerAvailable) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Printer</h1>
        <Alert type="info">Bluetooth printing works only in the Smart Parking phone app. On a computer the page prints through the computer's own printer.</Alert>
        <Link to="/operator/dashboard" className="text-sm text-blue-700 hover:underline">← Back to home</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Printer</h1>

      <Card title="This phone's printer">
        {printer ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">{printer.name}</span> <Badge tone="green">chosen</Badge>
              <span className="mt-1 block text-xs text-slate-500">New tickets print on it by themselves. Bills print from the Print bill button.</span>
            </p>
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Paper size</legend>
              <div className="space-y-1">
                {WIDTHS.map((w) => (
                  <label key={w.value} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="radio" name="paper" checked={printer.width === w.value} onChange={() => setWidth(w.value)} />
                    {w.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === 'test'} onClick={test}>Print test slip</Button>
              <Button variant="danger" onClick={forget}>Remove printer</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No printer chosen yet. Tickets and bills cannot print from this phone until you choose one.</p>
        )}
      </Card>

      <Card title={printer ? 'Choose another printer' : 'Choose your printer'}>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Switch the printer on.</li>
          <li>In the phone's Bluetooth settings, pair with it once (the code is usually 0000 or 1234).</li>
          <li>Come back here and tap "Show paired devices".</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy === 'list'} onClick={load}>Show paired devices</Button>
          <Button variant="secondary" onClick={openBluetoothSettings}>Open Bluetooth settings</Button>
        </div>
        {devices && (
          <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200">
            {devices.length === 0 && <li className="p-3 text-sm text-slate-500">No paired devices. Pair the printer in the phone's Bluetooth settings first.</li>}
            {devices.map((device) => (
              <li key={device.address} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium text-slate-900">{device.name}</span>
                  <span className="text-xs text-slate-500">{device.printer ? 'Printer' : 'Other device'} · {device.address}</span>
                </span>
                <Button variant={printer?.address === device.address ? 'secondary' : 'primary'} onClick={() => choose(device)}>
                  {printer?.address === device.address ? 'Chosen' : 'Choose'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Alert>{error}</Alert>
      <Alert type="success">{done}</Alert>
    </div>
  )
}
