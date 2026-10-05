import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { publicBookingApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { VEHICLE_LABELS, money } from '../../utils/format'
import { usePageTitle } from '../../hooks/usePageTitle'
import { PageHeader } from '../../layouts/PublicLayout'
import { Alert, Field } from '../../components/ui'
import { Skeleton } from '../../components/motion'
import { currentPosition, directionsUrl, distanceKm, distanceText } from '../../utils/geo'

// What a parking charges to hold a space, in a few words: "Car ₹50 · Bike free".
const feeLine = (types) => types.map((t) => `${VEHICLE_LABELS[t.type] || t.type} ${t.fee > 0 ? money(t.fee) : 'free'}`).join(' · ')

export default function Book() {
  usePageTitle('Book a parking space')
  const [search, setSearch] = useState('')
  const [here, setHere] = useState(null) // { lat, lng } once the visitor shares their position
  const [whereError, setWhereError] = useState('')
  const [finding, setFinding] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['public-locations'], queryFn: publicBookingApi.locations, staleTime: 60_000 })

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const found = (data?.locations || [])
    .filter((l) => {
      const text = `${l.name} ${l.address?.line1 || ''} ${l.address?.city || ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .map((l) => ({ ...l, km: here && l.coordinates ? distanceKm(here, l.coordinates) : null }))
  // Nearest first once the position is known; parkings without a position go last.
  const locations = here ? [...found].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)) : found

  const findNearMe = async () => {
    setFinding(true)
    setWhereError('')
    try {
      setHere(await currentPosition())
    } catch (err) {
      setWhereError(err.message)
    } finally {
      setFinding(false)
    }
  }

  return (
    <>
      <PageHeader title="Book a parking space" intro="Pick a parking, tell us when you are coming, and pay the booking fee online. The fee is set against your parking charge when you arrive." />
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Field label="Find a parking" type="search" name="book-search" placeholder="Name, street or city" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button" onClick={findNearMe} disabled={finding}
            className="sp-press rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
          >
            {finding ? 'Finding you…' : here ? 'Update my location' : 'Show parkings near me'}
          </button>
          {here && <span className="text-sm text-slate-600">Nearest first. Your location stays in your browser.</span>}
          {whereError && <span className="text-sm text-red-700" role="alert">{whereError}</span>}
        </div>
        {error && <div className="mt-6"><Alert>{errorMessage(error)}</Alert></div>}
        {isLoading ? (
          <div role="status" aria-label="Loading parkings" className="mt-6 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-5">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="mt-3 h-3 w-1/2" />
                <Skeleton className="mt-3 h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : locations.length === 0 ? (
          <p className="mt-6 text-slate-600" role="status">
            {search ? 'No parking matches that search.' : 'No parking takes online bookings yet.'}
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {locations.map((l) => (
              <li key={l.id} className="sp-lift sp-row-in rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{l.name}</h2>
                    <p className="text-sm text-slate-600">{[l.address?.line1, l.address?.city, l.address?.state].filter(Boolean).join(', ')}</p>
                    {l.coordinates && (
                      <p className="mt-1 text-sm">
                        {l.km !== null && <span className="mr-3 font-semibold text-slate-800">{distanceText(l.km)} away</span>}
                        <a href={directionsUrl(l.coordinates)} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">Directions</a>
                      </p>
                    )}
                    <p className="mt-2 text-sm text-slate-700">{l.types.length ? feeLine(l.types) : 'Not taking bookings right now'}</p>
                    {l.note && <p className="mt-1 text-xs text-slate-500">{l.note}</p>}
                  </div>
                  {l.types.length > 0 && (
                    <Link to={`/book/${l.id}`} className="sp-press rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      Book
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
