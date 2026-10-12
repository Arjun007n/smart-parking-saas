import axios from 'axios'

const TOKEN_KEY = 'sp_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ''}/api`,
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = tokenStore.get()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// When the session is no longer valid, forget the token and go to login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthCall = error.config?.url?.startsWith('/auth/')
    if (error.response?.status === 401 && !isAuthCall && tokenStore.get()) {
      tokenStore.clear()
      window.location.assign(window.location.pathname.startsWith('/government') ? '/government/login' : '/login')
    }
    return Promise.reject(error)
  },
)

// Every API answer looks like { success, data }. These helpers return `data`.
const unwrap = (promise) => promise.then((res) => res.data.data)

export const authApi = {
  register: (body) => unwrap(api.post('/auth/register', body)),
  // body.portal: 'government' for the Government login page.
  login: (body) => unwrap(api.post('/auth/login', body)),
  me: () => unwrap(api.get('/auth/me')),
  logout: () => api.post('/auth/logout'),
  changePassword: (body) => unwrap(api.post('/auth/change-password', body)),
  updatePreferences: (body) => unwrap(api.put('/auth/preferences', body)),
  updateProfile: (body) => unwrap(api.put('/auth/profile', body)),
  forgotPassword: (body) => api.post('/auth/forgot-password', body).then((res) => res.data),
  resetPassword: (body) => api.post('/auth/reset-password', body).then((res) => res.data),
  // Does signup ask for a code sent to the mobile number? ({ otpRequired })
  signupOptions: () => unwrap(api.get('/auth/signup-options')),
  // Is this company code free? ({ code, available, reason? })
  checkCompanyCode: (code) => unwrap(api.get('/auth/company-code', { params: { code } })),
  sendOtp: (phone) => unwrap(api.post('/auth/otp/send', { phone })),
  verifyOtp: (phone, code) => unwrap(api.post('/auth/otp/verify', { phone, code })),
}

export const companyApi = {
  get: (id) => unwrap(api.get(`/companies/${id}`)),
  update: (id, body) => unwrap(api.put(`/companies/${id}`, body)),
  onboarding: (id) => unwrap(api.get(`/companies/${id}/onboarding`)),
  // The end-of-day report email.
  reportEmail: (id) => unwrap(api.get(`/companies/${id}/report-email`)),
  updateReportEmail: (id, body) => unwrap(api.put(`/companies/${id}/report-email`, body)),
  testReportEmail: (id) => unwrap(api.post(`/companies/${id}/report-email/test`)),
}

// Manage Subscriptions: one subscription per location, bought, renewed and extended with add-ons.
export const subscriptionApi = {
  catalog: () => unwrap(api.get('/subscriptions/catalog')),
  setPrices: (prices) => unwrap(api.put('/subscriptions/prices', { prices })),
  list: () => unwrap(api.get('/subscriptions')),
  location: (locationId) => unwrap(api.get(`/subscriptions/locations/${locationId}`)),
  get: (id) => unwrap(api.get(`/subscriptions/${id}`)),
  quote: (body) => unwrap(api.post('/subscriptions/quote', body)),
  createOrder: (body) => unwrap(api.post('/subscriptions/orders', body)),
  order: (id) => unwrap(api.get(`/subscriptions/orders/${id}`)),
  cancel: (id, reason) => unwrap(api.post(`/subscriptions/${id}/cancel`, { reason })),
}

// Dashboard > My Orders: subscription, earlier plan and hardware orders in one list.
export const myOrdersApi = {
  list: (params) => unwrap(api.get('/my-orders', { params })),
  all: (params) => unwrap(api.get('/my-orders/all', { params })),
}

// Buying a plan, and the invoices.
export const billingApi = {
  summary: () => unwrap(api.get('/billing')),
  checkout: (body) => unwrap(api.post('/billing/checkout', body)),
  order: (id) => unwrap(api.get(`/billing/orders/${id}`)),
  simulate: (id, outcome) => unwrap(api.post(`/billing/orders/${id}/simulate`, { outcome })),
  // Saves the invoice as a PDF (the request carries the login, so a plain link would not work).
  downloadInvoice: async (id, number) => {
    const res = await api.get(`/billing/invoices/${id}/pdf`, { responseType: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(res.data)
    link.download = `${String(number).replace(/[^A-Za-z0-9-]/g, '-')}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(link.href)
  },
}

// The hardware shop. The catalog and the cart price need no login; orders belong to a company.
const saveFile = (blob, name) => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}
export const shopApi = {
  info: () => unwrap(api.get('/shop/info')),
  products: () => unwrap(api.get('/shop/products')),
  // Prices a cart on the server: { lines, problems, goods, shippingFee, shippingGst, gst, total }
  priceCart: (items) => unwrap(api.post('/shop/cart', { items })),
  checkout: (body) => unwrap(api.post('/shop/checkout', body)),
  orders: () => unwrap(api.get('/shop/orders')),
  order: (id) => unwrap(api.get(`/shop/orders/${id}`)),
  cancelOrder: (id) => unwrap(api.post(`/shop/orders/${id}/cancel`)),
  simulate: (id, outcome) => unwrap(api.post(`/shop/orders/${id}/simulate`, { outcome })),
  downloadInvoice: async (id, number) => {
    const res = await api.get(`/billing/invoices/${id}/pdf`, { responseType: 'blob' })
    saveFile(res.data, `${String(number).replace(/[^A-Za-z0-9-]/g, '-')}.pdf`)
  },
  // Platform (Super Admin)
  adminProducts: () => unwrap(api.get('/shop/admin/products')),
  adminImportStarter: () => unwrap(api.post('/shop/admin/products/import-starter')),
  adminCreateProduct: (body) => unwrap(api.post('/shop/admin/products', body)),
  adminUpdateProduct: (id, body) => unwrap(api.put(`/shop/admin/products/${id}`, body)),
  adminOrders: (params) => unwrap(api.get('/shop/admin/orders', { params })),
  adminSetFulfilment: (id, body) => unwrap(api.put(`/shop/admin/orders/${id}/fulfilment`, body)),
}

export const locationApi = {
  list: () => unwrap(api.get('/locations')),
  get: (id) => unwrap(api.get(`/locations/${id}`)),
  create: (body) => unwrap(api.post('/locations', body)),
  update: (id, body) => unwrap(api.put(`/locations/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/locations/${id}`)),
  // The table as a file: format 'xlsx' | 'csv' | 'pdf'.
  download: (format = 'xlsx') => downloadFile('/locations/export', {}, `parking-locations.${format}`, format),
  // Applies one vehicle type's auto exit rule now.
  runAutoExit: (id, vehicleType) => unwrap(api.post(`/locations/${id}/auto-exit/run`, { vehicleType })),
  // The Lanes tab: lanes with their operators and devices; params { q, page, limit }.
  lanes: (id, params) => unwrap(api.get(`/locations/${id}/lanes`, { params })),
  // The Create / Edit Parking Lane form: one lane is one vehicle going one way.
  createLane: (id, body) => unwrap(api.post(`/locations/${id}/lanes`, body)),
  updateLane: (id, laneId, body) => unwrap(api.put(`/locations/${id}/lanes/${laneId}`, body)),
  // Switches one lane on or off.
  setLaneStatus: (id, laneId, isActive) => unwrap(api.patch(`/locations/${id}/lanes/${laneId}/status`, { isActive })),
}

export const userApi = {
  list: () => unwrap(api.get('/users')),
  create: (body) => unwrap(api.post('/users', body)),
  update: (id, body) => unwrap(api.put(`/users/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/users/${id}`)),
  // The Users table as a file: format 'xlsx' | 'csv' | 'pdf'.
  download: (format = 'xlsx') => downloadFile('/users/export', {}, `users.${format}`, format),
  // Seats per location: limit, in use, valid upto.
  licences: () => unwrap(api.get('/users/licences')),
  setLicence: (locationId, limit) => unwrap(api.put(`/users/licences/${locationId}`, { limit })),
}

export const roleApi = {
  list: () => unwrap(api.get('/roles')),
  catalog: () => unwrap(api.get('/roles/catalog')),
  create: (body) => unwrap(api.post('/roles', body)),
  update: (id, body) => unwrap(api.put(`/roles/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/roles/${id}`)),
}

export const slotApi = {
  list: (locationId) => unwrap(api.get('/slots', { params: { locationId } })),
  create: (body) => unwrap(api.post('/slots', body)),
  createBulk: (body) => unwrap(api.post('/slots/bulk', body)),
  update: (id, body) => unwrap(api.put(`/slots/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/slots/${id}`)),
}

export const vehicleApi = {
  list: (params) => unwrap(api.get('/vehicles', { params })),
  create: (body) => unwrap(api.post('/vehicles', body)),
  update: (id, body) => unwrap(api.put(`/vehicles/${id}`, body)),
}

export const tariffApi = {
  list: (locationId) => unwrap(api.get('/tariffs', { params: { locationId } })),
  create: (body) => unwrap(api.post('/tariffs', body)),
  update: (id, body) => unwrap(api.put(`/tariffs/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/tariffs/${id}`)),
  preview: (body) => unwrap(api.post('/tariffs/preview', body)),
}

export const parkingApi = {
  entry: (body) => unwrap(api.post('/parking/entry', body)),
  entries: (params) => unwrap(api.get('/parking/entries', { params })),
  exit: (body) => unwrap(api.post('/parking/exit', body)),
  exits: (params) => unwrap(api.get('/parking/exits', { params })),
  receipt: (id) => unwrap(api.get(`/parking/sessions/${id}/receipt`)),
  session: (id) => unwrap(api.get(`/parking/sessions/${id}`)),
  // Counts a ticket printed again from the browser (the collection report shows reprints per operator).
  reprint: (id) => unwrap(api.post(`/parking/sessions/${id}/reprint`)),
  // Vehicle photos. The upload body is the picture itself.
  uploadPhoto: (id, blob, kind) =>
    unwrap(api.post(`/parking/sessions/${id}/photos`, blob, { params: { kind }, headers: { 'Content-Type': blob.type }, timeout: 30000 })),
  photo: (id, photoId) => api.get(`/parking/sessions/${id}/photos/${photoId}`, { responseType: 'blob' }).then((res) => res.data),
  deletePhoto: (id, photoId) => unwrap(api.delete(`/parking/sessions/${id}/photos/${photoId}`)),
  cancel: (id, reason) => unwrap(api.post(`/parking/sessions/${id}/cancel`, { reason })),
  override: (id, reason) => unwrap(api.post(`/parking/sessions/${id}/override`, { reason })),
  // Ask the gate barrier / thermal printer again for a vehicle that was just cleared.
  barrier: (id) => unwrap(api.post(`/parking/sessions/${id}/barrier`)),
  // "Open barrier": lift a gate's barrier by hand, with no ticket behind it. ({ locationId, direction, gate?, reason? })
  openBarrier: (body) => unwrap(api.post('/parking/barrier', body)),
  print: (id) => unwrap(api.post(`/parking/sessions/${id}/print`)),
  // Cancel an inside ticket and issue a new one in one step. ({ gate?, vehicleType? })
  reEntry: (id, body = {}) => unwrap(api.post(`/parking/sessions/${id}/re-entry`, body)),
}

export const paymentApi = {
  create: (body) => unwrap(api.post('/payments', body)),
  // Is online payment set up? ({ online, provider, simulated })
  options: () => unwrap(api.get('/payments/options')),
  get: (id) => unwrap(api.get(`/payments/${id}`)),
  cancel: (id) => unwrap(api.post(`/payments/${id}/cancel`)),
  // Development only: play the customer's side of an online payment.
  simulate: (id, outcome) => unwrap(api.post(`/payments/${id}/simulate`, { outcome })),
  collection: (params) => unwrap(api.get('/payments/collection', { params })),
}

// Monthly passes.
export const passApi = {
  list: (params) => unwrap(api.get('/passes', { params })),
  get: (id) => unwrap(api.get(`/passes/${id}`)),
  create: (body) => unwrap(api.post('/passes', body)),
  update: (id, body) => unwrap(api.put(`/passes/${id}`, body)),
  renew: (id, body) => unwrap(api.post(`/passes/${id}/renew`, body)),
  suspend: (id, reason) => unwrap(api.post(`/passes/${id}/suspend`, { reason })),
  resume: (id) => unwrap(api.post(`/passes/${id}/resume`)),
  cancel: (id, reason) => unwrap(api.post(`/passes/${id}/cancel`, { reason })),
  addVehicle: (id, body) => unwrap(api.post(`/passes/${id}/vehicles`, body)),
  removeVehicle: (id, body) => unwrap(api.post(`/passes/${id}/vehicles/remove`, body)),
  replaceVehicle: (id, body) => unwrap(api.post(`/passes/${id}/vehicles/replace`, body)),
  // Gives a vehicle its UHF / RFID tag (an empty tag removes it).
  setVehicleTag: (id, body) => unwrap(api.put(`/passes/${id}/vehicles/tag`, body)),
  // For gate staff: does this vehicle have a pass, and is it good at this location?
  lookup: (params) => unwrap(api.get('/passes/lookup', { params })),
  // The numbers above the pass list, every vehicle on a pass, pass receipts, and changing several passes at once.
  summary: () => unwrap(api.get('/passes/summary')),
  vehicles: (params) => unwrap(api.get('/passes/vehicles', { params })),
  invoices: (params) => unwrap(api.get('/passes/invoices', { params })),
  downloadInvoices: (params, format) => downloadFile('/passes/invoices', params, `pass-receipts.${format}`, format),
  downloadVehicles: (params, format) => downloadFile('/passes/vehicles', params, `pass-vehicles.${format}`, format),
  bulk: (body) => unwrap(api.post('/passes/bulk', body)),
  // Pass users (the people who hold passes) and selling many passes from a CSV file.
  users: (params) => unwrap(api.get('/passes/users', { params })),
  downloadUsers: (params, format) => downloadFile('/passes/users', params, `pass-users.${format}`, format),
  bulkUpload: (body) => unwrap(api.post('/passes/bulk-upload', body)),
  // The pass list as a file, the Approved / Pending switch, and deleting passes made by mistake.
  downloadList: (params, format) => downloadFile('/passes', params, `passes.${format}`, format),
  setApproval: (id, approval) => unwrap(api.patch(`/passes/${id}/approval`, { approval })),
  remove: (id) => unwrap(api.delete(`/passes/${id}`)),
  removeMany: (ids) => unwrap(api.post('/passes/delete', { ids })),
}

// Pass Management > Pass Users: the people who hold passes, their vehicles, and the Create Pass form.
export const passUserApi = {
  stats: () => unwrap(api.get('/pass-users/stats')),
  list: (params) => unwrap(api.get('/pass-users', { params })),
  download: (params, format) => downloadFile('/pass-users', params, `pass-users.${format}`, format),
  options: () => unwrap(api.get('/pass-users/options')),
  create: (body) => unwrap(api.post('/pass-users', body)),
  get: (id) => unwrap(api.get(`/pass-users/${id}`)),
  update: (id, body) => unwrap(api.put(`/pass-users/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/pass-users/${id}`)),
  addVehicle: (id, body) => unwrap(api.post(`/pass-users/${id}/vehicles`, body)),
  updateVehicle: (id, vehicleId, body) => unwrap(api.put(`/pass-users/${id}/vehicles/${vehicleId}`, body)),
  // Create / Renew Pass for one of the user's vehicles.
  savePass: (id, body) => unwrap(api.post(`/pass-users/${id}/passes`, body)),
  // The Vehicle List page.
  vehicles: (params) => unwrap(api.get('/pass-users/vehicles', { params })),
  downloadVehicles: (params, format) => downloadFile('/pass-users/vehicles', params, `pass-vehicle-list.${format}`, format),
}

// Pass Management > Manage Invoice: GST invoices made from approved passes.
export const passInvoiceApi = {
  list: (params) => unwrap(api.get('/pass-invoices', { params })),
  download: (params, format) => downloadFile('/pass-invoices', params, `pass-invoices.${format}`, format),
  eligible: (params) => unwrap(api.get('/pass-invoices/eligible', { params })),
  preview: (body) => unwrap(api.post('/pass-invoices/preview', body)),
  generate: (body) => unwrap(api.post('/pass-invoices', body)),
  get: (id) => unwrap(api.get(`/pass-invoices/${id}`)),
}

// Firms, societies and schools that buy passes for their people.
export const passCompanyApi = {
  list: (params) => unwrap(api.get('/pass-companies', { params })),
  create: (body) => unwrap(api.post('/pass-companies', body)),
  update: (id, body) => unwrap(api.put(`/pass-companies/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/pass-companies/${id}`)),
}

// The Pass Charges table: monthly and daily price per location and vehicle type; `quote` works out a pass's total.
export const passChargeApi = {
  list: () => unwrap(api.get('/pass-charges')),
  save: (body) => unwrap(api.post('/pass-charges', body)),
  remove: (id) => unwrap(api.delete(`/pass-charges/${id}`)),
  quote: (params) => unwrap(api.get('/pass-charges/quote', { params })),
}

export const walletApi = {
  list: (params) => unwrap(api.get('/wallets', { params })),
  get: (id) => unwrap(api.get(`/wallets/${id}`)),
  transactions: (id, params) => unwrap(api.get(`/wallets/${id}/transactions`, { params })),
  // Gate staff: find a wallet by number, vehicle or phone. Returns { wallet } (null when none).
  lookup: (params) => unwrap(api.get('/wallets/lookup', { params })),
  create: (body) => unwrap(api.post('/wallets', body)),
  update: (id, body) => unwrap(api.put(`/wallets/${id}`, body)),
  topUp: (id, body) => unwrap(api.post(`/wallets/${id}/topup`, body)),
  adjust: (id, body) => unwrap(api.post(`/wallets/${id}/adjust`, body)),
  verify: (id) => unwrap(api.get(`/wallets/${id}/verify`)),
}

export const shiftApi = {
  current: () => unwrap(api.get('/shifts/current')),
  list: (params) => unwrap(api.get('/shifts', { params })),
  open: (body) => unwrap(api.post('/shifts', body)),
  close: (id, body) => unwrap(api.post(`/shifts/${id}/close`, body)),
  adjust: (id, body) => unwrap(api.post(`/shifts/${id}/adjustments`, body)),
}

// Gate hardware: devices, their commands, and camera plate suggestions.
export const hardwareApi = {
  list: (params) => unwrap(api.get('/hardware', { params })),
  get: (id) => unwrap(api.get(`/hardware/${id}`)),
  create: (body) => unwrap(api.post('/hardware', body)),
  update: (id, body) => unwrap(api.put(`/hardware/${id}`, body)),
  rotateKey: (id) => unwrap(api.post(`/hardware/${id}/rotate-key`)),
  send: (id, body) => unwrap(api.post(`/hardware/${id}/commands`, body)),
  command: (id) => unwrap(api.get(`/hardware/commands/${id}`)),
  agentInfo: () => unwrap(api.get('/hardware/agent-package/info')),
  // Saves gate-agent.zip (the agent with this server's address already in its config).
  downloadAgent: async () => {
    const res = await api.get('/hardware/agent-package', { responseType: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(res.data)
    link.download = 'gate-agent.zip'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(link.href)
  },
}

export const anprApi = {
  list: (params) => unwrap(api.get('/anpr', { params })),
  dismiss: (id) => unwrap(api.post(`/anpr/${id}/dismiss`)),
  // The live picture address of the camera at a gate ({ previewUrl, camera }; previewUrl is null when there is none).
  preview: (params) => unwrap(api.get('/anpr/preview', { params })),
}

export const dashboardApi = {
  get: (params) => unwrap(api.get('/dashboard', { params })),
}

// Downloads a file answer (CSV, Excel or PDF). The request carries the login
// token, so a plain link would not work.
async function downloadFile(url, params, fallbackName, format = 'csv') {
  const res = await api.get(url, { params: { ...params, format }, responseType: 'blob' })
  const match = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(res.data)
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}

export const operatorApi = {
  summary: (params) => unwrap(api.get('/operator/summary', { params })),
  collection: (params) => unwrap(api.get('/operator/collection', { params })),
  entries: (params) => unwrap(api.get('/operator/entries', { params })),
  exits: (params) => unwrap(api.get('/operator/exits', { params })),
  // kind: 'entries' | 'exits' | 'collection'; format: 'xlsx' | 'csv' | 'pdf'
  download: (kind, params, format = 'xlsx') => downloadFile(`/operator/${kind}`, params, `${kind}.${format}`, format),
}

// The government officer's reports: entries and exits, with vehicle numbers and no money.
export const governmentApi = {
  locations: () => unwrap(api.get('/government/locations')),
  summary: (params) => unwrap(api.get('/government/summary', { params })),
  movements: (params) => unwrap(api.get('/government/movements', { params })),
  // format: 'xlsx' | 'csv' | 'pdf'
  download: (params, format = 'xlsx') => downloadFile('/government/movements', params, `vehicle-movements.${format}`, format),
}

export const bookingApi = {
  list: (params) => unwrap(api.get('/bookings', { params })),
  create: (body) => unwrap(api.post('/bookings', body)),
  cancel: (id, reason) => unwrap(api.post(`/bookings/${id}/cancel`, reason ? { reason } : {})),
}

// The public booking page: no login, and the booking's secret token travels as ?token=.
export const publicBookingApi = {
  locations: () => unwrap(api.get('/public/booking/locations')),
  location: (id) => unwrap(api.get(`/public/booking/locations/${id}`)),
  create: (body) => unwrap(api.post('/public/booking/bookings', body)),
  get: (id, token) => unwrap(api.get(`/public/booking/bookings/${id}`, { params: { token } })),
  cancel: (id, token) => unwrap(api.post(`/public/booking/bookings/${id}/cancel`, {}, { params: { token } })),
  simulate: (id, token, outcome) => unwrap(api.post(`/public/booking/bookings/${id}/simulate`, { outcome }, { params: { token } })),
}

export const reportApi = {
  periods: () => unwrap(api.get('/reports/periods')),
  get: (name, params) => unwrap(api.get(`/reports/${name}`, { params })),
  // format: 'csv' | 'xlsx' | 'pdf'
  download: (name, params, format = 'csv') => downloadFile(`/reports/${name}`, params, `${name}.${format}`, format),
}

export const auditApi = {
  list: (params) => unwrap(api.get('/audit-logs', { params })),
  download: (params) => downloadFile('/audit-logs', params, 'audit.csv'),
}

export const notificationApi = {
  list: (params) => unwrap(api.get('/notifications', { params })),
  markRead: (body) => unwrap(api.post('/notifications/read', body)),
}

// Public website: enquiries, FAQ and blog.
export const leadApi = {
  create: (body) => api.post('/leads', body).then((res) => res.data),
  list: (params) => unwrap(api.get('/leads', { params })),
  update: (id, body) => unwrap(api.put(`/leads/${id}`, body)),
}

export const faqApi = {
  list: () => unwrap(api.get('/faq')),
  listAll: () => unwrap(api.get('/faq/all')),
  create: (body) => unwrap(api.post('/faq', body)),
  update: (id, body) => unwrap(api.put(`/faq/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/faq/${id}`)),
}

export const testimonialApi = {
  list: () => unwrap(api.get('/testimonials')),
  listAll: () => unwrap(api.get('/testimonials/all')),
  create: (body) => unwrap(api.post('/testimonials', body)),
  update: (id, body) => unwrap(api.put(`/testimonials/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/testimonials/${id}`)),
}

// Real figures for the home page (open locations, vehicles in the last 30 days).
export const statsApi = {
  get: () => unwrap(api.get('/public/stats')),
}

export const blogApi = {
  list: (params) => unwrap(api.get('/blog', { params })),
  get: (slug) => unwrap(api.get(`/blog/${encodeURIComponent(slug)}`)),
  listAll: () => unwrap(api.get('/blog/admin/all')),
  create: (body) => unwrap(api.post('/blog', body)),
  update: (id, body) => unwrap(api.put(`/blog/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/blog/${id}`)),
}

export default api
