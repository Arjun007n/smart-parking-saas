// The shopping cart: a list of { productId, qty } kept in this browser (localStorage), so it survives a
// reload and a login. Only ids and counts are kept here; prices always come from the server.
const KEY = 'sp_cart'
const MAX_LINES = 15

const valid = (item) =>
  item && typeof item.productId === 'string' && /^[0-9a-f]{24}$/i.test(item.productId) && Number.isInteger(item.qty) && item.qty >= 1 && item.qty <= 100

const read = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(stored) ? stored.filter(valid).slice(0, MAX_LINES) : []
  } catch {
    return []
  }
}

let items = read()
const listeners = new Set()

const commit = (next) => {
  items = next
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // Private windows can refuse storage: the cart still works until the page closes.
  }
  listeners.forEach((listener) => listener())
}

// Another tab changed the cart.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) {
      items = read()
      listeners.forEach((listener) => listener())
    }
  })
}

export const cartStore = {
  // The same array until the cart changes (React needs that).
  getItems: () => items,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  // Returns false when the cart already holds as many different products as an order allows.
  add: (productId, qty = 1) => {
    const found = items.find((item) => item.productId === productId)
    if (!found && items.length >= MAX_LINES) return false
    commit(found ? items.map((item) => (item.productId === productId ? { ...item, qty: Math.min(100, item.qty + qty) } : item)) : [...items, { productId, qty }])
    return true
  },
  setQty: (productId, qty) => {
    if (!Number.isInteger(qty) || qty < 1) return
    commit(items.map((item) => (item.productId === productId ? { ...item, qty: Math.min(100, qty) } : item)))
  },
  remove: (productId) => commit(items.filter((item) => item.productId !== productId)),
  clear: () => commit([]),
  MAX_LINES,
}
