import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi, roleApi, userApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { userEditSchema, userSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { dateOnly, operatorPayload } from '../../utils/format'
import printTable from '../../utils/printTable'
import { LEGACY_OPERATOR_ROLES, ROLE_HINTS, ROLE_LABELS, assignableRoles, roleChoiceOf, roleChoicePayload, roleLabel } from '../../utils/roles'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select } from '../../components/ui'

// The role of a government officer (reports only).
const OFFICER = 'GOVERNMENT_OFFICER'
// Gate staff work one lane at a location that has lanes.
const GATE_STAFF = ['GATE_OPERATOR', 'ENTRY_OPERATOR', 'EXIT_OPERATOR']

const DEFAULTS = {
  name: '', email: '', loginId: '', phone: '', password: '', role: '', locationIds: [], lanes: [],
  employeeCode: '', shiftName: '', shiftStart: '', shiftEnd: '',
  reprint: 'YES', showEntry: 'YES', showExit: 'YES', showTotal: 'YES',
}

const yesNo = (value) => (value === false ? 'NO' : 'YES')
// What the API takes for the four yes / no choices of the form.
const accessPayload = ({ reprint, showEntry, showExit, showTotal }) => ({
  access: {
    reprint: reprint !== 'NO',
    showEntryCollection: showEntry !== 'NO',
    showExitCollection: showExit !== 'NO',
    showTotalCollection: showTotal !== 'NO',
  },
})

// What a person may do at the gate: four yes / no choices. Not set means yes.
function AccessFields({ register }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">At the gate</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Reprint allowed" {...register('reprint')}>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </Select>
        <Select label="Show entry collection" {...register('showEntry')}>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </Select>
        <Select label="Show exit collection" {...register('showExit')}>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </Select>
        <Select label="Show total collection" {...register('showTotal')}>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </Select>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Reprint: printing a ticket or receipt again. Entry collection: money taken at entry. Exit collection: money taken at exit.
        Total collection: the total and the ways of paying. What is switched off is not shown on that person&apos;s screens.
      </p>
    </fieldset>
  )
}

function useRefreshUsers() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['users'] })
    queryClient.invalidateQueries({ queryKey: ['licences'] })
    queryClient.invalidateQueries({ queryKey: ['roles'] })
    queryClient.invalidateQueries({ queryKey: ['onboarding'] })
  }
}

const laneKey = (locationId, gate) => `${locationId}|${gate}`
const asList = (value) => [].concat(value || []).filter(Boolean)

// Lanes: tie the user to particular lanes (Car-Entry, Bike-Exit ...) of the locations they work at. A gate
// operator at a location with lanes needs at least one lane (tick both the entry and the exit lane to work
// both), and a lane has one operator. For anyone else, nothing ticked at a location means every lane of it.
function LanePicker({ locations, selected, lanes, onChange, role }) {
  const chosen = asList(selected)
  const withLanes = locations.filter((l) => chosen.includes(l._id) && (l.gates || []).length > 0)
  if (!withLanes.length) return null
  const toggle = (key) => onChange(lanes.includes(key) ? lanes.filter((k) => k !== key) : [...lanes, key])
  const staff = GATE_STAFF.includes(role)
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-slate-700">Lanes{staff ? '' : ' (optional)'}</legend>
      <p className="mb-2 text-xs text-slate-500">
        {staff
          ? 'A gate operator works the lanes ticked here: tick the entry lane and the exit lane to handle both. A lane has one operator.'
          : 'Tick the lanes this person works. If nothing is ticked at a location, they can use all of its lanes.'}
      </p>
      <div className="space-y-2">
        {withLanes.map((location) => (
          <div key={location._id} className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="w-40 text-sm font-medium text-slate-600">{location.name}</span>
            {location.gates.map((gate) => {
              const key = laneKey(location._id, gate.name)
              return (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="h-4 w-4" checked={lanes.includes(key)} onChange={() => toggle(key)} />
                  {gate.name}
                  <span className="text-xs text-slate-500">{gate.doorNo || (gate.type === 'BOTH' ? 'entry + exit' : gate.type.toLowerCase())}</span>
                </label>
              )
            })}
          </div>
        ))}
      </div>
    </fieldset>
  )
}

// What the API takes for the lanes ticked in the form ("locationId|gate" strings).
const lanesPayload = (lanes) =>
  asList(lanes).map((key) => {
    const at = key.indexOf('|')
    return { locationId: key.slice(0, at), gate: key.slice(at + 1) }
  })

// Role, locations, lanes and shift inputs shared by the add and edit forms.
function AssignmentFields({ register, errors, watch, setValue, roles, customRoles, locations }) {
  const role = watch('role')
  const hint = ROLE_HINTS[role]
  // A government officer sees reports only: no lanes, shift or gate switches.
  const isOfficer = role === 'GOVERNMENT_OFFICER'
  // Someone who still has an older entry-only or exit-only role keeps it in the list so the form can show it.
  const choices = LEGACY_OPERATOR_ROLES.includes(role) && !roles.includes(role) ? [...roles, role] : roles
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Select label="Role" error={errors.role?.message} {...register('role')}>
            <option value="">Choose a role</option>
            <optgroup label="Standard roles">
              {choices.map((r) => (
                <option key={r} value={r}>{LEGACY_OPERATOR_ROLES.includes(r) ? `${ROLE_LABELS[r]} (older role)` : ROLE_LABELS[r]}</option>
              ))}
            </optgroup>
            {customRoles.length > 0 && (
              <optgroup label="Your company's roles">
                {customRoles.map((r) => (
                  <option key={r._id} value={`custom:${r._id}`}>{r.name}</option>
                ))}
              </optgroup>
            )}
          </Select>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {!isOfficer && <Field label="Employee code (optional)" error={errors.employeeCode?.message} {...register('employeeCode')} />}
      </div>
      {isOfficer && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
          A government officer signs in on the <strong>Government login page</strong> ({`${window.location.origin}/government/login`}) with the company code and this
          Login ID, and sees only the entry and exit totals and lists of the locations ticked below. No money, no other screens. Choose at least one location.
          Officers use no user licence.
        </p>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Location</legend>
        {locations.length === 0 ? (
          <p className="text-sm text-slate-500">Create a parking location first to assign it here.</p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {locations.map((location) => (
              <Checkbox key={location._id} label={location.name} value={location._id} {...register('locationIds')} />
            ))}
          </div>
        )}
      </fieldset>

      {!isOfficer && (
        <>
          <LanePicker
            locations={locations}
            selected={watch('locationIds')}
            lanes={asList(watch('lanes'))}
            onChange={(next) => setValue('lanes', next, { shouldDirty: true })}
            role={role}
          />

          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium text-slate-700">Shift (optional)</legend>
            <Field label="Shift name" placeholder="Morning" error={errors.shiftName?.message} {...register('shiftName')} />
            <Field label="Starts" type="time" error={errors.shiftStart?.message} {...register('shiftStart')} />
            <Field label="Ends" type="time" error={errors.shiftEnd?.message} {...register('shiftEnd')} />
          </fieldset>
        </>
      )}
    </>
  )
}

// How many seats the chosen locations have left, for the line under the location choice.
function SeatLine({ locationIds, locations }) {
  const licences = useQuery({ queryKey: ['licences'], queryFn: userApi.licences })
  const chosen = asList(locationIds)
  const rows = (licences.data?.locations || []).filter((row) => chosen.includes(row.locationId))
  if (!chosen.length || !rows.length) return null
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-[#1e3d73]">User licence:</span>{' '}
      {rows.map((row) => `${locations.find((l) => l._id === row.locationId)?.name || row.name}: ${row.used} / ${row.limit === null ? 'no limit' : row.limit} used`).join(' · ')}
    </p>
  )
}

function CreateUserForm({ roles, customRoles, locations, onCreated }) {
  const refresh = useRefreshUsers()
  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(userSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ name, email, loginId, phone, password, role, locationIds, lanes, reprint, showEntry, showExit, showTotal, ...profile }) =>
      userApi.create({
        name, password, locationIds: asList(locationIds),
        ...(email ? { email } : {}),
        ...(loginId ? { loginId } : {}),
        ...roleChoicePayload(role),
        ...(phone ? { phone } : {}),
        // An officer only needs the locations: no lanes, shift or gate switches.
        ...(role === OFFICER ? {} : {
          ...(asList(lanes).length ? { lanes: lanesPayload(lanes) } : {}),
          ...accessPayload({ reprint, showEntry, showExit, showTotal }),
          ...operatorPayload(profile),
        }),
      }),
    onSuccess: (created) => {
      refresh()
      reset(DEFAULTS)
      onCreated(created)
    },
  })

  const watchedLocations = useWatch({ control, name: 'locationIds' })
  const watchedRole = useWatch({ control, name: 'role' })

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-4" noValidate>
      <Alert>{create.error && errorMessage(create.error)}</Alert>
      <AssignmentFields register={register} errors={errors} watch={watch} setValue={setValue} roles={roles} customRoles={customRoles} locations={locations} />
      {watchedRole !== OFFICER && <SeatLine locationIds={watchedLocations} locations={locations} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name *" error={errors.name?.message} {...register('name')} />
        <Field label="Mobile" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Field label="Email ID (optional)" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
        <Field
          label="Login ID *"
          autoComplete="off"
          autoCapitalize="none"
          hint="They sign in with the company code and this ID. An email is optional."
          error={errors.loginId?.message}
          {...register('loginId')}
        />
        <Field
          label="Login password *"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters. Share it with the user privately."
          error={errors.password?.message}
          {...register('password')}
        />
      </div>
      {watchedRole !== OFFICER && <AccessFields register={register} />}
      <div className="flex gap-2">
        <Button type="submit" variant="success" loading={create.isPending}>Create New User</Button>
        <Button type="button" variant="danger" onClick={() => reset(DEFAULTS)}>Reset</Button>
      </div>
    </form>
  )
}

// Changing a password is its own small form, as on the other admin panels.
function PasswordForm({ user }) {
  const refresh = useRefreshUsers()
  const [values, setValues] = useState({ password: '', confirm: '' })
  const [problem, setProblem] = useState('')
  const save = useMutation({
    mutationFn: () => userApi.update(user._id, { password: values.password }),
    onSuccess: () => {
      refresh()
      setValues({ password: '', confirm: '' })
    },
  })
  const submit = (event) => {
    event.preventDefault()
    if (values.password.length < 8) return setProblem('A password has at least 8 characters.')
    if (values.password !== values.confirm) return setProblem('The two passwords are not the same.')
    setProblem('')
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <h3 className="font-semibold text-[#1e3d73]">Change password</h3>
      <Alert>{problem || (save.error && errorMessage(save.error))}</Alert>
      <Alert type="success">{save.isSuccess && 'Password updated. The user is signed out everywhere.'}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password *" type="password" autoComplete="new-password" value={values.password} onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))} />
        <Field label="Confirm new password *" type="password" autoComplete="new-password" value={values.confirm} onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>Update Password</Button>
        <Button type="button" variant="danger" onClick={() => { setValues({ password: '', confirm: '' }); setProblem('') }}>Reset</Button>
      </div>
    </form>
  )
}

function EditUserForm({ user, roles, customRoles, locations, onClose }) {
  const refresh = useRefreshUsers()
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(userEditSchema),
    defaultValues: {
      loginId: user.loginId || '',
      lanes: (user.lanes || []).map((l) => laneKey(l.locationId, l.gate)),
      name: user.name,
      phone: user.phone || '',
      role: roleChoiceOf(user),
      locationIds: user.locationIds,
      employeeCode: user.operator?.employeeCode || '',
      shiftName: user.operator?.shift?.name || '',
      shiftStart: user.operator?.shift?.start || '',
      shiftEnd: user.operator?.shift?.end || '',
      reprint: yesNo(user.access?.reprint),
      showEntry: yesNo(user.access?.showEntryCollection),
      showExit: yesNo(user.access?.showExitCollection),
      showTotal: yesNo(user.access?.showTotalCollection),
    },
  })

  const watchedRole = useWatch({ control, name: 'role' })

  const save = useMutation({
    mutationFn: ({ name, phone, role, locationIds, loginId, lanes, reprint, showEntry, showExit, showTotal, ...profile }) =>
      userApi.update(user._id, {
        name, phone, locationIds: asList(locationIds),
        lanes: role === OFFICER ? [] : lanesPayload(lanes),
        ...(loginId && loginId !== user.loginId ? { loginId } : {}),
        // Only send the role when it was changed: the person editing may not
        // be allowed to hand out the role the user already has.
        ...(role !== roleChoiceOf(user) ? roleChoicePayload(role) : {}),
        ...(role === OFFICER ? {} : { ...accessPayload({ reprint, showEntry, showExit, showTotal }), ...operatorPayload(profile) }),
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl text-slate-900">User Edit: {user.loginId || user.email}</h2>
        <Button type="button" variant="secondary" onClick={onClose}>Back</Button>
      </div>
      <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
        <Alert>{save.error && errorMessage(save.error)}</Alert>
        <AssignmentFields register={register} errors={errors} watch={watch} setValue={setValue} roles={roles} customRoles={customRoles} locations={locations} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name *" error={errors.name?.message} {...register('name')} />
          <Field label="Mobile" type="tel" error={errors.phone?.message} {...register('phone')} />
          <Field label="Login ID *" autoCapitalize="none" error={errors.loginId?.message} {...register('loginId')} />
          {user.email && <Field label="Email ID" value={user.email} readOnly disabled />}
        </div>
        {watchedRole !== OFFICER && <AccessFields register={register} />}
        <div className="flex gap-2">
          <Button type="submit" loading={save.isPending}>Update Profile</Button>
          <Button type="button" variant="danger" onClick={() => reset()}>Reset</Button>
        </div>
      </form>
      <hr className="border-slate-200" />
      <PasswordForm user={user} />
    </div>
  )
}

const GATE_USE = { ENTRY: 'Entry', EXIT: 'Exit', BOTH: 'Entry + Exit' }

// "1. Gate 1 (Entry)" lines for the Lane/Door column. No lanes ticked = every lane of the locations.
const laneLines = (user, locations) =>
  (user.lanes || []).map((lane, i) => {
    const gate = (locations.find((l) => l._id === lane.locationId)?.gates || []).find((g) => g.name === lane.gate)
    return `${i + 1}. ${lane.gate}${gate ? ` (${gate.doorNo || GATE_USE[gate.type] || gate.type})` : ''}`
  })

function UserRow({ user, index, locationNames, locations, onEdit }) {
  const refresh = useRefreshUsers()
  const toggle = useMutation({
    mutationFn: () => userApi.update(user._id, { isActive: !user.isActive }),
    onSuccess: refresh,
  })
  const lines = laneLines(user, locations)

  return (
    <tr className="align-top">
      <td>{index}</td>
      <td className="font-medium text-slate-900">{user.name}</td>
      <td>{roleLabel(user)}</td>
      <td className="font-mono text-xs">{user.loginId || '—'}</td>
      <td>{user.phone || ''}</td>
      <td>{user.email || ''}</td>
      <td>{user.locationIds.map((id) => locationNames[id]).filter(Boolean).join(', ') || '—'}</td>
      <td className="text-xs">{lines.length ? lines.map((line) => <span key={line} className="block">{line}</span>) : <span className="text-slate-500">All lanes</span>}</td>
      <td>
        <button
          type="button"
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          title={user.isActive ? 'Click to deactivate' : 'Click to activate'}
          className={`rounded px-2.5 py-1 text-xs font-semibold text-white ${user.isActive ? 'bg-[#28a745] hover:bg-[#218838]' : 'bg-[#dc3545] hover:bg-[#bb2d3b]'}`}
        >
          {user.isActive ? 'Active' : 'Inactive'}
        </button>
        {toggle.error && <p className="mt-1 max-w-40 text-xs text-red-600">{errorMessage(toggle.error)}</p>}
      </td>
      <td className="print:hidden">
        <button type="button" onClick={onEdit} className="rounded border border-blue-600 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          Edit
        </button>
      </td>
    </tr>
  )
}

// The company code staff type at sign-in together with their Login ID.
function CompanyCode({ code }) {
  const [copied, setCopied] = useState(false)
  if (!code) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Copying can be blocked; the code is on screen to read out instead.
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900 ring-1 ring-blue-100">
      <span>
        Company code <strong className="ml-1 rounded bg-white px-2 py-0.5 font-mono text-base tracking-widest">{code}</strong>
      </span>
      <button type="button" onClick={copy} className="font-semibold text-blue-700 hover:underline">
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="text-blue-800">Everyone, admins included, signs in on the login page with this code and their Login ID or email.</span>
    </div>
  )
}

// One location's seats: used of limit, and the company admin can change the limit.
function LicenceRow({ row, editable }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(row.limit === null ? '' : String(row.limit))
  const save = useMutation({
    mutationFn: (limit) => userApi.setLicence(row.locationId, limit),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['licences'] }),
  })
  const parsed = value.trim() === '' ? null : Number(value)
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0)
  const changed = parsed !== row.limit
  const full = row.limit !== null && row.used >= row.limit

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="py-3 pr-4 font-medium text-slate-900">{row.name}</td>
      <td className="py-3 pr-4">
        {row.used} of {row.limit === null ? 'no limit' : row.limit}
        {full && <span className="ml-2"><Badge tone="amber">Full</Badge></span>}
      </td>
      <td className="py-3 pr-4 text-slate-600">{row.left === null ? '—' : row.left}</td>
      {editable && (
        <td className="py-3 text-right">
          <div className="flex justify-end gap-2">
            <input
              aria-label={`Seats for ${row.name}`}
              inputMode="numeric"
              placeholder="No limit"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <Button variant="secondary" disabled={!changed || invalid} loading={save.isPending} onClick={() => save.mutate(parsed)}>
              Save
            </Button>
          </div>
          {save.error && <p className="mt-1 text-sm text-red-600">{errorMessage(save.error)}</p>}
        </td>
      )}
    </tr>
  )
}

// Licences: how the plan's users are shared out between locations.
function Licences({ editable }) {
  const licences = useQuery({ queryKey: ['licences'], queryFn: userApi.licences })
  const data = licences.data
  if (licences.isLoading || !data || !data.locations.length) return null
  return (
    <Card
      title="User licences"
      action={
        editable && (
          <Link to="/dashboard/subscriptions" className="text-sm font-semibold text-blue-700 hover:underline">
            Buy or renew users
          </Link>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {editable && <>Your plan includes <strong>{data.planUsers}</strong> users; {data.allotted} are shared out to locations below. </>}
        {data.validUpto && (
          <>
            Licences run until <strong>{dateOnly(data.validUpto)}</strong>
            {data.expired && <span className="ml-2"><Badge tone="red">Expired</Badge></span>}.
          </>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-2 pr-4 font-medium">Location</th>
              <th className="pb-2 pr-4 font-medium">Users in use</th>
              <th className="pb-2 pr-4 font-medium">Left</th>
              {editable && <th className="pb-2 text-right font-medium">Set limit</th>}
            </tr>
          </thead>
          <tbody>
            {data.locations.map((row) => (
              <LicenceRow key={`${row.locationId}-${row.limit}`} row={row} editable={editable} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const PAGE_SIZES = [10, 25, 50, 100, 200]
// What each column sorts by.
const SORTS = {
  name: (u) => u.name,
  role: (u) => roleLabel(u),
  loginId: (u) => u.loginId || '',
  phone: (u) => u.phone || '',
  email: (u) => u.email || '',
  status: (u) => (u.isActive ? 'Active' : 'Inactive'),
}
const COLUMNS = [
  ['SN', null], ['User Name', 'name'], ['Role', 'role'], ['Login ID', 'loginId'], ['Mobile', 'phone'],
  ['Email ID', 'email'], ['Location', null], ['Lane/Door', null], ['Status', 'status'],
]

export default function Users() {
  const { user, company, can } = useAuth()
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(null)
  const [filter, setFilter] = useState({ q: '', location: '', role: '' })
  const [size, setSize] = useState(25)
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState({ key: null, dir: 1 })
  const [fileError, setFileError] = useState('')
  const users = useQuery({ queryKey: ['users'], queryFn: userApi.list })
  const locations = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })

  const roleList = useQuery({ queryKey: ['roles'], queryFn: roleApi.list })

  const roles = assignableRoles(user.role)
  // Custom roles this person may hand out. A role the edited user already has
  // stays in the list so the form can show it.
  const customRoles = (roleList.data || []).filter(
    (r) => r.assignable || (editing && editing.customRole?.id === r._id),
  )
  const activeLocations = (locations.data || []).filter((l) => l.isActive)
  const locationNames = Object.fromEntries((locations.data || []).map((l) => [l._id, l.name]))
  const needle = filter.q.trim().toLowerCase()
  const roleNames = useMemo(() => [...new Set((users.data || []).map((u) => roleLabel(u)))].sort(), [users.data])

  const shown = useMemo(() => {
    const list = (users.data || []).filter(
      (u) =>
        (!filter.location || u.locationIds.includes(filter.location)) &&
        (!filter.role || roleLabel(u) === filter.role) &&
        (!needle || [u.name, u.loginId, u.email, u.phone, roleLabel(u)].some((v) => (v || '').toLowerCase().includes(needle))),
    )
    if (!sort.key) return list
    const pick = SORTS[sort.key]
    return [...list].sort((a, b) => String(pick(a)).localeCompare(String(pick(b)), undefined, { sensitivity: 'base' }) * sort.dir)
  }, [users.data, filter, needle, sort])

  const pages = Math.max(1, Math.ceil(shown.length / size))
  const current = Math.min(page, pages - 1)
  const rows = shown.slice(current * size, current * size + size)
  const setFilterAndTop = (patch) => {
    setFilter((f) => ({ ...f, ...patch }))
    setPage(0)
  }
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }))

  const download = async () => {
    setFileError('')
    try {
      await userApi.download('xlsx')
    } catch (err) {
      setFileError(errorMessage(err))
    }
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <Card>
          <EditUserForm
            key={editing._id}
            user={editing}
            roles={roles}
            customRoles={customRoles}
            locations={activeLocations}
            onClose={() => setEditing(null)}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1>Users List</h1>

      <CompanyCode code={company?.code} />

      {company && adding && (
        <Card title="Create New User">
          <CreateUserForm
            roles={roles}
            customRoles={customRoles.filter((r) => r.assignable)}
            locations={activeLocations}
            onCreated={(created) => {
              setAdded(created)
              setAdding(false)
            }}
          />
        </Card>
      )}
      {added && !adding && <Alert type="success">{`${added.name} was added.`}</Alert>}

      <Card>
        {users.error && <Alert>{errorMessage(users.error)}</Alert>}
        {fileError && <Alert>{fileError}</Alert>}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              Show
              <select className="rounded-lg border border-slate-300 px-2 py-1" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              entries
            </label>
            <Select label="Location" name="user-location" value={filter.location} onChange={(e) => setFilterAndTop({ location: e.target.value })}>
              <option value="">All Locations</option>
              {(locations.data || []).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
            </Select>
            <Select label="Role" name="user-role" value={filter.role} onChange={(e) => setFilterAndTop({ role: e.target.value })}>
              <option value="">All Roles</option>
              {roleNames.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
            <Field label="Search" name="user-search" placeholder="Name, Login ID, mobile, email" value={filter.q} onChange={(e) => setFilterAndTop({ q: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            {company && (
              <Button type="button" variant="success" onClick={() => setAdding((open) => !open)}>
                {adding ? 'Close form' : '+ Create New User'}
              </Button>
            )}
            <Button type="button" variant="info" onClick={download}>Download Excel</Button>
            <Button type="button" variant="dark" onClick={() => printTable(document.getElementById('user-table'), 'Users')}>Print</Button>
          </div>
        </div>

        {users.isLoading ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table id="user-table" className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr>
                  {COLUMNS.map(([label, key]) => (
                    <th key={label} aria-sort={key && sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      {key ? (
                        <button type="button" className="flex w-full items-center justify-between gap-2 text-left font-bold" onClick={() => sortBy(key)}>
                          {label}
                          <span aria-hidden="true" className="text-xs text-slate-400">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                        </button>
                      ) : label}
                    </th>
                  ))}
                  <th className="print:hidden">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => (
                  <UserRow key={u._id} user={u} index={current * size + i + 1} locationNames={locationNames} locations={locations.data || []} onEdit={() => { setEditing(u); setAdded(null) }} />
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-slate-500">{users.data?.length ? 'No one matches this search.' : 'No users yet. Add location admins and operators with “Create New User”.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>{shown.length === 0 ? 'Showing 0 entries' : `Showing ${current * size + 1} to ${Math.min(shown.length, current * size + size)} of ${shown.length} entries`}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</Button>
            <span>Page {current + 1} of {pages}</span>
            <Button type="button" variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</Button>
          </div>
        </div>
      </Card>

      {company && <Licences editable={can('COMPANY_MANAGE')} />}
    </div>
  )
}
