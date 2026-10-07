import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { notificationApi } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { LiveProvider } from '../context/LiveProvider'
import { roleLabel, usesOperatorArea } from '../utils/roles'
import LiveBadge from '../components/operator/LiveBadge'
import AdminIcon from '../components/AdminIcon'

// The menu under the header. An item with `children` opens a drop-down; the others are plain links.
// Anything the signed-in person may not use is left out, and a drop-down with nothing left disappears.
const MENU = [
  { label: 'Dashboard', icon: 'dashboard', to: '/dashboard', end: true },
  { label: 'Reports', icon: 'chart', to: '/dashboard/reports', permission: 'REPORT_VIEW' },
  {
    label: 'Manage Locations', icon: 'pin',
    children: [
      { to: '/dashboard/locations', label: 'Parking Locations' },
      { to: '/dashboard/vehicles', label: 'Vehicles' },
      { to: '/dashboard/hardware', label: 'Hardware', permission: 'LOCATION_MANAGE' },
    ],
  },
  // Admins do not run the gates: that is the work of the operators an admin assigns. Supervisors and custom
  // roles that run gates keep the link.
  { label: 'Gate Operations', icon: 'gate', to: '/operator/dashboard', permission: 'ENTRY_CREATE', notFor: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'LOCATION_ADMIN'] },
  {
    label: 'Manage Users', icon: 'users',
    children: [
      { to: '/dashboard/users', label: 'Users', permission: 'USER_MANAGE' },
      { to: '/dashboard/roles', label: 'Roles', permission: 'ROLE_MANAGE' },
    ],
  },
  {
    label: 'Pass Management', icon: 'card',
    children: [
      { to: '/dashboard/passes', label: 'Monthly Passes', permission: 'PASS_MANAGE' },
      { to: '/dashboard/wallets', label: 'Wallets', permission: 'WALLET_MANAGE' },
    ],
  },
  { label: 'Manage Subscriptions', icon: 'calendar', to: '/dashboard/billing', permission: 'COMPANY_MANAGE', needsCompany: true },
  { label: 'My Orders', icon: 'cart', to: '/dashboard/orders', permission: 'COMPANY_MANAGE', needsCompany: true },
  {
    label: 'Setting', icon: 'gear',
    children: [
      { to: '/dashboard/company', label: 'Company', permission: 'COMPANY_MANAGE', needsCompany: true },
      { to: '/dashboard/audit', label: 'Audit Log', permission: 'COMPANY_MANAGE' },
    ],
  },
  {
    label: 'Platform', icon: 'globe',
    children: [
      { to: '/dashboard/website', label: 'Website', permission: 'PLATFORM_MANAGE' },
      { to: '/dashboard/shop', label: 'Hardware Shop', permission: 'PLATFORM_MANAGE' },
    ],
  },
]

const linkClass = ({ isActive }) => `admin-menu-link ${isActive ? 'is-active' : ''}`

// One menu entry: a link, or a button that opens its drop-down (click, Enter or Esc to close).
function MenuItem({ item, open, onToggle, onClose }) {
  const { pathname } = useLocation()
  if (!item.children) {
    return (
      <li>
        <NavLink to={item.to} end={item.end} className={linkClass} onClick={onClose}>
          <AdminIcon name={item.icon} />
          {item.label}
        </NavLink>
      </li>
    )
  }
  const inside = item.children.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`))
  return (
    <li className="relative">
      <button
        type="button"
        className={`admin-menu-link ${inside || open ? 'is-active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        <AdminIcon name={item.icon} />
        {item.label}
        <AdminIcon name="down" className="h-3 w-3" />
      </button>
      {open && (
        <ul className="admin-dropdown" role="menu">
          {item.children.map((child) => (
            <li key={child.to} role="none">
              <NavLink to={child.to} role="menuitem" className={({ isActive }) => `admin-dropdown-link ${isActive ? 'is-active' : ''}`} onClick={onClose}>
                {child.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function DashboardLayout() {
  const { user, company, can, logout, permissions } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [openMenu, setOpenMenu] = useState(null)
  const [mobile, setMobile] = useState(false)
  const [account, setAccount] = useState(false)
  const bar = useRef(null)
  const seesAlerts = can('LOCATION_MANAGE')
  const alerts = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationApi.list({ unread: 'true' }),
    enabled: seesAlerts,
    refetchInterval: 60_000,
  })
  const unread = alerts.data?.unreadCount || 0

  // Clicking elsewhere or pressing Esc closes any open drop-down.
  useEffect(() => {
    const away = (event) => {
      if (bar.current && !bar.current.contains(event.target)) {
        setOpenMenu(null)
        setAccount(false)
      }
    }
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpenMenu(null)
        setAccount(false)
      }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  const allowed = (item) => (!item.permission || can(item.permission)) && (!item.needsCompany || company) && !(item.notFor || []).includes(user.role)
  const menu = MENU.map((item) => {
    if (!item.children) return item
    const children = item.children.filter(allowed)
    // A drop-down with one choice is just that choice.
    return children.length === 1 ? { ...item, to: children[0].to, children: undefined } : { ...item, children }
  }).filter((item) => (item.children ? item.children.length > 0 : allowed(item)))

  const closeAll = () => {
    setOpenMenu(null)
    setMobile(false)
    setAccount(false)
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  // Gate staff have their own, simpler area.
  if (usesOperatorArea(user, permissions)) return <Navigate to="/operator/dashboard" replace />

  return (
    <LiveProvider>
    <div className="gate-skin admin-skin flex min-h-screen flex-col" data-path={pathname}>
      <header className="no-print admin-header" ref={bar}>
        <div className="admin-topbar">
          <Link to="/" className="admin-logo" aria-label="Smart Parking SaaS home">
            <span aria-hidden="true">P</span>
          </Link>
          <button type="button" className="admin-cell admin-burger" aria-label="Menu" aria-expanded={mobile} onClick={() => setMobile((v) => !v)}>
            <AdminIcon name="menu" className="h-5 w-5" />
          </button>
          <div className="admin-title">
            <Link to="/dashboard" className="admin-title-main">
              <span className="text-[#f08a24]">Smart</span> Parking
            </Link>
            <span className="admin-title-sub">{company?.name || 'Platform administration'}</span>
          </div>
          <div className="ml-auto flex items-stretch">
            <span className="hidden items-center px-3 sm:flex"><LiveBadge light /></span>
            {seesAlerts && (
              <Link to="/dashboard/notifications" className="admin-cell relative" aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'} onClick={closeAll}>
                <AdminIcon name="bell" className="h-6 w-6" />
                {unread > 0 && <span className="admin-count">{unread > 99 ? '99+' : unread}</span>}
              </Link>
            )}
            <div className="relative flex">
              <button type="button" className="admin-cell" aria-haspopup="true" aria-expanded={account} aria-label="My account" onClick={() => setAccount((v) => !v)}>
                <span className="admin-avatar"><AdminIcon name="user" className="h-5 w-5" /></span>
              </button>
              {account && (
                <div className="admin-dropdown admin-dropdown-right" role="menu">
                  <div className="border-b border-slate-200 px-4 py-2">
                    <p className="text-sm font-semibold text-[#1e3d73]">{user.name}</p>
                    <p className="text-xs text-slate-500">{roleLabel(user)}</p>
                  </div>
                  <Link to="/dashboard/account" role="menuitem" className="admin-dropdown-link" onClick={closeAll}>My account</Link>
                  <button type="button" role="menuitem" className="admin-dropdown-link w-full text-left" onClick={handleLogout}>Log out</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <nav aria-label="Main" className={`admin-menu ${mobile ? 'is-open' : ''}`}>
          <ul>
            {menu.map((item) => (
              <MenuItem
                key={item.label}
                item={item}
                open={openMenu === item.label}
                onToggle={() => setOpenMenu((current) => (current === item.label ? null : item.label))}
                onClose={closeAll}
              />
            ))}
          </ul>
        </nav>
      </header>

      <main className="admin-main mx-auto w-full max-w-[96rem] flex-1 px-3 py-4 sm:px-5">
        <Outlet />
      </main>

      <footer className="no-print admin-footer">
        © {new Date().getFullYear()} Smart Parking SaaS. All rights reserved.
        <button type="button" className="admin-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <AdminIcon name="up" className="h-4 w-4" />
        </button>
      </footer>
    </div>
    </LiveProvider>
  )
}
