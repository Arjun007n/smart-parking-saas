import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { anprApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, timeOnly } from '../../utils/format'
import { useFallbackInterval } from '../../hooks/useLive'
import { Alert, Badge, Button } from '../ui'

// How a suggestion reached us, for the little tag next to it.
function sourceLabel(d) {
  if (d.source === 'RFID') return `Pass tag${d.passNumber ? ` · ${d.passNumber}` : ''}`
  if (d.source === 'FASTAG') return 'FASTag'
  return ''
}

// Number plates seen by the gate camera, or tags seen by a reader, waiting for the operator.
// A camera or reader only SUGGESTS. A plate that arrives while this screen is open is put in the
// vehicle box for the operator to check (`canFill`), and, when the operator has switched the gate
// camera's auto mode on, a clearly read camera plate is handed to `onAuto` (which makes the ticket
// or looks the vehicle up; it answers false when it is busy, and the plate waits). Plates already waiting when the page opened are only listed.
export default function PlateSuggestions({ locationId, direction, onUse, usedId, canFill = false, auto = false, onAuto }) {
  const queryClient = useQueryClient()
  // The server announces new plates; asking on a timer is only a safety net while that works.
  const interval = useFallbackInterval(30_000, 4000)
  const list = useQuery({
    queryKey: ['anpr', locationId, direction],
    queryFn: () => anprApi.list({ locationId, direction }),
    enabled: Boolean(locationId),
    refetchInterval: interval,
  })
  const dismiss = useMutation({
    mutationFn: anprApi.dismiss,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['anpr'] }),
  })

  const items = list.data || []

  // Which suggestions this screen has already dealt with (or was already showing when it opened).
  const handled = useRef(null)
  const latest = useRef({})
  useEffect(() => {
    latest.current = { onUse, onAuto, canFill, auto }
  })
  useEffect(() => {
    if (!list.data) return
    if (handled.current === null || handled.current.where !== `${locationId}|${direction}`) {
      handled.current = { where: `${locationId}|${direction}`, ids: new Set(list.data.map((d) => d._id)) }
      return
    }
    const fresh = list.data.find((d) => d.plate && !handled.current.ids.has(d._id)) // newest first
    if (!fresh) return
    const { onUse: use, onAuto: automatic, canFill: fill, auto: isAuto } = latest.current
    // Auto mode is for cameras and photos only: a pass tag or FASTag never opens anything by itself.
    const cameraRead = fresh.source !== 'RFID' && fresh.source !== 'FASTAG'
    // `onAuto` answers false when it could not take the plate now (busy with another vehicle): it is kept for later.
    if (isAuto && automatic && cameraRead && !fresh.needsReview && automatic(fresh) !== false) {
      handled.current.ids.add(fresh._id)
    } else if (fill) {
      handled.current.ids.add(fresh._id)
      use(fresh)
    }
    // otherwise it stays unhandled and is dealt with when the form is free again
  }, [list.data, locationId, direction, canFill, auto])

  // Nothing to show and no camera activity: stay out of the way.
  if (!locationId || (!items.length && !list.error)) return null

  return (
    <div className="no-print space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <h2 className="text-sm font-semibold text-blue-900">Plate suggestions ({direction === 'ENTRY' ? 'entry' : 'exit'})</h2>
      <Alert>{list.error && errorMessage(list.error)}</Alert>
      <Alert>{dismiss.error && errorMessage(dismiss.error)}</Alert>
      <ul className="space-y-2">
        {items.map((d) => (
          <li
            key={d._id}
            className={`rounded-lg bg-white p-3 ring-1 ${usedId === d._id ? 'ring-blue-500' : 'ring-slate-200'}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-lg font-bold tracking-wider text-slate-900">
                  {d.plate || 'Not read'}
                </span>
                {sourceLabel(d) && <span className="ml-2"><Badge tone="blue">{sourceLabel(d)}</Badge></span>}
                {d.vehicleType && <span className="ml-2"><Badge tone="green">{VEHICLE_LABELS[d.vehicleType] || d.vehicleType}</Badge></span>}
                <span className="ml-2 text-xs text-slate-500">
                  {d.confidence != null && !d.source?.match(/RFID|FASTAG/) ? `${Math.round(d.confidence * 100)}% sure · ` : ''}
                  {timeOnly(d.lastSeenAt)}
                  {d.hits > 1 ? ` · seen ${d.hits}×` : ''}
                  {d.gate ? ` · ${d.gate}` : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <Button className="px-3 py-1 text-xs" onClick={() => onUse(d)}>
                  {d.plate ? 'Use' : 'Check photo'}
                </Button>
                <Button
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  loading={dismiss.isPending && dismiss.variables === d._id}
                  onClick={() => dismiss.mutate(d._id)}
                >
                  Dismiss
                </Button>
              </div>
            </div>
            {d.needsReview && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="red">Check this plate</Badge>
                <span className="text-xs text-amber-800">{d.reviewReasons.join(' · ')}</span>
              </div>
            )}
            {d.matchedTicketNumber && !d.alreadyInside && (
              <p className="mt-1 text-xs text-slate-600">Matches ticket {d.matchedTicketNumber}</p>
            )}
            {d.imageUrl && (
              <a href={d.imageUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-700 underline">
                View photo
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
