import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passUserApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Button, Field, PageLoader, Select } from '../../components/ui'
import { ExportButtons, IconButton, Modal, PageTitle, Pager, SearchBox, ShowEntries } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

// Pass Management > Pass Users > Vehicles: "Manage User Vehicles" with Add New Vehicle and Edit.
export default function PassUserVehicles() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const tableRef = useRef(null)
  const [editing, setEditing] = useState(null) // null = closed, 'new', or a vehicle
  const [form, setForm] = useState({ vehicleNumber: '', vehicleType: '' })
  const [state, patch, setPage] = useListState({ q: '' })
  const user = useQuery({ queryKey: ['pass-user', id], queryFn: () => passUserApi.get(id) })

  const open = (vehicle) => {
    save.reset()
    setEditing(vehicle)
    setForm(vehicle === 'new' ? { vehicleNumber: '', vehicleType: '' } : { vehicleNumber: vehicle.plateNumber, vehicleType: vehicle.vehicleType })
  }
  const save = useMutation({
    mutationFn: () => (editing === 'new'
      ? passUserApi.addVehicle(id, { vehicleNumber: form.vehicleNumber.trim(), vehicleType: form.vehicleType })
      : passUserApi.updateVehicle(id, editing._id, { vehicleNumber: form.vehicleNumber.trim(), vehicleType: form.vehicleType })),
    onSuccess: () => {
      for (const key of ['pass-user', 'pass-users', 'pass-user-stats', 'pass-vehicle-list']) queryClient.invalidateQueries({ queryKey: [key] })
      setEditing(null)
    },
  })

  if (user.isLoading) return <PageLoader />
  if (user.error) return <Alert>{errorMessage(user.error)}</Alert>
  const { user: holder, vehicles, company } = user.data
  const needle = state.q.trim().toLowerCase()
  const all = vehicles.filter((v) => !needle || v.plateNumber.toLowerCase().includes(needle))
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit)

  return (
    <div className="space-y-5">
      <PageTitle title="Manage User Vehicles" back={PM + '/users'}>
        <Button type="button" variant="success" onClick={() => open('new')}>Add New Vehicle</Button>
      </PageTitle>
      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-4">
        <p><span className="block text-xs text-slate-500">User Name</span><b>{holder.name}</b></p>
        <p><span className="block text-xs text-slate-500">Mobile</span><b>{holder.mobile || '—'}</b></p>
        <p><span className="block text-xs text-slate-500">Company Name</span><b>{company ? company.name : 'N/A'}</b></p>
        <p><span className="block text-xs text-slate-500">Address</span><b>{holder.address || '—'}</b></p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Vehicles List</h2>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} sizes={[25, 50, 100, 200]} />
          <SearchBox value={state.q} onChange={(q) => patch({ q })} />
        </div>
        <div className="mb-3 flex gap-2">
          <ExportButtons disabled={all.length === 0} onPrint={() => printTable(tableRef.current, `Vehicles of ${holder.name}`)} />
        </div>
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full border border-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr>{['SN', 'Vehicle No.', 'Vehicle Type', 'Action'].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-slate-500">No vehicles yet.</td></tr>}
              {rows.map((v, i) => (
                <tr key={v._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                  <td className="p-2">{(state.page - 1) * state.limit + i + 1}</td>
                  <td className="p-2 font-medium">{v.plateNumber}</td>
                  <td className="p-2">{VEHICLE_LABELS[v.vehicleType]}</td>
                  <td className="no-print p-2"><IconButton title={`Edit ${v.plateNumber}`} onClick={() => open(v)}>Edit</IconButton></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={state.page} pageSize={state.limit} total={all.length} onPage={setPage} />
      </section>

      {editing && (
        <Modal title={editing === 'new' ? 'Add New Vehicle' : 'Edit Vehicle'} onClose={() => setEditing(null)}>
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate()
            }}
          >
            <Alert>{save.error && errorMessage(save.error)}</Alert>
            <Field label="Vehicle No. (ex. MP04AB7856) *" name="uv-number" maxLength={15} autoCapitalize="characters" value={form.vehicleNumber} onChange={(e) => setForm((f) => ({ ...f, vehicleNumber: e.target.value }))} />
            <Select label="Vehicle Type *" name="uv-type" value={form.vehicleType} onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))}>
              <option value="">--Select One--</option>
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="submit" loading={save.isPending} disabled={!form.vehicleNumber.trim() || !form.vehicleType}>{editing === 'new' ? 'Save' : 'Update'}</Button>
              <Button type="button" variant="danger" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
