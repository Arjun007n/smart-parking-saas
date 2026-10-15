// Is this page running inside the phone app (Capacitor) or in a normal browser?
// Everything in this folder does nothing in a browser, so the website is not affected.
//
// The phone app puts a `Capacitor` object on the page before the page's own code runs, so no Capacitor package is
// needed in the website's build: the website stays exactly as it was.
const capacitor = typeof window !== 'undefined' ? window.Capacitor : undefined

export const isNative = Boolean(capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform())

// A plugin of the phone by name.
//
// The page does not load the Capacitor JavaScript package (the website build must stay as it was), so the global only
// has what the phone's own bridge puts there: nativePromise, nativeCallback and addListener. The plugin object built
// here uses exactly those. (If a page ever does bring registerPlugin, that is used instead.)
const bridgePlugin = (name) =>
  new Proxy(
    {},
    {
      get(_, method) {
        // Not a plugin method: React and `await` look at these.
        if (typeof method !== 'string' || method === 'then' || method === 'toJSON') return undefined
        if (method === 'addListener') return async (eventName, callback) => capacitor.addListener(name, eventName, callback)
        return (options) => capacitor.nativePromise(name, method, options || {})
      },
    },
  )

// Each plugin object is made once.
const plugins = new Map()
export const nativePlugin = (name) => {
  if (!plugins.has(name)) {
    plugins.set(name, typeof capacitor.registerPlugin === 'function' ? capacitor.registerPlugin(name) : bridgePlugin(name))
  }
  return plugins.get(name)
}
