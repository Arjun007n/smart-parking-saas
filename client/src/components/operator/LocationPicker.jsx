import { Select } from '../ui'

// Location (and optionally gate) selectors used on the entry and exit forms.
// `gateTypes` lists which gate types may be chosen, e.g. ['ENTRY', 'BOTH'].
export default function LocationPicker({ locations, selectedId, register, errors, gateTypes }) {
  const location = locations.find((l) => l._id === selectedId)
  const gates = location ? location.gates.filter((g) => gateTypes.includes(g.type)) : []

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select label="Parking location" error={errors.locationId?.message} {...register('locationId')}>
        <option value="">Choose a location</option>
        {locations.map((l) => (
          <option key={l._id} value={l._id}>{l.name}</option>
        ))}
      </Select>
      {gates.length > 0 && (
        <Select label="Gate" {...register('gate')}>
          <option value="">Not specified</option>
          {gates.map((g) => (
            <option key={g.name} value={g.name}>{g.name}</option>
          ))}
        </Select>
      )}
    </div>
  )
}
