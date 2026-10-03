import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ROLE_LABELS, isOperator } from '../utils/roles'

// Navigation for gate staff. Each item appears only for roles that can use it.
const NAV = [
  { to: '/operator/dashboard', label: 'Dashboard' },
  { to: '/operator/entry', label: 'Vehicle Entry', permission: 'ENTRY_CREATE' },
  { to: '/operator/exit', label: 'Vehicle Exit', permission: 'EXIT_CREATE' },
  { to: '/operator/entries', label: 'Vehicles Inside' },
  { to: '/operator/collection', label: 'Collection', permission: 'PAYMENT_COLLECT' },
  { to: '/operator/vehicles', label: 'Vehicle Search' },
]

export default function OperatorLayout() {
  const { user, company, can, logout } = useAuth()
  const navigate = useNavigate()
  const links = NAV.filter((item) => !item.permission || can(item.permission))

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="no-print bg-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-lg font-bold">{company?.name || 'Smart Parking'}</p>
            <p className="text-xs text-slate-300">
              {user.name} · {ROLE_LABELS[user.role] || user.role}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!isOperator(user.role) && (
              <Link to="/dashboard" className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800">
                Admin dashboard
              </Link>
            )}
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Log out
          </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4" aria-label="Operator">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  isActive ? 'border-blue-400 text-white' : 'border-transparent text-slate-300 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
