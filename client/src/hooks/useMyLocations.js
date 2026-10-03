import { useQuery } from '@tanstack/react-query'
import { locationApi } from '../services/api'

const STORAGE_KEY = 'sp_location'

// The open locations the signed-in user can work at, plus the one to
// preselect: the one used last time on this device, or the only one.
export function useMyLocations() {
  const query = useQuery({ queryKey: ['locations'], queryFn: locationApi.list })
  const locations = (query.data || []).filter((l) => l.isActive)

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
