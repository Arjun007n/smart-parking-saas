// The lane an operator works at: the location and gate the company admin assigned to them (Users > lanes).
// The operator never chooses a location or a gate on the entry and exit screens.
//
// `locations` come from useMyLocations (already narrowed to the user's lanes), `lanes` are the user's
// assigned lanes ({ locationId, gate }), `direction` is 'ENTRY' or 'EXIT'. A person with no assigned lane
// (an older account) starts on the preferred location, or the first one, and on its only gate for the direction.
export function assignedLane(locations, lanes, direction, preferredId = '') {
  const fitting = (location) => (location?.gates || []).filter((g) => g.type === 'BOTH' || g.type === direction)
  const mine = (lanes || []).find((lane) => locations.some((l) => l._id === lane.locationId))
  const location = (mine && locations.find((l) => l._id === mine.locationId))
    || locations.find((l) => l._id === preferredId)
    || locations[0]
  if (!location) return { locationId: '', gate: '' }
  const gates = fitting(location)
  return { locationId: location._id, gate: gates.length === 1 ? gates[0].name : '' }
}
