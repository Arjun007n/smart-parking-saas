const TYPES = [
  ['Cars', 'car'],
  ['Bikes', 'bike'],
  ['Heavy', 'heavy'],
]

// Free spaces of a location, by vehicle type.
export default function Availability({ capacity, occupied }) {
  const rows = TYPES.filter(([, key]) => capacity[key] > 0)
  if (!rows.length) return <p className="text-sm text-slate-500">No capacity set for this location.</p>

  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      {rows.map(([label, key]) => {
        const free = capacity[key] - occupied[key]
        return (
          <div key={key} className={`rounded-lg p-3 ${free > 0 ? 'bg-slate-50' : 'bg-red-50'}`}>
            <dt className="text-slate-500">{label} free</dt>
            <dd className="text-xl font-bold text-slate-900">
              {free}
              <span className="text-sm font-normal text-slate-500"> / {capacity[key]}</span>
              {free <= 0 && <span className="ml-2 text-sm font-semibold text-red-700">Full</span>}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
