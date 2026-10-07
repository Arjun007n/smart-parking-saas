import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Button } from '../ui'
import { VEHICLE_LABELS } from '../../utils/format'

const GATE_USE = { ENTRY: 'Entry', EXIT: 'Exit', BOTH: 'Entry and exit' }
const DEVICE = { ANPR_CAMERA: 'ANPR camera', RFID_READER: 'RFID reader', FASTAG_READER: 'FASTag reader', CCTV_CAMERA: 'CCTV camera' }
const PAGE_SIZE = 10

// The "Lanes" tab of a location: every lane with what it is for, its codes, camera serial, the operators
// tied to it and the devices set to it. It can be searched and paged, and an admin can switch a lane on or
// off here (a lane that is off takes no entries or exits and keeps its set-up). Lanes themselves are added,
// renamed and removed on the Details tab.
export default function LanesPanel({ location, onEdit, canManage }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const lanes = useQuery({
    queryKey: ['lanes', location._id, q, page],
    queryFn: () => locationApi.lanes(location._id, { q, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const toggle = useMutation({
    mutationFn: ({ lane, isActive }) => locationApi.setLaneStatus(location._id, lane._id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lanes', location._id] })
      queryClient.invalidateQueries({ queryKey: ['location', location._id] })
    },
  })

  const search = (event) => {
    event.preventDefault()
    setPage(1)
    setQ(draft.trim())
  }
  const clear = () => {
    setDraft('')
    setQ('')
    setPage(1)
  }

  const data = lanes.data
  const rows = data?.rows || []
  const none = (location.gates || []).length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          A lane is a gate where vehicles come in or go out. Cameras and readers are attached to a lane on the Hardware page, and operators are tied to lanes on the Users page.
        </p>
        {canManage && <Button type="button" variant="secondary" onClick={onEdit}>Add or edit lanes</Button>}
      </div>

      {none ? (
        <p className="text-sm text-slate-500">No lanes yet. {canManage ? 'Add one on the Details tab.' : ''}</p>
      ) : (
        <>
          <form onSubmit={search} className="flex flex-wrap items-end gap-2" role="search">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">Search lanes</span>
              <input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Name, lane code, camera serial, operator, device"
                className="w-72 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <Button type="submit" variant="secondary">Search</Button>
            {q && <Button type="button" variant="secondary" onClick={clear}>Clear</Button>}
          </form>

          {toggle.error && <Alert>{errorMessage(toggle.error)}</Alert>}
          {lanes.error && <Alert>{errorMessage(lanes.error)}</Alert>}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-slate-300 text-slate-600">
                <tr>
                  <th className="py-2 pr-3">SN</th><th className="py-2 pr-3">Name / type</th><th className="py-2 pr-3">Lane code</th>
                  <th className="py-2 pr-3">FASTag</th><th className="py-2 pr-3">Camera serial</th><th className="py-2 pr-3">Operators</th>
                  <th className="py-2 pr-3">Devices</th><th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lane) => (
                  <tr key={lane._id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">{lane.sn}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-slate-900">{lane.name}</span><br />
                      <span className="text-xs text-slate-500">{GATE_USE[lane.type] || lane.type}{lane.vehicleType ? ` · ${VEHICLE_LABELS[lane.vehicleType] || lane.vehicleType} lane` : ''}</span>
                    </td>
                    <td className="py-2 pr-3">{lane.laneCode || '—'}</td>
                    <td className="py-2 pr-3">{lane.fastagLaneId ? <Badge tone="blue">{lane.fastagLaneId}</Badge> : 'No'}</td>
                    <td className="py-2 pr-3">{lane.cameraSerial || '—'}</td>
                    <td className="py-2 pr-3">
                      {lane.operators.length === 0
                        ? <span className="text-slate-500">Anyone at this location</span>
                        : lane.operators.map((o) => <div key={o._id}>{o.name}</div>)}
                    </td>
                    <td className="py-2 pr-3">
                      {lane.devices.length === 0 ? <span className="text-slate-500">None</span> : lane.devices.map((d) => (
                        <div key={d._id} className="flex items-center gap-2">
                          <span>{DEVICE[d.type] || d.type}: {d.name}</span>
                          <Badge tone={d.isOnline ? 'green' : 'red'}>{d.isOnline ? 'Online' : 'Offline'}</Badge>
                        </div>
                      ))}
                    </td>
                    <td className="py-2">
                      <Badge tone={lane.isActive ? 'green' : 'red'}>{lane.isActive ? 'Active' : 'De-Active'}</Badge>
                      {canManage && (
                        <div className="mt-1">
                          <button
                            type="button"
                            className="text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
                            disabled={toggle.isPending}
                            onClick={() => toggle.mutate({ lane, isActive: !lane.isActive })}
                          >
                            {lane.isActive ? 'Switch off' : 'Switch on'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!lanes.isPending && rows.length === 0 && (
                  <tr><td colSpan={8} className="py-6 text-center text-slate-500">No lane matches “{q}”.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {data && data.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>Showing {(data.page - 1) * data.limit + 1}–{(data.page - 1) * data.limit + rows.length} of {data.total}</span>
              <span className="flex items-center gap-2">
                <Button type="button" variant="secondary" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</Button>
                <span>Page {data.page} of {data.pages}</span>
                <Button type="button" variant="secondary" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</Button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
