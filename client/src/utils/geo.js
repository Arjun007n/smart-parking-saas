// Small helpers for places on a map. None of them needs a map key.

// The distance in kilometres between two points (straight line over the earth).
export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// "850 m" or "2.3 km".
export const distanceText = (km) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`)

const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)

// A Google Maps link that opens turn-by-turn directions to the place (works without any key).
export const directionsUrl = (p) => (valid(p) ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : '')

// A Google Maps link that just shows the place.
export const placeUrl = (p) => (valid(p) ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : '')

// Asks the browser where the person is. Resolves to { lat, lng }; rejects with a short message a person can read.
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot find your location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (error) => reject(new Error(error.code === 1 ? 'Location is switched off for this site. Allow it in the browser to use this.' : 'Your location could not be found. Try again.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}
