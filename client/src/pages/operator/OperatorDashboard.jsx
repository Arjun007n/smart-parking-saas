import { useQuery } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, PageLoader } from '../../components/ui'

const TYPES = [
  ['Cars', 'car'],
  ['Bikes', 'bike'],
  ['Heavy', 'heavy'],
]

export default function OperatorDashboard() {
  const { user } = useAuth()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Hello, {user.name}</h1>

      {error && <Alert>{errorMessage(error)}</Alert>}
      {isLoading ? (
        <PageLoader />
      ) : data.length === 0 ? (
        <Alert type="info">You are not assigned to a parking location yet. Ask your admin to assign one.</Alert>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((location) => (
            <li key={location._id} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-slate-900">{location.name}</h2>
                <Badge tone={location.isActive ? 'green' : 'red'}>{location.isActive ? 'Open' : 'Closed'}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                {TYPES.filter(([, key]) => location.capacity[key] > 0).map(([label, key]) => (
                  <div key={key} className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-slate-500">{label} free</dt>
                    <dd className="text-xl font-bold text-slate-900">
                      {location.capacity[key] - location.occupied[key]}
                      <span className="text-sm font-normal text-slate-500"> / {location.capacity[key]}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
