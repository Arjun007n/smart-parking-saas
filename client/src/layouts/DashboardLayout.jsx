import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { notificationApi } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS, isOperator } from '../utils/roles'

const NAV = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/locations', label: 'Parking Locations' },
  { to: '/dashboard/vehicles', label: 'Vehicles' },
  { to: '/operator/dashboard', label: 'Gate Operations', permission: 'ENTRY_CREATE' },
  { to: '/dashboard/reports', label: 'Reports', permission: 'REPORT_VIEW' },
  { to: '/dashboard/users', label: 'Users', permission: 'USER_MANAGE' },
  { to: '/dashboard/company', label: 'Company', permission: 'COMPANY_MANAGE', needsCompany: true },
  { to: '/dashboard/audit', label: 'Audit Log', permission: 'COMPANY_MANAGE' },
  { to: '/dashboard/website', label: 'Website', permission: 'PLATFORM_MANAGE' },
]

export default function DashboardLayout() {
  const { user, company, can, logout } = useAuth()
  const navigate = useNavigate()
  const seesAlerts = can('LOCATION_MANAGE')
  const alerts = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationApi.list({ unread: 'true' }),
    enabled: seesAlerts,
    refetchInterval: 60_000,
  })
  const unread = alerts.data?.unreadCount || 0

  const links = NAV.filter(
    (item) => (!item.permission || can(item.permission)) && (!item.needsCompany || company),
  )

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Gate staff have their own, simpler area.
  if (isOperator(user.role)) return <Navigate to="/operator/dashboard" replace />

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="no-print bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div>
            <Link to="/" className="text-lg font-bold hover:underline">Smart Parking SaaS</Link>
            <p className="text-xs text-slate-300">{company?.name || 'Platform administration'}</p>
          </div>
          <div className="flex items-center gap-4">
            {seesAlerts && (
              <Link
                to="/dashboard/notifications"
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
              >
                Notifications
                {unread > 0 && (
                  <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            )}
            <div className="text-right text-sm">
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-slate-300">{ROLE_LABELS[user.role] || user.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-8" aria-label="Main">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  isActive
                    ? 'border-blue-400 text-white'
                    : 'border-transparent text-slate-300 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
