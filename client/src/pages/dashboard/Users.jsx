import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { locationApi, roleApi, userApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { userEditSchema, userSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { operatorPayload } from '../../utils/format'
import { ROLE_LABELS, assignableRoles, roleChoiceOf, roleChoicePayload, roleLabel } from '../../utils/roles'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select } from '../../components/ui'

const DEFAULTS = {
  name: '', email: '', phone: '', password: '', role: '', locationIds: [],
  employeeCode: '', shiftName: '', shiftStart: '', shiftEnd: '',
}

function useRefreshUsers() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['users'] })
    queryClient.invalidateQueries({ queryKey: ['roles'] })
    queryClient.invalidateQueries({ queryKey: ['onboarding'] })
  }
}

// Role, locations and shift inputs shared by the add and edit forms.
function AssignmentFields({ register, errors, roles, customRoles, locations }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Role" error={errors.role?.message} {...register('role')}>
          <option value="">Choose a role</option>
          <optgroup label="Standard roles">
            {roles.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </optgroup>
          {customRoles.length > 0 && (
            <optgroup label="Your company's roles">
              {customRoles.map((role) => (
                <option key={role._id} value={`custom:${role._id}`}>{role.name}</option>
              ))}
            </optgroup>
          )}
        </Select>
        <Field label="Employee code (optional)" error={errors.employeeCode?.message} {...register('employeeCode')} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Works at</legend>
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

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium text-slate-700">Shift (optional)</legend>
        <Field label="Shift name" placeholder="Morning" error={errors.shiftName?.message} {...register('shiftName')} />
        <Field label="Starts" type="time" error={errors.shiftStart?.message} {...register('shiftStart')} />
        <Field label="Ends" type="time" error={errors.shiftEnd?.message} {...register('shiftEnd')} />
      </fieldset>
    </>
  )
}

function CreateUserForm({ roles, customRoles, locations }) {
  const refresh = useRefreshUsers()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(userSchema), defaultValues: DEFAULTS })

  const create = useMutation({
    mutationFn: ({ name, email, phone, password, role, locationIds, ...profile }) =>
      userApi.create({
        name, email, password, locationIds,
        ...roleChoicePayload(role),
        ...(phone ? { phone } : {}),
        ...operatorPayload(profile),
      }),
    onSuccess: () => {
      refresh()
      reset(DEFAULTS)
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="space-y-4" noValidate>
      <Alert>{create.error && errorMessage(create.error)}</Alert>
      <Alert type="success">{create.isSuccess && `${create.data.name} was added.`}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message} {...register('name')} />
        <Field label="Email" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
        <Field label="Phone (optional)" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Field
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters. Share it with the user privately."
          error={errors.password?.message}
          {...register('password')}
        />
      </div>
      <AssignmentFields register={register} errors={errors} roles={roles} customRoles={customRoles} locations={locations} />
      <Button type="submit" loading={create.isPending}>
        Add user
      </Button>
    </form>
  )
}

function EditUserForm({ user, roles, customRoles, locations, onClose }) {
  const refresh = useRefreshUsers()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(userEditSchema),
    defaultValues: {
      name: user.name,
      phone: user.phone || '',
      role: roleChoiceOf(user),
      locationIds: user.locationIds,
      password: '',
      employeeCode: user.operator?.employeeCode || '',
      shiftName: user.operator?.shift?.name || '',
      shiftStart: user.operator?.shift?.start || '',
      shiftEnd: user.operator?.shift?.end || '',
    },
  })

  const save = useMutation({
    mutationFn: ({ name, phone, role, locationIds, password, ...profile }) =>
      userApi.update(user._id, {
        name, phone, locationIds,
        // Only send the role when it was changed: the person editing may not
        // be allowed to hand out the role the user already has.
        ...(role !== roleChoiceOf(user) ? roleChoicePayload(role) : {}),
        ...(password ? { password } : {}),
        ...operatorPayload(profile),
      }),
    onSuccess: () => {
      refresh()
      onClose()
    },
  })

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4 rounded-lg bg-slate-50 p-4" noValidate>
      <h3 className="font-semibold text-slate-900">Edit {user.email}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name?.message} {...register('name')} />
        <Field label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
      </div>
      <AssignmentFields register={register} errors={errors} roles={roles} customRoles={customRoles} locations={locations} />
      <Field
        label="Reset password (optional)"
        type="password"
        autoComplete="new-password"
        hint="Leave empty to keep the current password. Setting one logs the user out everywhere."
        error={errors.password?.message}
        {...register('password')}
      />
      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>Save changes</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function UserRow({ user, locationNames, onEdit }) {
  const refresh = useRefreshUsers()
  const toggle = useMutation({
    mutationFn: () => userApi.update(user._id, { isActive: !user.isActive }),
    onSuccess: refresh,
  })
  const shift = user.operator?.shift

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="py-3 pr-4">
        <p className="font-medium text-slate-900">{user.name}</p>
        <p className="text-slate-500">{user.email}</p>
        {user.operator?.employeeCode && <p className="text-xs text-slate-500">Code: {user.operator.employeeCode}</p>}
      </td>
      <td className="py-3 pr-4">
        {roleLabel(user)}
        {user.customRole && <p className="text-xs text-slate-500">Based on {ROLE_LABELS[user.role]}</p>}
      </td>
      <td className="py-3 pr-4 text-slate-600">
        {user.locationIds.map((id) => locationNames[id]).filter(Boolean).join(', ') || '—'}
      </td>
      <td className="py-3 pr-4 text-slate-600">
        {shift?.name || shift?.start
          ? [shift.name, shift.start && shift.end ? `${shift.start}–${shift.end}` : shift.start].filter(Boolean).join(' · ')
          : '—'}
      </td>
      <td className="py-3 pr-4">
        <Badge tone={user.isActive ? 'green' : 'red'}>{user.isActive ? 'Active' : 'Deactivated'}</Badge>
      </td>
      <td className="py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onEdit}>Edit</Button>
          <Button variant={user.isActive ? 'danger' : 'secondary'} loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {user.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
        {toggle.error && <p className="mt-1 text-sm text-red-600">{errorMessage(toggle.error)}</p>}
      </td>
    </tr>
  )
}

export default function Users() {
  const { user, company } = useAuth()
  const [editing, setEditing] = useState(null)
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Users and operators</h1>

      {company && (
        <Card title="Add a user">
          <CreateUserForm roles={roles} customRoles={customRoles.filter((r) => r.assignable)} locations={activeLocations} />
        </Card>
      )}

      <Card title="Team">
        {editing && (
          <div className="mb-6">
            <EditUserForm
              key={editing._id}
              user={editing}
              roles={roles}
              customRoles={customRoles}
              locations={activeLocations}
              onClose={() => setEditing(null)}
            />
          </div>
        )}
        {users.error && <Alert>{errorMessage(users.error)}</Alert>}
        {users.isLoading ? (
          <PageLoader />
        ) : users.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">User</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Works at</th>
                  <th className="pb-2 pr-4 font-medium">Shift</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <UserRow key={u._id} user={u} locationNames={locationNames} onEdit={() => setEditing(u)} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No users yet. Add location admins and operators above.</p>
        )}
      </Card>
    </div>
  )
}
