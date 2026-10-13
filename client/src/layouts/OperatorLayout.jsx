import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useBookings } from '../hooks/useBookings'
import { isLightColor, useTheme } from '../hooks/useTheme'
import { useToast } from '../hooks/useToast'
import { useShortcuts } from '../hooks/useShortcuts'
import { playCue, setSoundEnabled, soundEnabled } from '../utils/sound'
import { justActedLocally } from '../utils/localAction'
import { LiveProvider } from '../context/LiveProvider'
import BookingsModal from '../components/operator/BookingsModal'
import ThemeCustomizer from '../components/operator/ThemeCustomizer'
import LiveBadge from '../components/operator/LiveBadge'
import ShortcutHelp from '../components/operator/ShortcutHelp'
import AgentDownloadMenu from '../components/operator/AgentDownloadMenu'
import { roleLabel, usesOperatorArea } from '../utils/roles'
import { CarIcon, EnterIcon, ExitIcon, HomeIcon, UserIcon } from '../components/operator/icons'

// Navigation for gate staff. Each item appears only for roles that can use it.
// `kind` is the colour of the pill: Entry is green and Exit is red until they are the page you are on.
const NAV = [
  { to: '/operator/dashboard', label: 'Home', icon: HomeIcon },
  { to: '/operator/entry', label: 'Entry', permission: 'ENTRY_CREATE', kind: 'entry', icon: EnterIcon },
  { to: '/operator/exit', label: 'Exit', permission: 'EXIT_CREATE', kind: 'exit', icon: ExitIcon },
  { to: '/operator/entry-list', label: 'Entry List' },
  { to: '/operator/exit-list', label: 'Exit List' },
  { to: '/operator/collection', label: 'Collection', permission: 'PAYMENT_COLLECT' },
  { to: '/operator/wallets', label: 'Wallets', permission: 'PAYMENT_COLLECT' },
  // Supervisors (anyone who is not limited to the gate screens) go on to the reports.
  { to: '/dashboard/reports', label: 'Reports', permission: 'REPORT_VIEW', dashboard: true },
]
// Less used pages sit under "More".
const MORE = [
  { to: '/operator/entries', label: 'Vehicles Inside' },
  { to: '/operator/vehicles', label: 'Vehicle Search' },
]

const pill = (item, isActive, compact) => {
  const size = compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
  const shape = `flex items-center gap-1.5 whitespace-nowrap rounded-lg font-bold transition ${size}`
  if (isActive) return `${shape} bg-[#007bff] text-white shadow`
  if (item.kind === 'entry') return `${shape} gate-btn-entry text-white shadow`
  if (item.kind === 'exit') return `${shape} gate-btn-exit text-white shadow`
  return `${shape} text-[#1e3d73] hover:bg-slate-100`
}

export default function OperatorLayout() {
  const { user, company, can, logout, permissions } = useAuth()
  const navigate = useNavigate()
  const links = NAV.filter(
    (item) => (!item.permission || can(item.permission)) && (!item.dashboard || !usesOperatorArea(user, permissions)),
  )
  const { theme, setTheme, reset } = useTheme()
  const [panel, setPanel] = useState('') // '', 'theme', 'bookings' or 'help'
  const [menu, setMenu] = useState('') // '', 'more' or 'profile'
  // Where the More list opens (under its button). The bar scrolls sideways and would clip a list placed inside it,
  // so the list is placed on the page itself.
  const [morePlace, setMorePlace] = useState({ left: 0, top: 0 })
  const { bookings } = useBookings('all')
  const toast = useToast()
  const [sound, setSound] = useState(soundEnabled)

  // What happened at the gates, as a pop-up and a short sound. The server only says that something
  // happened (no plate numbers), so the message is general; the lists refresh by themselves.
  const onLiveEvent = (type, data) => {
    if (justActedLocally()) return // this screen already told the person
    if (type === 'entry') {
      toast({ title: 'Vehicle entered', message: data?.gate ? `Gate: ${data.gate}` : undefined, tone: 'success' })
      playCue('entry')
    } else if (type === 'exit') {
      toast({ title: 'Vehicle left', message: data?.gate ? `Gate: ${data.gate}` : undefined, tone: 'info' })
      playCue('exit')
    } else if (type === 'payment') {
      const ok = data?.status === 'SUCCESS'
      toast({ title: ok ? 'Online payment received' : 'Online payment failed', tone: ok ? 'success' : 'error' })
      playCue(ok ? 'success' : 'error')
    }
  }

  const go = (can_, path) => () => (can_ ? navigate(path) : false)
  useShortcuts({
    F2: go(can('ENTRY_CREATE'), '/operator/entry'),
    F4: go(can('EXIT_CREATE'), '/operator/exit'),
    F6: go(true, '/operator/dashboard'),
    'Alt+b': () => setPanel('bookings'),
    '?': () => setPanel('help'),
    Escape: () => (panel ? setPanel('') : false),
    '/': () => {
      const box = document.querySelector('[data-plate-box]')
      if (!box) return false
      box.focus()
      return true
    },
  })

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    setSoundEnabled(next)
    if (next) playCue('success')
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const light = isLightColor(theme.color)
  const ink = light ? 'text-[#1e3d73]' : 'text-white'
  const closeMenu = () => setMenu('')
  const menuItem = 'block w-full px-4 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100'

  return (
    <LiveProvider onLiveEvent={onLiveEvent}>
    <div className={`gate-skin min-h-screen bg-[#f4f6fb] ${theme.style === 'dark' ? 'theme-dark' : ''}`}>
      <header className="no-print relative border-b border-slate-200 shadow-sm" style={{ backgroundColor: theme.color }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link to="/operator/dashboard" className={`flex items-center gap-2 ${ink}`}>
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#007bff] to-[#0056b3] text-lg font-extrabold text-white">P</span>
            <span className="leading-tight">
              <span className="block text-sm font-extrabold">{company?.name || 'Smart Parking'}</span>
              <span className="block text-[11px] font-medium opacity-70">{user.name} · {roleLabel(user)}</span>
            </span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Operator">
            {links.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => pill(item, isActive, theme.compact)}>
                {item.icon && <item.icon />}
                {item.label}
              </NavLink>
            ))}
            <div className="relative">
              <button
                type="button"
                aria-expanded={menu === 'more'}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  setMorePlace({ left: Math.max(8, Math.min(box.left, window.innerWidth - 200)), top: box.bottom + 4 })
                  setMenu(menu === 'more' ? '' : 'more')
                }}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-slate-100/20 ${ink}`}
              >
                More <span aria-hidden="true">▾</span>
              </button>
              {menu === 'more' && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={closeMenu} />
                  <div style={{ left: morePlace.left, top: morePlace.top }} className="fixed z-30 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
                    {MORE.map((item) => (
                      <NavLink key={item.to} to={item.to} onClick={closeMenu} className={menuItem}>{item.label}</NavLink>
                    ))}
                  </div>
                </>
              )}
            </div>
            <AgentDownloadMenu ink={ink} />
          </nav>

          <div className="flex items-center gap-2">
            <LiveBadge light={light} />
            <button
              onClick={() => setPanel('bookings')}
              title="Customer bookings (Alt+B)"
              aria-label={`Customer bookings, ${bookings.length}`}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1d4ed8] to-[#3b82f6] text-white shadow sp-press"
            >
              <CarIcon width={18} height={18} />
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e8412c] px-1 text-[11px] font-bold text-white ring-2 ring-white">{bookings.length}</span>
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="My account menu"
                aria-expanded={menu === 'profile'}
                onClick={() => setMenu(menu === 'profile' ? '' : 'profile')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1e3d73] text-white shadow sp-press"
              >
                <UserIcon width={18} height={18} />
              </button>
              {menu === 'profile' && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={closeMenu} />
                  <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
                    <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">{user.name}<br />{roleLabel(user)}</p>
                    <Link to="/operator/account" onClick={closeMenu} className={menuItem}>My profile</Link>
                    {!usesOperatorArea(user, permissions) && <Link to="/dashboard" onClick={closeMenu} className={menuItem}>Admin dashboard</Link>}
                    <button type="button" onClick={() => { closeMenu(); setPanel(panel === 'theme' ? '' : 'theme') }} className={menuItem}>Customize template</button>
                    <button type="button" onClick={() => { toggleSound(); closeMenu() }} aria-pressed={sound} className={menuItem}>Sound: {sound ? 'on' : 'off'}</button>
                    <button type="button" onClick={() => { closeMenu(); setPanel('help') }} className={menuItem}>Keyboard shortcuts</button>
                    <button type="button" onClick={handleLogout} className={`${menuItem} border-t border-slate-100 text-red-600`}>Log out</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {panel === 'theme' && <ThemeCustomizer theme={theme} setTheme={setTheme} reset={reset} onClose={() => setPanel('')} />}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>
      {panel === 'bookings' && <BookingsModal onClose={() => setPanel('')} />}
      {panel === 'help' && <ShortcutHelp onClose={() => setPanel('')} />}
    </div>
    </LiveProvider>
  )
}
