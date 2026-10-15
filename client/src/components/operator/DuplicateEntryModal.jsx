import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateTime } from '../../utils/format'
import { Alert, Button } from '../ui'
import { Modal } from '../pass/ListKit'

// "Vehicle Already Entered" (ismartparking.com): the plate that was tried already has an open ticket. The operator can
// print that ticket again, cancel it and enter the vehicle afresh, go to the exit with it, or close the window.
export default function DuplicateEntryModal({ session, onReprint, onReEntry, onExit, onClose }) {
  const queryClient = useQueryClient()
  const first = useRef(null)
  useEffect(() => {
    const timer = setTimeout(() => first.current && first.current.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  const again = useMutation({
    mutationFn: () => parkingApi.reEntry(session._id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['entries'] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      onReEntry(data)
    },
  })

  return (
    <Modal title="Vehicle Already Entered" onClose={onClose}>
      <div className="mb-3 flex flex-col items-center gap-1 text-center md:hidden">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl font-extrabold text-amber-600" aria-hidden="true">!</span>
        <p className="text-sm font-semibold text-slate-700">This vehicle is already inside.</p>
      </div>
      <p className="mb-3 text-sm text-slate-600 max-md:hidden">Duplicate vehicle detected in parking system.</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm max-md:rounded-xl max-md:ring-1 max-md:ring-slate-200">
        <div><dt className="text-xs text-slate-500">Vehicle</dt><dd className="text-lg font-bold tracking-wider text-slate-900">{session.vehicleNumber}</dd></div>
        <div><dt className="text-xs text-slate-500">Ticket</dt><dd className="font-mono font-semibold text-slate-900">{session.ticketNumber}</dd></div>
        <div><dt className="text-xs text-slate-500">Type</dt><dd>{VEHICLE_LABELS[session.vehicleType] || session.vehicleType}</dd></div>
        <div><dt className="text-xs text-slate-500">In time</dt><dd>{dateTime(session.entryTime)}{session.entryGate ? ` · ${session.entryGate}` : ''}</dd></div>
      </dl>
      <div className="mt-3"><Alert>{again.error && errorMessage(again.error)}</Alert></div>
      <div className="mt-4 flex flex-wrap gap-2 max-md:grid max-md:grid-cols-2 max-md:gap-3 max-md:[&>*]:w-full max-md:[&>*]:justify-center max-md:[&>*]:py-3 max-md:[&>*]:text-base">
        <button
          ref={first}
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold max-md:rounded-xl text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          onClick={() => onReprint(session)}
        >
          Re-Print
        </button>
        {onReEntry && (
          <Button type="button" variant="secondary" loading={again.isPending} onClick={() => again.mutate()} title="Cancel this ticket and issue a new one">
            Re-Entry
          </Button>
        )}
        {onExit && <Button type="button" variant="danger" disabled={again.isPending} onClick={() => onExit(session)}>Exit</Button>}
        <Button type="button" variant="secondary" className="max-md:col-span-2" disabled={again.isPending} onClick={onClose}>Close</Button>
      </div>
    </Modal>
  )
}
