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
      window.location.assign('/login')
    }
    return Promise.reject(error)
  },
)

// Every API answer looks like { success, data }. These helpers return `data`.
const unwrap = (promise) => promise.then((res) => res.data.data)

export const authApi = {
  register: (body) => unwrap(api.post('/auth/register', body)),
  login: (body) => unwrap(api.post('/auth/login', body)),
  me: () => unwrap(api.get('/auth/me')),
  logout: () => api.post('/auth/logout'),
  forgotPassword: (body) => api.post('/auth/forgot-password', body).then((res) => res.data),
  resetPassword: (body) => api.post('/auth/reset-password', body).then((res) => res.data),
}

export const companyApi = {
  get: (id) => unwrap(api.get(`/companies/${id}`)),
  update: (id, body) => unwrap(api.put(`/companies/${id}`, body)),
  onboarding: (id) => unwrap(api.get(`/companies/${id}/onboarding`)),
}

export const locationApi = {
  list: () => unwrap(api.get('/locations')),
  get: (id) => unwrap(api.get(`/locations/${id}`)),
  create: (body) => unwrap(api.post('/locations', body)),
  update: (id, body) => unwrap(api.put(`/locations/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/locations/${id}`)),
}

export const userApi = {
  list: () => unwrap(api.get('/users')),
  create: (body) => unwrap(api.post('/users', body)),
  update: (id, body) => unwrap(api.put(`/users/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/users/${id}`)),
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
  cancel: (id, reason) => unwrap(api.post(`/parking/sessions/${id}/cancel`, { reason })),
  override: (id, reason) => unwrap(api.post(`/parking/sessions/${id}/override`, { reason })),
}

export const paymentApi = {
  create: (body) => unwrap(api.post('/payments', body)),
  refund: (id, reason) => unwrap(api.post(`/payments/${id}/refund`, { reason })),
  collection: (params) => unwrap(api.get('/payments/collection', { params })),
}

export const shiftApi = {
  current: () => unwrap(api.get('/shifts/current')),
  list: (params) => unwrap(api.get('/shifts', { params })),
  open: (body) => unwrap(api.post('/shifts', body)),
  close: (id, body) => unwrap(api.post(`/shifts/${id}/close`, body)),
  adjust: (id, body) => unwrap(api.post(`/shifts/${id}/adjustments`, body)),
}

export const dashboardApi = {
  get: (params) => unwrap(api.get('/dashboard', { params })),
}

// Downloads a CSV answer as a file. The request carries the login token, so
// a plain link would not work.
async function downloadCsv(url, params, fallbackName) {
  const res = await api.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' })
  const match = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(res.data)
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}

export const reportApi = {
  get: (name, params) => unwrap(api.get(`/reports/${name}`, { params })),
  download: (name, params) => downloadCsv(`/reports/${name}`, params, `${name}.csv`),
}

export const auditApi = {
  list: (params) => unwrap(api.get('/audit-logs', { params })),
  download: (params) => downloadCsv('/audit-logs', params, 'audit.csv'),
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

export const blogApi = {
  list: (params) => unwrap(api.get('/blog', { params })),
  get: (slug) => unwrap(api.get(`/blog/${encodeURIComponent(slug)}`)),
  listAll: () => unwrap(api.get('/blog/admin/all')),
  create: (body) => unwrap(api.post('/blog', body)),
  update: (id, body) => unwrap(api.put(`/blog/${id}`, body)),
  remove: (id) => unwrap(api.delete(`/blog/${id}`)),
}

export default api
