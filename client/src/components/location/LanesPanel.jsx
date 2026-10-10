import { useDeferredValue, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Button, Field, Select } from '../ui'
import { CLASS_LABELS, LANE_VEHICLES } from '../../utils/lanes'

const DEVICE = { ANPR_CAMERA: 'ANPR camera', RFID_READER: 'RFID reader', FASTAG_READER: 'FASTag reader', CCTV_CAMERA: 'CCTV camera' }
const PAGE_SIZES = [10, 25, 50, 100]
const BLANK = {
  vehicleType: '', type: 'ENTRY', fastag: 'NO', doorNo: '', readerNo: '', cameraSerial: '',
  fastagLaneId: '', gateNo: '', floorNo: '', direction: '', fastagLaneType: '', fastagLaneMode: '',
}

// What the form shows for a saved lane.
const toForm = (lane) => ({
  vehicleType: lane.vehicleType || '', type: lane.type === 'EXIT' ? 'EXIT' : 'ENTRY', fastag: lane.fastag ? 'YES' : 'NO',
  doorNo: lane.doorNo, readerNo: lane.readerNo, cameraSerial: lane.cameraSerial, fastagLaneId: lane.fastagLaneId,
  gateNo: lane.gateNo, floorNo: lane.floorNo, direction: lane.direction, fastagLaneType: lane.fastagLaneType, fastagLaneMode: lane.fastagLaneMode,
})

// What the API takes: the lane is one vehicle going one way; the FASTag details only count when FASTag is YES.
const toBody = (v, editing) => {
  const yes = v.fastag === 'YES'
  return {
    vehicleType: v.vehicleType,
    type: v.type,
    cameraSerial: v.cameraSerial.trim(),
    fastag: yes,
    ...(editing ? { doorNo: v.doorNo.trim(), readerNo: v.readerNo.trim() } : {}),
    ...(yes
      ? {
        fastagLaneId: v.fastagLaneId.trim(), gateNo: v.gateNo.trim(), floorNo: v.floorNo.trim(), direction: v.direction.trim(),
        fastagLaneType: v.fastagLaneType.trim(), fastagLaneMode: v.fastagLaneMode.trim(),
      }
      : {}),
  }
}

// "Create Parking Lane" / "Edit Parking Lane": one lane is one vehicle going one way (Car-Entry, Bike-Exit ...).
function LaneForm({ location, editing, onDone }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState(editing ? toForm(editing) : BLANK)
  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }))
  const accepted = Object.keys(LANE_VEHICLES).filter((type) => (location.vehicleTypes || []).includes(type))

  const save = useMutation({
    mutationFn: () => {
      const body = toBody(values, Boolean(editing))
      return editing ? locationApi.updateLane(location._id, editing._id, body) : locationApi.createLane(location._id, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lanes', location._id] })
      queryClient.invalidateQueries({ queryKey: ['location', location._id] })
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      setValues(BLANK)
      onDone()
    },
  })

  const submit = (event) => {
    event.preventDefault()
    if (!values.vehicleType) return
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <h3 className="text-lg font-bold text-[#1e3d73]">{editing ? 'Edit Parking Lane' : 'Create Parking Lane'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <Field label="Location" value={location.name} readOnly disabled />
      <Select label="Lane Name *" name="vehicleType" value={values.vehicleType} onChange={set('vehicleType')} error={save.isIdle || values.vehicleType ? undefined : 'Choose a vehicle'}>
        <option value="">-Select One-</option>
        {accepted.map((type) => (
          <option key={type} value={type}>{LANE_VEHICLES[type]}</option>
        ))}
      </Select>
      {editing && (
        <>
          <Field label="Door/Lane No. *" name="doorNo" value={values.doorNo} onChange={set('doorNo')} required />
          <Field label="Reader *" name="readerNo" value={values.readerNo} onChange={set('readerNo')} required />
        </>
      )}
      <Select label="Lane Type *" name="type" value={values.type} onChange={set('type')}>
        <option value="ENTRY">Entry</option>
        <option value="EXIT">Exit</option>
      </Select>
      <Select label="FASTag *" name="fastag" value={values.fastag} onChange={set('fastag')}>
        <option value="NO">NO</option>
        <option value="YES">YES</option>
      </Select>
      <Field label="Camera Serial No. (ANPR)" name="cameraSerial" value={values.cameraSerial} onChange={set('cameraSerial')} maxLength={60} />
      {values.fastag === 'YES' && (
        <>
          <Field label="FASTag Lane Code *" name="fastagLaneId" value={values.fastagLaneId} onChange={set('fastagLaneId')} maxLength={30} hint="From your FASTag provider" />
          <Field label="Gate No." name="gateNo" value={values.gateNo} onChange={set('gateNo')} maxLength={20} placeholder="G1" />
          <Field label="Floor No. (Ex. F1/F2/F3)" name="floorNo" value={values.floorNo} onChange={set('floorNo')} maxLength={20} placeholder="F1" />
          <Field label="Direction" name="direction" value={values.direction} onChange={set('direction')} maxLength={20} placeholder="N" />
          <Field label="FASTag Lane Type" name="fastagLaneType" value={values.fastagLaneType} onChange={set('fastagLaneType')} maxLength={30} placeholder="Hybrid" />
          <Field label="FASTag Lane Mode" name="fastagLaneMode" value={values.fastagLaneMode} onChange={set('fastagLaneMode')} maxLength={30} placeholder="Normal" />
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending} disabled={!values.vehicleType}>{editing ? 'Update' : 'Submit'}</Button>
        {editing ? (
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        ) : (
          <Button type="reset" variant="secondary" onClick={() => setValues(BLANK)}>Reset</Button>
        )}
      </div>
    </form>
  )
}

function Operators({ operators }) {
  if (operators.length === 0) return <span title="Nobody can work this lane yet"><Badge tone="amber">No operator</Badge></span>
  return operators.map((o) => <div key={o._id}>{o.name}{o.isActive ? '' : ' (switched off)'}</div>)
}

// A short list of the pages around the current one: 1 … 4 5 6 … 9.
const pageList = (page, pages) => {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const out = []
  let last = 0
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (n - last > 1) out.push('gap-' + n)
    out.push(n)
    last = n
  }
  return out
}

// The "Lanes" tab of a location, laid out like the Parking Lane page of ismartparking.com: the Create Parking
// Lane form beside the lane list. A lane is one vehicle going one way (Car-Entry, Bike-Exit ...), with its own
// Door/Lane No. and Reader, one operator, the camera serial and an Active / De-Active switch. A lane takes only
// its own class of vehicle: a bike lane takes two-wheelers, every other lane four-wheelers.
export default function LanesPanel({ location, canManage }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const [size, setSize] = useState(10)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState(null)

  const lanes = useQuery({
    queryKey: ['lanes', location._id, q, size, page],
    queryFn: () => locationApi.lanes(location._id, { q, page, limit: size }),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const toggle = useMutation({
    mutationFn: (lane) => locationApi.setLaneStatus(location._id, lane._id, !lane.isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lanes', location._id] })
      queryClient.invalidateQueries({ queryKey: ['location', location._id] })
    },
  })

  const data = lanes.data
  const rows = data?.rows || []
  const from = data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0
  const missing = data?.setup?.missing || []

  return (
    <div className={`grid gap-6 ${canManage ? 'lg:grid-cols-[17rem_1fr]' : ''}`}>
      {canManage && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <LaneForm key={editing ? editing._id : 'new'} location={location} editing={editing} onDone={() => setEditing(null)} />
        </div>
      )}

      <div className="min-w-0 space-y-3">
        <h3 className="text-lg font-bold text-[#1e3d73]">{location.name} : Parking Lane List</h3>
        {missing.length > 0 && (
          <Alert type="info">
            A location needs an entry lane and an exit lane for 2-wheelers and for 4-wheelers. Still missing: {missing.join(', ')}.
          </Alert>
        )}
        <Alert>{toggle.error && errorMessage(toggle.error)}</Alert>
        <Alert>{lanes.error && errorMessage(lanes.error)}</Alert>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            Show
            <select
              className="rounded border border-slate-300 px-2 py-1"
              value={size}
              onChange={(e) => { setSize(Number(e.target.value)); setPage(1) }}
            >
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            entries
          </label>
          <label className="flex items-center gap-2">
            Search:
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="border-b border-slate-300 bg-slate-50 text-slate-700">
              <tr>
                <th className="px-2 py-2">SN</th><th className="px-2 py-2">Name/Type</th><th className="px-2 py-2">Door/Lane No.</th>
                <th className="px-2 py-2">FASTag</th><th className="px-2 py-2">FASTag Lane Code</th><th className="px-2 py-2">Reader</th>
                <th className="px-2 py-2">Operator</th><th className="px-2 py-2">Camera Serial No. (ANPR)</th><th className="px-2 py-2">Status</th>
                {canManage && <th className="px-2 py-2">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((lane) => (
                <tr key={lane._id} className="border-b border-slate-100 align-top odd:bg-slate-50/60">
                  <td className="px-2 py-2">{lane.sn}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium text-slate-900">{lane.name}</span>
                    {lane.vehicleClass && <div className="text-xs text-slate-500">{CLASS_LABELS[lane.vehicleClass]} lane</div>}
                    {lane.devices.map((d) => (
                      <div key={d._id} className="text-xs text-slate-500">
                        {DEVICE[d.type] || d.type}: {d.name} <span className={d.isOnline ? 'text-green-700' : 'text-red-700'}>{d.isOnline ? 'online' : 'offline'}</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-2">{lane.doorNo || '—'}</td>
                  <td className="px-2 py-2"><Badge tone={lane.fastag ? 'green' : 'red'}>{lane.fastag ? 'YES' : 'NO'}</Badge></td>
                  <td className="px-2 py-2">{lane.fastagLaneId || '-'}</td>
                  <td className="px-2 py-2">{lane.readerNo || '—'}</td>
                  <td className="px-2 py-2"><Operators operators={lane.operators} /></td>
                  <td className="px-2 py-2">{lane.cameraSerial}</td>
                  <td className="px-2 py-2">
                    {canManage ? (
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(lane)}
                        title={lane.isActive ? 'Click to switch this lane off' : 'Click to switch this lane on'}
                        className={`rounded px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 ${lane.isActive ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
                      >
                        {lane.isActive ? 'Active' : 'De-Active'}
                      </button>
                    ) : (
                      <Badge tone={lane.isActive ? 'green' : 'red'}>{lane.isActive ? 'Active' : 'De-Active'}</Badge>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        title="Edit Parking Lane"
                        aria-label={`Edit ${lane.name}`}
                        onClick={() => { setEditing(lane); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }}
                        className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!lanes.isPending && rows.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 10 : 9} className="py-6 text-center text-slate-500">
                    {q ? `No lane matches “${q}”.` : 'No lanes yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
            <span>Showing {from} to {from ? from + rows.length - 1 : 0} of {data.total} entries</span>
            <span className="flex flex-wrap items-center gap-1">
              <Button type="button" variant="secondary" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</Button>
              {pageList(data.page, data.pages).map((n) =>
                typeof n === 'string' ? (
                  <span key={n} className="px-1">…</span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    aria-current={n === data.page ? 'page' : undefined}
                    className={`min-w-8 rounded border px-2 py-1 ${n === data.page ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-100'}`}
                  >
                    {n}
                  </button>
                ),
              )}
              <Button type="button" variant="secondary" disabled={data.page >= data.pages} onClick={() => setPage(data.page + 1)}>Next</Button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
