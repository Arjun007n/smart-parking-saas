import { useDeferredValue, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passApi, passCompanyApi, passUserApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, dateOnly, lastDay, money } from '../../utils/format'
import printTable from '../../utils/printTable'
import { Alert, Button, Field, PageLoader } from '../../components/ui'
import { ExportButtons, Modal, PageTitle, Pager, SearchBox, ShowEntries, Toolbar } from '../../components/pass/ListKit'
import { PM, useListState } from '../../components/pass/listState'

const FILTER = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2'

// The Update Pass window: a new last day and charge (and, if wanted, a new first day) for the ticked passes.
function UpdatePassModal({ ids, onClose, onDone }) {
  const [form, setForm] = useState({ startDate: '', endDate: '', amount: '' })
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))
  const update = useMutation({
    mutationFn: () => passApi.bulk({
      ids, action: 'UPDATE_TERM', ...(form.startDate ? { startDate: form.startDate } : {}), endDate: form.endDate, amount: Number(form.amount),
    }),
    onSuccess: onDone,
  })
  const skipped = update.data?.skipped || []
  return (
    <Modal title={`Pass Update (${ids.length})`} onClose={onClose}>
      <form
        className="space-y-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          update.mutate()
        }}
      >
        <Alert>{update.error && errorMessage(update.error)}</Alert>
        {update.isSuccess && (
          <Alert type={skipped.length ? 'info' : 'success'}>
            {update.data.changed} pass{update.data.changed === 1 ? '' : 'es'} updated.{skipped.map((s) => ` ${s.passNumber || 'A pass'}: ${s.reason}.`).join('')}
          </Alert>
        )}
        <Field label="Valid From" name="up-start" type="date" value={form.startDate} onChange={set('startDate')} hint="Leave empty to keep each pass's first day." />
        <Field label="valid Upto *" name="up-end" type="date" min={form.startDate || undefined} value={form.endDate} onChange={set('endDate')} />
        <Field label="Amount *" name="up-amount" type="number" min="0" value={form.amount} onChange={set('amount')} />
        <p className="text-xs text-slate-500">This changes the dates and the charge shown on the passes. It does not take money: use Create / Renew Pass on the user&apos;s page for a paid renewal.</p>
        <div className="flex justify-end gap-2">
          <Button type="submit" loading={update.isPending} disabled={update.isSuccess || !form.endDate || form.amount === ''}>Update</Button>
          <Button type="button" variant="danger" onClick={onClose}>{update.isSuccess ? 'Close' : 'Cancel'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// Pass Management > Passes List: every pass with its approval, filters, tick boxes and the Create / Print /
// Update / Bulk upload / Delete / Excel buttons of ismartparking.com.
export default function PassesList() {
  const queryClient = useQueryClient()
  const { locations } = useMyLocations()
  const tableRef = useRef(null)
  const [params] = useSearchParams()
  const [state, patch, setPage] = useListState({ limit: 25, locationId: '', passCompanyId: params.get('company') || '', passUserId: '', vehicleNumber: '', vehicleType: '', approval: '', q: '' })
  const [chosen, setChosen] = useState([])
  const [updating, setUpdating] = useState(false)
  const q = useDeferredValue(state.q.trim())

  const companies = useQuery({ queryKey: ['pass-companies', ''], queryFn: () => passCompanyApi.list({}) })
  const users = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options })
  const query = {
    ...(state.locationId ? { locationId: state.locationId } : {}), ...(state.passCompanyId ? { passCompanyId: state.passCompanyId } : {}),
    ...(state.passUserId ? { passUserId: state.passUserId } : {}), ...(state.vehicleNumber.trim() ? { vehicleNumber: state.vehicleNumber.trim() } : {}),
    ...(state.vehicleType ? { vehicleType: state.vehicleType } : {}), ...(state.approval ? { approval: state.approval } : {}), ...(q ? { q } : {}),
    limit: state.limit, page: state.page,
  }
  const list = useQuery({ queryKey: ['passes', query], queryFn: () => passApi.list(query), placeholderData: keepPreviousData })
  const refresh = () => {
    for (const key of ['passes', 'pass-users', 'pass-user-stats', 'pass-summary']) queryClient.invalidateQueries({ queryKey: [key] })
  }
  const approve = useMutation({
    mutationFn: (pass) => passApi.setApproval(pass._id, pass.approval === 'APPROVED' ? 'PENDING' : 'APPROVED'),
    onSuccess: refresh,
  })
  const removeMany = useMutation({
    mutationFn: () => passApi.removeMany(chosen),
    onSuccess: () => {
      refresh()
      setChosen([])
    },
  })
  const download = useMutation({ mutationFn: (format) => passApi.downloadList({ ...query, page: undefined, limit: undefined }, format) })

  const data = list.data
  const rows = data ? data.passes : []
  const allChosen = rows.length > 0 && rows.every((p) => chosen.includes(p._id))
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const toggleAll = () => setChosen((c) => (allChosen ? c.filter((id) => !rows.some((p) => p._id === id)) : [...new Set([...c, ...rows.map((p) => p._id)])]))
  const need = (what) => window.alert(`Please select at least one pass to ${what}.`)
  const askApprove = (pass) => {
    const word = pass.approval === 'APPROVED' ? 'cancel the approved pass for' : 'approve the pass for'
    if (window.confirm(`Are you sure you want to ${word} vehicle ( ${pass.vehicleNumber} )?`)) approve.mutate(pass)
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Pass List">
        <Link to="/dashboard/passes" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Shared pass (several vehicles)</Link>
      </PageTitle>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-medium text-slate-700">Location Name
            <select className={FILTER} value={state.locationId} onChange={(e) => patch({ locationId: e.target.value })}>
              <option value="">All Location</option>
              {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Company Name
            <select className={FILTER} value={state.passCompanyId} onChange={(e) => patch({ passCompanyId: e.target.value })}>
              <option value="">All Company</option>
              {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">User Name / Mobile
            <select className={FILTER} value={state.passUserId} onChange={(e) => patch({ passUserId: e.target.value })}>
              <option value="">All Pass User</option>
              {(users.data?.users || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.mobile || '—'})</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Vehicle No.
            <input className={FILTER} value={state.vehicleNumber} maxLength={15} autoCapitalize="characters" placeholder="All Vehicle No." onChange={(e) => patch({ vehicleNumber: e.target.value })} />
          </label>
          <label className="text-sm font-medium text-slate-700">Vehicle Type
            <select className={FILTER} value={state.vehicleType} onChange={(e) => patch({ vehicleType: e.target.value })}>
              <option value="">Select</option>
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <ShowEntries value={state.limit} onChange={(limit) => patch({ limit })} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">Status
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" value={state.approval} onChange={(e) => patch({ approval: e.target.value })}>
                <option value="">All</option>
                <option value="APPROVED">Approved</option>
                <option value="PENDING">Pending</option>
              </select>
            </label>
            <SearchBox value={state.q} onChange={(value) => patch({ q: value })} />
          </div>
        </div>

        <Toolbar>
          <Link to={`${PM}/users?create=1`} className="rounded-lg bg-[#28a745] px-4 py-2 text-sm font-semibold text-white hover:bg-[#218838]">Create Pass</Link>
          <Button type="button" variant="info" onClick={() => (chosen.length ? window.open(`${PM}/print-cards?ids=${chosen.join(',')}`, '_blank') : need('print'))}>Print Pass</Button>
          <Button type="button" onClick={() => (chosen.length ? setUpdating(true) : need('update'))}>Update Pass</Button>
          <Link to={`${PM}/bulk-upload`} className="rounded-lg bg-[#28a745] px-4 py-2 text-sm font-semibold text-white hover:bg-[#218838]">Bulk Pass Upload</Link>
          <Button
            type="button"
            variant="danger"
            loading={removeMany.isPending}
            onClick={() => {
              if (!chosen.length) return need('delete')
              if (window.confirm(`Are you sure you want to delete ${chosen.length} selected ${chosen.length === 1 ? 'pass' : 'passes'}?`)) removeMany.mutate()
            }}
          >
            Delete Pass
          </Button>
          <ExportButtons onDownload={(format) => download.mutate(format)} pending={download.isPending} disabled={!data || rows.length === 0} onPrint={() => printTable(tableRef.current, 'Pass List')} />
        </Toolbar>

        <Alert>{list.error ? errorMessage(list.error) : approve.error ? errorMessage(approve.error) : removeMany.error ? errorMessage(removeMany.error) : download.error ? errorMessage(download.error) : ''}</Alert>
        {removeMany.isSuccess && removeMany.data && (
          <Alert type={removeMany.data.skipped.length ? 'info' : 'success'}>
            {removeMany.data.deleted} deleted.{removeMany.data.skipped.map((s) => ` ${s.vehicleNumber || s.passNumber}: ${s.reason}`).join('')}
          </Alert>
        )}

        {list.isLoading ? (
          <PageLoader />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table ref={tableRef} className="w-full min-w-[1100px] border border-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="no-print p-2"><input type="checkbox" className="h-4 w-4" aria-label="Choose all passes on this page" checked={allChosen} onChange={toggleAll} /></th>
                    {['SNo', 'User Name', 'Mobile', 'Email', 'Vehicle No.', 'Vehicle Type', 'Location', 'Company', 'Start Month', 'Expiry Month', 'Amount', 'Status'].map((h) => <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={13} className="p-4 text-center text-slate-500">No passes found.</td></tr>}
                  {rows.map((pass, i) => {
                    const ended = new Date(pass.endDate) <= new Date() || pass.state === 'EXPIRED'
                    return (
                      <tr key={pass._id} className="border-t border-slate-200 odd:bg-slate-50/60">
                        <td className="no-print p-2"><input type="checkbox" className="h-4 w-4" aria-label={`Choose pass ${pass.passNumber}`} checked={chosen.includes(pass._id)} onChange={() => toggle(pass._id)} /></td>
                        <td className="p-2">{(data.page - 1) * data.pageSize + i + 1}</td>
                        <td className="p-2 font-medium text-slate-900"><Link className="hover:underline" to={`/dashboard/passes/${pass._id}`}>{pass.holderName}</Link></td>
                        <td className="p-2">{pass.phone}</td>
                        <td className="p-2">{pass.email}</td>
                        <td className="p-2">{pass.vehicles.map((v) => v.number).join(', ')}</td>
                        <td className="p-2">{VEHICLE_LABELS[pass.vehicleType]}</td>
                        <td className="p-2">{pass.locationNames.length ? pass.locationNames.join(', ') : 'All locations'}</td>
                        <td className="p-2">{pass.company || 'N/A'}</td>
                        <td className="whitespace-nowrap p-2">{dateOnly(pass.startDate)}</td>
                        <td className={`whitespace-nowrap p-2 ${ended ? 'text-red-600' : ''}`}>{lastDay(pass.endDate)}</td>
                        <td className="p-2">{money(pass.amount)}</td>
                        <td className="p-2">
                          {pass.status === 'CANCELLED' ? (
                            <span className="text-slate-500">Cancelled</span>
                          ) : (
                            <button type="button" className="font-bold text-blue-700 hover:underline" title="Click to approve or hold this pass" disabled={approve.isPending} onClick={() => askApprove(pass)}>
                              {pass.approval === 'APPROVED' ? 'Approved' : 'Pending'}
                            </button>
                          )}
                          {pass.state === 'SUSPENDED' && <span className="block text-xs text-red-600">Suspended</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>

      {updating && (
        <UpdatePassModal
          ids={chosen}
          onClose={() => {
            setUpdating(false)
            setChosen([])
          }}
          onDone={refresh}
        />
      )}
    </div>
  )
}
