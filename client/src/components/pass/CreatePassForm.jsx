import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { passCompanyApi, passUserApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, money } from '../../utils/format'
import { Alert, Button, Field, Select } from '../ui'
import CompanyModal from './CompanyModal'
import { PM } from './listState'

const ADD_COMPANY = 'add-new-company'
const blankRow = (locationId = '') => ({ vehicleNumber: '', vehicleType: '', locationId, startDate: '', endDate: '', amount: '' })
const BLANK_USER = { mobile: '', name: '', passCompanyId: '', address: '', email: '', gstNumber: '' }
const DAY = 86400000

// "₹ 500.00 / month" under the charges, worked out from the two dates.
const perMonth = (row) => {
  if (!row.startDate || !row.endDate || row.amount === '') return ''
  const days = Math.round((new Date(row.endDate) - new Date(row.startDate)) / DAY) + 1
  if (!(days >= 28) || !(Number(row.amount) > 0)) return ''
  return `${money((Number(row.amount) / days) * 30)} / month`
}

// The Create Pass form of the Pass Users page: a new user (or an existing one) and one row per vehicle
// (number, type, location, valid from and to, charges). Every row becomes a pass.
export default function CreatePassForm({ onClose }) {
  const queryClient = useQueryClient()
  const { locations, defaultId } = useMyLocations()
  const [mode, setMode] = useState('new')
  const [user, setUser] = useState(BLANK_USER)
  const [existingId, setExistingId] = useState('')
  const [rows, setRows] = useState([blankRow(defaultId)])
  const [method, setMethod] = useState('CASH')
  const [addingCompany, setAddingCompany] = useState(false)
  const [problem, setProblem] = useState('')

  const companies = useQuery({ queryKey: ['pass-companies', 'active'], queryFn: () => passCompanyApi.list({ active: 'true' }) })
  const options = useQuery({ queryKey: ['pass-user-options'], queryFn: passUserApi.options, enabled: mode === 'existing' })
  const setU = (key) => (event) => setUser((u) => ({ ...u, [key]: event.target.value }))
  const setRow = (index, patch) => setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const anyCharge = useMemo(() => rows.some((r) => Number(r.amount) > 0), [rows])

  const create = useMutation({
    mutationFn: () => passUserApi.create({
      ...(mode === 'existing' ? { passUserId: existingId } : {
        name: user.name.trim(), mobile: user.mobile.trim(), address: user.address.trim(),
        ...(user.email.trim() ? { email: user.email.trim() } : {}), ...(user.gstNumber.trim() ? { gstNumber: user.gstNumber.trim() } : {}),
        ...(user.passCompanyId ? { passCompanyId: user.passCompanyId } : {}),
      }),
      ...(anyCharge ? { method } : {}),
      rows: rows.map((r) => ({
        vehicleNumber: r.vehicleNumber.trim(), vehicleType: r.vehicleType, locationId: r.locationId,
        ...(r.startDate ? { startDate: r.startDate } : {}), endDate: r.endDate, amount: Number(r.amount),
      })),
    }),
    onSuccess: () => {
      for (const key of ['pass-users', 'pass-user-stats', 'pass-user-options', 'passes', 'pass-vehicle-list', 'pass-summary']) queryClient.invalidateQueries({ queryKey: [key] })
      setUser(BLANK_USER)
      setExistingId('')
      setRows([blankRow(defaultId)])
    },
  })

  const submit = (event) => {
    event.preventDefault()
    setProblem('')
    if (mode === 'existing' && !existingId) return setProblem('Choose the pass user.')
    if (mode === 'new' && !/^\d{10}$/.test(user.mobile.trim())) return setProblem('Mobile number must be exactly 10 digits.')
    if (mode === 'new' && (!user.name.trim() || !user.address.trim())) return setProblem('Enter the user name and the address.')
    const incomplete = rows.findIndex((r) => !r.vehicleNumber.trim() || !r.vehicleType || !r.locationId || !r.endDate || r.amount === '')
    if (incomplete >= 0) return setProblem(`Fill in every field of vehicle ${incomplete + 1}.`)
    if (rows.some((r) => r.startDate && r.startDate > r.endDate)) return setProblem('A pass cannot end before it starts.')
    create.mutate()
  }

  const result = create.data
  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" noValidate>
      <div className="flex flex-wrap items-center gap-6">
        <h2 className="text-lg font-semibold text-slate-900">Create Pass</h2>
        {[['new', 'New User'], ['existing', 'Existing User']].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="pass_user_type" value={value} checked={mode === value} onChange={() => setMode(value)} />
            {label}
          </label>
        ))}
      </div>

      <Alert>{problem || (create.error && errorMessage(create.error))}</Alert>
      {result && (
        <Alert type={result.failed ? 'info' : 'success'}>
          {result.created} pass{result.created === 1 ? '' : 'es'} created for {result.user.name}.
          {result.results.filter((r) => !r.ok).map((r) => ` ${r.vehicleNumber}: ${r.error}`).join('')}{' '}
          <Link className="font-semibold underline" to={`${PM}/users/${result.user._id}/passes`}>Open their passes</Link>
        </Alert>
      )}

      {mode === 'new' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Mobile No. *" name="pu-mobile" inputMode="numeric" maxLength={10} value={user.mobile} onChange={(e) => setUser((u) => ({ ...u, mobile: e.target.value.replace(/\D/g, '') }))} />
          <Field label="User Name *" name="pu-name" maxLength={100} value={user.name} onChange={setU('name')} />
          <Select
            label="Company Name"
            name="pu-company"
            value={user.passCompanyId}
            onChange={(e) => (e.target.value === ADD_COMPANY ? setAddingCompany(true) : setUser((u) => ({ ...u, passCompanyId: e.target.value })))}
          >
            <option value="">Select One/No Company</option>
            <option value={ADD_COMPANY}>➕ Add New Company</option>
            {(companies.data?.companies || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
          <Field label="Address *" name="pu-address" maxLength={200} value={user.address} onChange={setU('address')} />
          <Field label="Email ID (Optional)" name="pu-email" type="email" maxLength={100} value={user.email} onChange={setU('email')} />
          <Field label="GST No. (Optional)" name="pu-gst" maxLength={15} autoCapitalize="characters" placeholder="22ABCDE1234F1Z5" value={user.gstNumber} onChange={(e) => setUser((u) => ({ ...u, gstNumber: e.target.value.toUpperCase() }))} />
        </div>
      ) : (
        <Select label="Existing User List" name="pu-existing" className="max-w-xl" value={existingId} onChange={(e) => setExistingId(e.target.value)}>
          <option value="">Select One</option>
          {(options.data?.users || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.mobile || 'no mobile'})</option>)}
        </Select>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border border-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="w-8 p-2">#</th>
              <th className="p-2">Vehicle No. (ex. MP04AB7856) *</th>
              <th className="p-2">Vehicle Type *</th>
              <th className="p-2">Location *</th>
              <th className="p-2">Validity From Date</th>
              <th className="p-2">Validity To Date *</th>
              <th className="bg-sky-600 p-2 text-white">Pass Charges (₹) *</th>
              <th className="w-24 p-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-slate-200 align-top">
                <td className="p-2">{index + 1}</td>
                <td className="p-2"><input aria-label={`Vehicle ${index + 1} number`} className="w-full rounded-md border border-slate-300 px-2 py-1.5 uppercase" maxLength={15} value={row.vehicleNumber} onChange={(e) => setRow(index, { vehicleNumber: e.target.value })} /></td>
                <td className="p-2">
                  <select aria-label={`Vehicle ${index + 1} type`} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5" value={row.vehicleType} onChange={(e) => setRow(index, { vehicleType: e.target.value })}>
                    <option value="">--Select One--</option>
                    {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <select aria-label={`Vehicle ${index + 1} location`} className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5" value={row.locationId} onChange={(e) => setRow(index, { locationId: e.target.value })}>
                    <option value="">-Select One-</option>
                    {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
                  </select>
                </td>
                <td className="p-2"><input aria-label={`Vehicle ${index + 1} valid from`} type="date" className="w-full rounded-md border border-slate-300 px-2 py-1.5" value={row.startDate} onChange={(e) => setRow(index, { startDate: e.target.value })} /></td>
                <td className="p-2"><input aria-label={`Vehicle ${index + 1} valid to`} type="date" className="w-full rounded-md border border-slate-300 px-2 py-1.5" min={row.startDate || undefined} value={row.endDate} onChange={(e) => setRow(index, { endDate: e.target.value })} /></td>
                <td className="p-2">
                  <input aria-label={`Vehicle ${index + 1} charges`} type="number" min="0" className="w-full rounded-md border border-slate-300 px-2 py-1.5" value={row.amount} onChange={(e) => setRow(index, { amount: e.target.value })} />
                  <span className="text-xs text-slate-500">{perMonth(row)}</span>
                </td>
                <td className="p-2 text-center">
                  {index === rows.length - 1 && rows.length < 20 && (
                    <button type="button" title="Add another vehicle" aria-label="Add another vehicle" className="mr-1 rounded-md bg-emerald-600 px-2.5 py-1 text-white" onClick={() => setRows((l) => [...l, blankRow(defaultId)])}>+</button>
                  )}
                  {rows.length > 1 && (
                    <button type="button" title="Remove this vehicle" aria-label={`Remove vehicle ${index + 1}`} className="rounded-md bg-red-600 px-2.5 py-1 text-white" onClick={() => setRows((l) => l.filter((_, i) => i !== index))}>−</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {anyCharge && (
        <Select label="Money taken by" name="pu-method" className="max-w-xs" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card</option>
        </Select>
      )}

      {anyCharge && <p className="-mt-2 text-xs text-slate-500">The money is recorded in your open shift at each pass&apos;s location. A charge of 0 makes a free pass.</p>}

      <div className="flex justify-center gap-2">
        <Button type="submit" loading={create.isPending}>Create Pass</Button>
        <Button type="button" variant="danger" onClick={onClose}>Cancel</Button>
      </div>

      {addingCompany && (
        <CompanyModal
          onClose={() => setAddingCompany(false)}
          onSaved={(company) => setUser((u) => ({ ...u, passCompanyId: company._id }))}
        />
      )}
    </form>
  )
}
