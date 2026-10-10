// Lanes: a lane is one gate for one vehicle and one direction ("Car-Entry", "Bike-Exit"), with its own
// Door/Lane No. and Reader. The server stores them as the location's gates.

export const CLASS_LABELS = { TWO_WHEELER: '2-wheeler', FOUR_WHEELER: '4-wheeler' }

// The short vehicle name a lane carries.
export const LANE_VEHICLES = { BIKE: 'Bike', CAR: 'Car', TAXI: 'Taxi', TEMPO: 'Tempo', HEAVY: 'Heavy' }

// 2-wheelers are bikes; everything else is a 4-wheeler (car, taxi, tempo, coach).
export const classOfType = (type) => (type === 'BIKE' ? 'TWO_WHEELER' : 'FOUR_WHEELER')

// A location whose gates are lanes (they carry a vehicle).
export const isLaneLocation = (location) => (location?.gates || []).some((g) => g.lane)

// The number of lanes (gates) a location has.
export const laneCount = (location) => (location?.gates || []).length

// The lanes a new location starts with: an entry and an exit for 2-wheelers and for 4-wheelers.
export const defaultGates = () =>
  [['BIKE', 'ENTRY'], ['BIKE', 'EXIT'], ['CAR', 'ENTRY'], ['CAR', 'EXIT']].map(([vehicleType, type]) => ({
    name: `${LANE_VEHICLES[vehicleType]}-${type === 'ENTRY' ? 'Entry' : 'Exit'}`,
    type,
    lane: LANE_VEHICLES[vehicleType],
    vehicleType,
  }))

// A lane takes only its own class of vehicle (an old-style gate takes any type).
export const gateTakes = (gate, vehicleType) => !gate?.vehicleClass || gate.vehicleClass === classOfType(vehicleType)
