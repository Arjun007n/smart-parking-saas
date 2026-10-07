import { useQuery } from '@tanstack/react-query'
import { locationApi } from '../services/api'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'sp_location'

// The open locations the signed-in user can work at, plus the one to
// preselect: the one used last time on this device, or the only one.
//
// A user the company admin tied to particular lanes only sees those lanes at that location
// (the server enforces it too).
export function useMyLocations() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  const lanes = user?.lanes || []
  const locations = (query.data || [])
    .filter((l) => l.isActive)
    .map((l) => {
      const mine = lanes.filter((lane) => lane.locationId === l._id).map((lane) => lane.gate)
      return mine.length ? { ...l, gates: (l.gates || []).filter((g) => mine.includes(g.name)) } : l
    })

  let preferred = ''
  try {
    preferred = localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    // Storage can be unavailable (private mode); simply do not remember.
  }
  const defaultId = locations.some((l) => l._id === preferred)
    ? preferred
    : locations.length === 1
      ? locations[0]._id
      : ''

  return { ...query, locations, defaultId }
}

export function rememberLocation(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Not being able to remember the choice is harmless.
  }
}
