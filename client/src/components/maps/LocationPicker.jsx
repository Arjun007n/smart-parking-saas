import { useEffect, useRef, useState } from 'react'
import { currentPosition, placeUrl } from '../../utils/geo'
import { loadGoogleMaps, MAP_ID, mapsEnabled } from './googleMaps'
import { Button, Field } from '../ui'

const INDIA = { lat: 22.5, lng: 79 }
const round = (n) => Math.round(n * 1e6) / 1e6
const toNumber = (text) => (text === '' || text === undefined ? NaN : Number(text))

// Picks where a parking is. `lat` and `lng` are the typed values (text), `onChange({ lat, lng })` reports new ones.
// With a Google Maps key there is a map: click it, drag the pin, or find the address. Without one you can
// still type the numbers, use your current position, and check it on Google Maps.
export default function LocationPicker({ lat, lng, onChange, addressText, errors = {} }) {
  const box = useRef(null)
  const map = useRef(null)
  const pin = useRef(null)
  const geocoder = useRef(null)
  const latest = useRef({ onChange })
  const [status, setStatus] = useState(mapsEnabled ? 'loading' : 'off') // loading, ready, failed, off
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    latest.current.onChange = onChange
  })

  const point = { lat: toNumber(lat), lng: toNumber(lng) }
  const hasPoint = Number.isFinite(point.lat) && Number.isFinite(point.lng)

  const set = (p) => latest.current.onChange({ lat: String(round(p.lat)), lng: String(round(p.lng)) })

  // Make the map once.
  useEffect(() => {
    if (!mapsEnabled) return undefined
    let cancelled = false
    loadGoogleMaps()
      .then(async (g) => {
        const { Map } = await g.maps.importLibrary('maps')
        const { AdvancedMarkerElement } = await g.maps.importLibrary('marker')
        const { Geocoder } = await g.maps.importLibrary('geocoding')
        if (cancelled || !box.current) return
        const start = Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null
        map.current = new Map(box.current, { center: start || INDIA, zoom: start ? 16 : 5, mapId: MAP_ID, streetViewControl: false, mapTypeControl: false })
        pin.current = new AdvancedMarkerElement({ map: map.current, position: start || undefined, gmpDraggable: true, title: 'Parking entrance' })
        if (!start) pin.current.map = null
        geocoder.current = new Geocoder()
        pin.current.addListener('dragend', () => {
          const pos = pin.current.position
          set({ lat: pos.lat, lng: pos.lng })
        })
        map.current.addListener('click', (event) => set({ lat: event.latLng.lat(), lng: event.latLng.lng() }))
        setStatus('ready')
      })
      .catch((error) => {
        if (cancelled) return
        setMessage(error.message)
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
    // The map is made once; later changes of the numbers move the pin in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the pin where the numbers say.
  useEffect(() => {
    if (status !== 'ready' || !map.current || !pin.current) return
    const valid = Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
    if (valid) {
      pin.current.position = point
      pin.current.map = map.current
      map.current.panTo(point)
      if (map.current.getZoom() < 14) map.current.setZoom(16)
    } else {
      pin.current.map = null
    }
  }, [status, point.lat, point.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const useMyPosition = async () => {
    setBusy(true)
    setMessage('')
    try {
      set(await currentPosition())
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  const findAddress = async () => {
    if (!geocoder.current || !addressText.trim()) {
      setMessage('Fill in the address above first.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { results } = await geocoder.current.geocode({ address: addressText, region: 'IN' })
      const spot = results && results[0] && results[0].geometry.location
      if (!spot) setMessage('That address was not found on the map. Click the map to place the pin instead.')
      else set({ lat: spot.lat(), lng: spot.lng() })
    } catch {
      setMessage('The address could not be looked up. Click the map to place the pin instead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {status !== 'off' && (
        <div className="overflow-hidden rounded-lg border border-slate-300">
          <div ref={box} className="h-72 w-full bg-slate-100" aria-label="Map: click to place the pin" />
          {status === 'loading' && <p className="p-2 text-xs text-slate-500">Loading the map…</p>}
        </div>
      )}
      {status === 'failed' && <p className="text-sm text-red-700">{message || 'The map could not be loaded.'} You can still type the numbers below.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Latitude" type="number" step="any" placeholder="26.9124" error={errors.lat} value={lat} onChange={(e) => onChange({ lat: e.target.value, lng })} />
        <Field label="Longitude" type="number" step="any" placeholder="75.7873" error={errors.lng} value={lng} onChange={(e) => onChange({ lat, lng: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={useMyPosition} disabled={busy}>Use my current position</Button>
        {status === 'ready' && <Button type="button" variant="secondary" onClick={findAddress} disabled={busy}>Find the address above on the map</Button>}
        {(lat || lng) && <Button type="button" variant="danger" onClick={() => onChange({ lat: '', lng: '' })}>Clear</Button>}
        {hasPoint && <a href={placeUrl(point)} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700 hover:underline">Check on Google Maps</a>}
      </div>
      {message && status !== 'failed' && <p className="text-sm text-amber-700">{message}</p>}
      <p className="text-xs text-slate-500">
        {status === 'off'
          ? 'Customers on the booking page get a "Directions" button and "nearest first" sorting when the position is set. A map to click on appears here once a Google Maps key is added (see docs/maps.md).'
          : 'Click the map, drag the pin, or type the numbers. Customers on the booking page get directions and "nearest first" sorting.'}
      </p>
    </div>
  )
}
