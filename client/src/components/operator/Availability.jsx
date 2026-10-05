import { CAPACITY_FIELDS as TYPES } from '../../utils/format'
import { CountUp, FillBar } from '../motion'

// Free spaces of a location, by vehicle type: the number counts to its new value
// whenever a vehicle comes or goes, and the bar turns amber, then red, as it fills.
export default function Availability({ capacity, occupied }) {
  const rows = TYPES.filter(([, key]) => capacity[key] > 0)
  if (!rows.length) return <p className="text-sm text-slate-500">No capacity set for this location.</p>

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
      {rows.map(([label, key]) => {
        const used = occupied[key] || 0
        const free = capacity[key] - used
        return (
          <div key={key} className={`sp-lift rounded-lg p-3 transition-colors duration-500 ${free > 0 ? 'bg-slate-50' : 'bg-red-50'}`}>
            <dt className="text-slate-500">{label} free</dt>
            <dd className="text-xl font-bold text-slate-900">
              <CountUp value={free} />
              <span className="text-sm font-normal text-slate-500"> / {capacity[key]}</span>
              {free <= 0 && <span className="sp-pop ml-2 text-sm font-semibold text-red-700">Full</span>}
            </dd>
            <div className="mt-2">
              <FillBar used={used} total={capacity[key]} label={`${label} occupancy`} />
            </div>
          </div>
        )
      })}
    </dl>
  )
}
