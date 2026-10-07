import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { locationApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { Alert, Badge, Card, PageLoader } from '../../components/ui'
import DetailsForm from '../../components/location/DetailsForm'
import SlotsPanel from '../../components/location/SlotsPanel'
import TariffsPanel from '../../components/location/TariffsPanel'
import ReceiptPanel from '../../components/location/ReceiptPanel'
import OperationsPanel from '../../components/location/OperationsPanel'
import AutoExitPanel from '../../components/location/AutoExitPanel'
import LanesPanel from '../../components/location/LanesPanel'

export default function LocationDetail() {
  const { id } = useParams()
  const { can, company } = useAuth()
  // The Locations table links straight to a tab with ?tab=tariffs, lanes, autoexit, rules, receipt, slots.
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || 'details')
  const { data: location, isLoading, error } = useQuery({
    queryKey: ['location', id],
    queryFn: () => locationApi.get(id),
  })

  if (isLoading) return <PageLoader />
  if (error) return <Alert>{errorMessage(error)}</Alert>

  const canManage = can('LOCATION_MANAGE')
  const tabs = [
    { key: 'details', label: 'Details', show: canManage },
    { key: 'slots', label: 'Slots', show: true },
    { key: 'tariffs', label: 'Tariffs', show: can('TARIFF_MANAGE') },
    { key: 'rules', label: 'Gate rules', show: canManage },
    { key: 'autoexit', label: 'Auto exit', show: canManage },
    { key: 'lanes', label: 'Lanes', show: true },
    { key: 'receipt', label: 'Receipt', show: canManage },
  ].filter((t) => t.show)
  const current = tabs.some((t) => t.key === tab) ? tab : tabs[0].key

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard/locations" className="text-sm text-blue-700 hover:underline">
          ← All parking locations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{location.name}</h1>
          <Badge tone={location.isActive ? 'green' : 'red'}>{location.isActive ? 'Active' : 'Closed'}</Badge>
        </div>
      </div>

      <div role="tablist" aria-label="Location sections" className="flex gap-1 border-b border-slate-300">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={current === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              current === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {current === 'details' && <DetailsForm key={location.updatedAt} location={location} />}
        {current === 'slots' && <SlotsPanel location={location} canManage={canManage} />}
        {current === 'tariffs' && <TariffsPanel location={location} />}
        {current === 'rules' && <OperationsPanel key={location.updatedAt} location={location} />}
        {current === 'autoexit' && <AutoExitPanel key={location.updatedAt} location={location} />}
        {current === 'lanes' && <LanesPanel location={location} canManage={canManage} onEdit={() => setTab('details')} />}
        {current === 'receipt' && <ReceiptPanel location={location} company={company} />}
      </Card>
    </div>
  )
}
