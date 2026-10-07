import { useLiveStatus } from '../../hooks/useLive'

const LIVE = {
  live: { text: 'Live', dot: 'bg-green-500', tip: 'Changes appear on this screen at once' },
  connecting: { text: 'Connecting', dot: 'bg-amber-400', tip: 'Connecting to live updates' },
  offline: { text: 'Not live', dot: 'bg-slate-400', tip: 'The screen refreshes itself every few seconds instead' },
}

const Detail = ({ label, value }) => (
  <span className="whitespace-nowrap">
    <span className="font-bold text-[#1e3d73]">{label} :</span> <span className="text-slate-600">{value}</span>
  </span>
)

// The strip above the entry and exit screens, in one line: LN : lane  Area : ...  Plaza : ...  ORG ID : ...
// and a FASTag badge. `children` (the barrier button, the auto switch) go on the right.
const PARKING_TYPE = { NORMAL: 'Parking', AIRPORT: 'Airport parking' }

export default function LaneBar({ location, gate, company, parkingType, children }) {
  const status = useLiveStatus()
  const live = LIVE[status] || LIVE.offline
  const lane = (location?.gates || []).find((g) => g.name === gate)

  return (
    <div className="no-print flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="text-base font-extrabold text-[#1e3d73]">LN : <span className="font-semibold text-slate-700">{lane?.laneCode || gate || 'Lane not set'}</span></span>
      <Detail label="Location" value={location?.name || 'Not chosen'} />
      {gate && <Detail label="Gate" value={gate} />}
      {lane?.plazaId && <Detail label="Plaza" value={lane.plazaId} />}
      {company?.name && <Detail label="Company" value={company.name} />}
      {lane?.fastagLaneId && (
        <span className="rounded border border-green-600 px-1.5 py-0.5 text-xs font-extrabold text-slate-800" title="FASTag lane">
          <span className="text-orange-500">FAS</span><span className="text-green-700">TAG</span> : {lane.fastagLaneId}
        </span>
      )}
      {parkingType && (
        <span className="rounded bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700" title="Parking type of this location">
          {PARKING_TYPE[parkingType] || 'Parking'}
        </span>
      )}
      <span className="ml-auto flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-600" title={live.tip}>
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${live.dot}`} aria-hidden="true" />
          {live.text}
        </span>
        {children}
      </span>
    </div>
  )
}
