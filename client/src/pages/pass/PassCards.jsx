import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { passApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateOnly, lastDay } from '../../utils/format'
import { Alert, Button, PageLoader } from '../../components/ui'
import QrCode from '../../components/QrCode'
import { PM } from '../../components/pass/listState'

const vehiclesOf = (pass) => (pass.vehicles && pass.vehicles.length ? pass.vehicles : [{ number: pass.vehicleNumber, type: pass.vehicleType }])

// Print Pass: one card per ticked pass (name, vehicles, places, valid dates and a QR code of the pass number).
export default function PassCards() {
  const [params] = useSearchParams()
  const ids = params.get('ids') || ''
  const list = useQuery({ queryKey: ['pass-cards', ids], queryFn: () => passApi.list({ ids, limit: 200 }), enabled: Boolean(ids) })
  const passes = list.data?.passes || []

  useEffect(() => {
    if (!passes.length) return undefined
    const timer = setTimeout(() => window.print(), 400)
    return () => clearTimeout(timer)
  }, [passes.length])

  if (!ids) return <Alert type="info">Tick the passes to print on the Passes List first.</Alert>
  if (list.isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Print Pass</h1>
        <div className="flex gap-2">
          <Button type="button" onClick={() => window.print()} disabled={!passes.length}>Print</Button>
          <Link to={`${PM}/passes`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Back</Link>
        </div>
      </div>
      <Alert>{list.error && errorMessage(list.error)}</Alert>
      <div className="print-area grid gap-4 sm:grid-cols-2">
        {passes.map((pass) => (
          <article key={pass._id} className="break-inside-avoid rounded-lg border-2 border-slate-700 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parking Pass</p>
                <p className="text-lg font-bold text-slate-900">{pass.holderName}</p>
                {pass.company && <p className="text-slate-600">{pass.company}</p>}
                <p className="text-slate-700">
                  {vehiclesOf(pass).map((v) => `${v.number} (${VEHICLE_LABELS[v.type] || v.type})`).join(', ')}
                </p>
                <p className="text-slate-700">{pass.locationNames && pass.locationNames.length ? pass.locationNames.join(', ') : 'All locations'}</p>
                <p className="text-slate-700">Valid {dateOnly(pass.startDate)} to {lastDay(pass.endDate)}</p>
                <p className="font-mono text-xs text-slate-500">{pass.passNumber}</p>
              </div>
              <QrCode value={pass.passNumber} size={96} label={`QR code for pass ${pass.passNumber}`} />
            </div>
          </article>
        ))}
      </div>
      {!passes.length && !list.error && <p className="text-sm text-slate-500">No passes found.</p>}
    </div>
  )
}
