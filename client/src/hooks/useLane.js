import { useEffect } from 'react'

// This computer's lane: the location and gate it works at, remembered in the browser.
// Entry and exit screens are remembered separately (a gate is for entry, exit or both).
const key = (direction) => `sp_lane_${direction}`

const read = (direction) => {
  try {
    return JSON.parse(localStorage.getItem(key(direction))) || {}
  } catch {
    return {}
  }
}

// The location and gate to start with: the remembered ones when they still exist and still fit.
export function initialLane(locations, defaultId, direction) {
  const saved = read(direction)
  const fitting = (location) => (location?.gates || []).filter((g) => g.type === 'BOTH' || g.type === direction)
  // A location with only one lane for this direction (always so for someone tied to one lane) starts on it.
  const onlyLane = (location) => (fitting(location).length === 1 ? fitting(location)[0].name : '')
  const location = locations.find((l) => l._id === saved.locationId)
  if (!location) return { locationId: defaultId, gate: onlyLane(locations.find((l) => l._id === defaultId)) }
  const fits = fitting(location).some((g) => g.name === saved.gate)
  return { locationId: location._id, gate: fits ? saved.gate : onlyLane(location) }
}

export function useRememberLane(direction, locationId, gate) {
  useEffect(() => {
    if (!locationId) return
    try {
      localStorage.setItem(key(direction), JSON.stringify({ locationId, gate: gate || '' }))
    } catch {
      // private window or blocked storage: the choice is just not remembered
    }
  }, [direction, locationId, gate])
}
