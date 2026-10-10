import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passApi, passUserApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { PASS_STATE, VEHICLE_LABELS, dateOnly, lastDay, money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Badge, Button, Field, PageLoader, Select } from '../../components/ui'
import { ExportButtons, IconButton, IconLink, PageTitle, Pager, SearchBox, ShowEntries } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

const ADD_VEHICLE = 'add-new-vehicle'
const BLANK = { vehicleId: '', locationId: '', startDate: '', endDate: '', amount: '', method: 'CASH', transactionId: '' }

// Pass Management > Pass Users > Passes: "Manage User Passes". Create or renew a pass for one of the user's
// vehicles, then the list of this user's passes with Print Pass card and Delete Pass.
export default function PassUserPasses() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { locations, defaultId } = useMyLocations()
  const tableRef = useRef(null)
  const [values, setValues] = useState({ ...BLANK })
  const [state, patch, setPage] = useListState({ q: '' })
  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }))

  const user = useQuery({ queryKey: ['pass-user', id], queryFn: () => passUserApi.get(id) })
  const passes = useQuery({ queryKey: ['passes', { passUserId: id }], queryFn: () => passApi.list({ passUserId: id, limit: 200 }) })

  const refresh = () => {
    for (const key of ['passes', 'pass-users', 'pass-user-stats', 'pass-summary']) queryClient.invalidateQueries({ queryKey: [key] })
  }
  const save = useMutation({
    mutationFn: () => passUserApi.savePass(id, {
      vehicleId: values.vehicleId, locationId: values.locationId || defaultId,
      ...(values.startDate ? { startDate: values.startDate } : {}), endDate: values.endDate, amount: Number(values.amount),
      ...(Number(values.amount) > 0 ? { method: values.method, ...(values.transactionId.trim() ? { transactionId: values.transactionId.trim() } : {}) } : {}),
    }),
    onSuccess: () => {
      refresh()
      setValues({ ...BLANK })
    },
  })
  const remove = useMutation({ mutationFn: (pass) => passApi.remove(pass._id), onSuccess: refresh })
  const download = useMutation({ mutationFn: (format) => passApi.downloadList({ passUserId: id }, format) })

  if (user.isLoading) return <PageLoader />
  if (user.error) return <Alert>{errorMessage(user.error)}</Alert>
  const { user: holder, vehicles, company } = user.data
  const needle = state.q.trim().toLowerCase()
  const all = (passes.data?.passes || []).filter((p) => !needle || `${p.vehicleNumber} ${p.locationNames.join(' ')}`.toLowerCase().includes(needle))
  const rows = all.slice((state.page - 1) * state.limit, state.page * state.limit)
  const paid = Number(values.amount) > 0

  const submit = (event) => {
    event.preventDefault()
    if (!values.vehicleId || !values.endDate || values.amount === '') return
    save.mutate()
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Manage User Passes" back={PM + '/users'} />
      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-4">
        <p><span className="block text-xs text-slate-500">User Name</span><b>{holder.name}</b></p>
        <p><span className="block text-xs text-slate-500">Mobile</span><b>{holder.mobile || '—'}</b></p>
        <p><span className="block text-xs text-slate-500">Company Name</span><b>{company ? company.name : 'NA'}</b></p>
        <p><span className="block text-xs text-slate-500">Address</span><b>{holder.address || '—'}</b></p>
      </section>

      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" noValidate>
        <h2 className="text-lg font-semibold text-slate-900">Create / Renew Pass <span className="text-xs font-normal text-slate-500">(All * fields are required.)</span></h2>
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        <Alert type="success">{save.isSuccess && `${save.data.renewed ? 'Pass renewed' : 'Pass created'}: ${save.data.pass.passNumber}.`}</Alert>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            label="Vehicle No. *"
            name="up-vehicle"
            value={values.vehicleId}
            onChange={(event) => {
              if (event.target.value === ADD_VEHICLE) navigate(`${PM}/users/${id}/vehicles`)
              else setValues((v) => ({ ...v, vehicleId: event.target.value }))
            }}
          >
            <option value="">-Select One-</option>
            <option value={ADD_VEHICLE}>➕ Add New Vehicle</option>
            {vehicles.map((v) => <option key={v._id} value={v._id}>{v.plateNumber}</option>)}
          </Select>
          <Select label="Location Name *" name="up-location" value={values.locationId || defaultId} onChange={set('locationId')}>
            <option value="">-Select One-</option>
            {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
          </Select>
          <Field label="Valid From Date" name="up-from" type="date" value={values.startDate} onChange={set('startDate')} />
          <Field label="Valid To Date *" name="up-to" type="date" min={values.startDate || undefined} value={values.endDate} onChange={set('endDate')} />
          <Field label="Amount *" name="up-amount" type="number" min="0" value={values.amount} onChange={set('amount')} />
        </div>
        {paid && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select label="Money taken by" name="up-method" value={values.method} onChange={set('method')}>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
            </Select>
            {values.method !== 'CASH' && <Field label="Payment reference" name="up-ref" maxLength={100} value={values.transactionId} onChange={set('transactionId')} />}
          </div>
        )}
        <p className="text-xs text-slate-500">A vehicle that already has a pass is renewed: its dates and charge are replaced and the location is added.</p>
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending} disabled={!values.vehicleId || !values.endDate || values.amount === ''}>Save</Button>
          <Button type="reset" variant="secondary" onClick={() => setValues({ ...BLANK })}>Reset</Button>
        </div>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Passes List</h2>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} sizes={[25, 50, 100, 200]} />
          <SearchBox value={state.q} onChange={(q) => patch({ q })} />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <ExportButtons onDownload={(format) => download.mutate(format)} pending={download.isPending} disabled={all.length === 0} onPrint={() => printTable(tableRef.current, `Passes of ${holder.name}`)} />
        </div>
        <Alert>{remove.error ? errorMessage(remove.error) : passes.error ? errorMessage(passes.error) : download.error ? errorMessage(download.error) : ''}</Alert>
        <div className="overflow-x-auto">
          <table ref={tableRef} className="w-full min-w-[820px] border border-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{['SN', 'Vehicle No.', 'Vehicle Type', 'Location', 'Pass Card', 'Amount(₹)', 'Action'].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">{passes.isLoading ? 'Loading…' : 'No passes yet.'}</td></tr>}
              {rows.map((pass, i) => {
                const st = PASS_STATE[pass.state] || PASS_STATE.ACTIVE
                const where = pass.locationNames.length ? pass.locationNames.join(', ') : 'All locations'
                return (
                  <tr key={pass._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                    <td className="p-2">{(state.page - 1) * state.limit + i + 1}</td>
                    <td className="p-2 font-medium">{pass.vehicles.map((v) => v.number).join(', ')}</td>
                    <td className="p-2">{VEHICLE_LABELS[pass.vehicleType]}</td>
                    <td className="p-2">{where}</td>
                    <td className="p-2">
                      <Badge tone={st.tone}>{pass.approval === 'PENDING' ? 'Pending' : st.label}</Badge>
                      <span className="block text-xs text-slate-600">{where} ({pass.vehicleNumber})</span>
                      <span className="block text-xs text-slate-500">Valid From {dateOnly(pass.startDate)} · Valid To {lastDay(pass.endDate)}</span>
                    </td>
                    <td className="p-2">{money(pass.amount)}</td>
                    <td className="no-print whitespace-nowrap p-2">
                      <span className="flex gap-1">
                        <a className="inline-flex items-center rounded-md border border-blue-600 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50" href={`${PM}/print-cards?ids=${pass._id}`} target="_blank" rel="noreferrer" title="Print Pass card">Print</a>
                        <IconLink to={`/dashboard/passes/${pass._id}`} title="Open the pass" tone="outline">Open</IconLink>
                        <IconButton title="Delete Pass" tone="danger" disabled={remove.isPending} onClick={() => window.confirm(`Delete the pass for ${pass.vehicleNumber}?`) && remove.mutate(pass)}>Delete</IconButton>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pager page={state.page} pageSize={state.limit} total={all.length} onPage={setPage} />
        <p className="mt-2 text-xs text-slate-500">
          Delete works for a pass nobody has used at a gate and that took no money. Otherwise <Link className="underline" to="/dashboard/passes">cancel it from the pass page</Link>.
        </p>
      </section>
    </div>
  )
}
