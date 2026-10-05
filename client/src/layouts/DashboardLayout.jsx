import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { notificationApi } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { LiveProvider } from '../context/LiveProvider'
import { roleLabel, usesOperatorArea } from '../utils/roles'
import LiveBadge from '../components/operator/LiveBadge'

const NAV = [
  { to: '/dashboard', label: 'Overview', end: true },
  { to: '/dashboard/locations', label: 'Parking Locations' },
  { to: '/dashboard/vehicles', label: 'Vehicles' },
  { to: '/operator/dashboard', label: 'Gate Operations', permission: 'ENTRY_CREATE' },
  { to: '/dashboard/passes', label: 'Monthly Passes', permission: 'PASS_MANAGE' },
  { to: '/dashboard/wallets', label: 'Wallets', permission: 'WALLET_MANAGE' },
  { to: '/dashboard/hardware', label: 'Hardware', permission: 'LOCATION_MANAGE' },
  { to: '/dashboard/reports', label: 'Reports', permission: 'REPORT_VIEW' },
  { to: '/dashboard/users', label: 'Users', permission: 'USER_MANAGE' },
  { to: '/dashboard/roles', label: 'Roles', permission: 'ROLE_MANAGE' },
  { to: '/dashboard/company', label: 'Company', permission: 'COMPANY_MANAGE', needsCompany: true },
  { to: '/dashboard/billing', label: 'Billing', permission: 'COMPANY_MANAGE', needsCompany: true },
  { to: '/dashboard/orders', label: 'My Orders', permission: 'COMPANY_MANAGE', needsCompany: true },
  { to: '/dashboard/audit', label: 'Audit Log', permission: 'COMPANY_MANAGE' },
  { to: '/dashboard/website', label: 'Website', permission: 'PLATFORM_MANAGE' },
  { to: '/dashboard/shop', label: 'Hardware Shop', permission: 'PLATFORM_MANAGE' },
]

export default function DashboardLayout() {
  const { user, company, can, logout, permissions } = useAuth()
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
  if (usesOperatorArea(user, permissions)) return <Navigate to="/operator/dashboard" replace />

  return (
    <LiveProvider>
    <div className="gate-skin min-h-screen bg-[#f4f6fb]">
      <header className="no-print border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div>
            <Link to="/" className="flex items-center gap-2 text-lg font-extrabold text-[#1e3d73]">
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#007bff] to-[#0056b3] text-lg font-extrabold text-white">P</span>
              Smart Parking SaaS
            </Link>
            <p className="ml-11 -mt-1 text-xs text-slate-500">{company?.name || 'Platform administration'}</p>
          </div>
          <div className="flex items-center gap-4">
            <LiveBadge light />
            {seesAlerts && (
              <Link
                to="/dashboard/notifications"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-[#1e3d73] hover:bg-slate-50"
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
            <Link to="/dashboard/account" className="text-right text-sm text-[#1e3d73] hover:underline">
              <span className="block font-medium">{user.name}</span>
              <span className="block text-xs text-slate-500">{roleLabel(user)} · My account</span>
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-[#1e3d73] hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-1 sm:px-8" aria-label="Main">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `my-1 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${
                  isActive ? 'bg-[#007bff] text-white shadow' : 'text-[#1e3d73] hover:bg-slate-100'
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
    </LiveProvider>
  )
}
