// Loads the Google Maps JavaScript API once, and only when a key is set.
//
//   VITE_GOOGLE_MAPS_KEY      a browser key from Google Cloud with "Maps JavaScript API" and "Geocoding API"
//                             turned on. Restrict it to your website addresses (HTTP referrers).
//   VITE_GOOGLE_MAPS_MAP_ID   optional: a Map ID from Google Cloud (needed for the pin to be draggable styling);
//                             the demo id is used when this is empty.
//
// Without a key nothing is loaded and the pages fall back to plain links and typed coordinates.

export const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || ''
export const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID'
export const mapsEnabled = Boolean(MAPS_KEY)

let loading = null

// Resolves to the `google` object, or rejects when the script cannot load or the key is refused.
export function loadGoogleMaps() {
  if (!mapsEnabled) return Promise.reject(new Error('No map key is set'))
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    // Google calls this when the key is wrong, not allowed for this address, or billing is off.
    window.gm_authFailure = () => {
      loading = null
      reject(new Error('Google refused the map key. Check the key, its allowed websites and that billing is on.'))
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&callback=__spMapsReady`
    script.async = true
    window.__spMapsReady = () => resolve(window.google)
    script.onerror = () => {
      loading = null
      reject(new Error('The map could not be loaded. Check your internet connection.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

// The embeddable map address for one place (Maps Embed API, which also needs to be turned on for the key).
export const embedUrl = (p) => `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(MAPS_KEY)}&q=${p.lat},${p.lng}&zoom=16`
