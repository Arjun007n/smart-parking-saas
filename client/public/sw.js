// A minimal service worker. It lets the browser offer "Install app" and does not store pages or
// data: every request goes straight to the network, so the live gate screens never show old data.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
