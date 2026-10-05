import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { roleApi } from '../../services/api'
import { roleSchema } from '../../validators/schemas'
import { errorMessage } from '../../utils/errors'
import { ROLE_LABELS } from '../../utils/roles'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select, Textarea } from '../../components/ui'

const EMPTY = { name: '', description: '', baseRole: '', permissions: [] }

// Create a role, or change the permissions and name of an existing one.
// The base role is chosen once: it decides rank and which locations the user
// sees, so changing it later would quietly change what people can manage.
function RoleForm({ role, catalog, onDone }) {
  const queryClient = useQueryClient()
  const editing = Boolean(role)
  const {
    register, handleSubmit, setValue, control, formState: { errors },
  } = useForm({
    resolver: zodResolver(roleSchema),
    defaultValues: role
      ? { name: role.name, description: role.description || '', baseRole: role.baseRole, permissions: role.permissions }
      : EMPTY,
  })
  const [copyFrom, setCopyFrom] = useState('')
  const selected = useWatch({ control, name: 'permissions' }) || []

  const save = useMutation({
    mutationFn: ({ name, description, baseRole, permissions }) =>
      editing
        ? roleApi.update(role._id, { name, description, permissions })
        : roleApi.create({ name, baseRole, permissions, ...(description ? { description } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      onDone()
    },
  })

  // Fills the ticks from a standard role, as a starting point to adjust.
  const copy = (baseRole) => {
    setCopyFrom(baseRole)
    if (baseRole) setValue('permissions', catalog.builtIn[baseRole] || [], { shouldDirty: true })
  }

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4 rounded-lg bg-slate-50 p-4" noValidate>
      <h3 className="font-semibold text-slate-900">{editing ? `Edit “${role.name}”` : 'New role'}</h3>
      <Alert>{save.error && errorMessage(save.error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Role name" placeholder="Shift supervisor" error={errors.name?.message} {...register('name')} />
        <Select
          label="Based on"
          disabled={editing}
          error={errors.baseRole?.message}
          {...register('baseRole', { onChange: (e) => copy(editing ? '' : e.target.value) })}
        >
          <option value="">Choose a base role</option>
          {catalog.baseRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
      </div>
      <Textarea label="Description (optional)" rows={2} error={errors.description?.message} {...register('description')} />
      <p className="text-xs text-slate-500">
        The base role decides who the user can manage and whether they see one location or all of them. The ticks below
        decide what they can do. Company settings and role editing always stay with the company admin.
      </p>

      <fieldset>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-medium text-slate-700">Permissions</legend>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Start from
            <select
              value={copyFrom}
              onChange={(e) => copy(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="">—</option>
              {Object.keys(catalog.builtIn).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {catalog.permissions.map((p) => (
            <div key={p.key}>
              <Checkbox label={p.label} value={p.key} {...register('permissions')} />
              <p className="ml-6 text-xs text-slate-500">{p.description}</p>
            </div>
          ))}
        </div>
        {selected.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">With nothing ticked, users with this role can log in but do nothing.</p>
        )}
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Create role'}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function RoleRow({ role, labels, onEdit }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => roleApi.remove(role._id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  })
  const confirmRemove = () => {
    if (window.confirm(`Delete the role “${role.name}”?`)) remove.mutate()
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            {role.name} <Badge>{ROLE_LABELS[role.baseRole]}</Badge>
          </p>
          {role.description && <p className="text-sm text-slate-600">{role.description}</p>}
          <p className="mt-1 text-xs text-slate-500">
            {role.userCount === 1 ? '1 user has this role' : `${role.userCount} users have this role`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>Edit</Button>
          <Button variant="danger" loading={remove.isPending} onClick={confirmRemove}>Delete</Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {role.permissions.length ? (
          role.permissions.map((p) => <Badge key={p} tone="blue">{labels[p] || p}</Badge>)
        ) : (
          <span className="text-xs text-slate-500">No permissions</span>
        )}
      </div>
      {remove.error && <p className="mt-2 text-sm text-red-600">{errorMessage(remove.error)}</p>}
    </li>
  )
}

export default function Roles() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: roleApi.list })
  const catalog = useQuery({ queryKey: ['roles', 'catalog'], queryFn: roleApi.catalog })
  // null = nothing open, 'new' = the create form, otherwise the role being edited
  const [open, setOpen] = useState(null)

  if (roles.isLoading || catalog.isLoading) return <PageLoader />
  const labels = Object.fromEntries((catalog.data?.permissions || []).map((p) => [p.key, p.label]))
  const full = (roles.data || []).length >= (catalog.data?.maxRoles || 50)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Roles</h1>
        {!open && (
          <Button disabled={full || !catalog.data} onClick={() => setOpen('new')}>New role</Button>
        )}
      </div>
      <p className="max-w-2xl text-sm text-slate-600">
        The standard roles fit most teams. Create your own when someone needs less, or a different mix: for example a
        gate supervisor who also sees reports, or an accountant who only reads them. Changes apply straight away, without
        anyone logging in again.
      </p>

      {roles.error && <Alert>{errorMessage(roles.error)}</Alert>}
      {catalog.error && <Alert>{errorMessage(catalog.error)}</Alert>}

      {catalog.data && open && (
        <RoleForm
          key={open === 'new' ? 'new' : open._id}
          role={open === 'new' ? null : open}
          catalog={catalog.data}
          onDone={() => setOpen(null)}
        />
      )}

      <Card title="Your company's roles">
        {roles.data?.length ? (
          <ul className="space-y-3">
            {roles.data.map((role) => (
              <RoleRow key={role._id} role={role} labels={labels} onEdit={() => setOpen(role)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No custom roles yet. The standard roles are always available.</p>
        )}
      </Card>

      {catalog.data && (
        <Card title="Standard roles, for comparison">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Permission</th>
                  {Object.keys(catalog.data.builtIn).map((r) => (
                    <th key={r} className="pb-2 pr-3 font-medium">{ROLE_LABELS[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {catalog.data.permissions.map((p) => (
                  <tr key={p.key} className="border-t border-slate-200">
                    <td className="py-2 pr-4">{p.label}</td>
                    {Object.entries(catalog.data.builtIn).map(([r, list]) => (
                      <td key={r} className="py-2 pr-3 text-slate-700">
                        {list.includes(p.key) ? <span aria-label="Yes">✓</span> : <span className="text-slate-300" aria-label="No">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
