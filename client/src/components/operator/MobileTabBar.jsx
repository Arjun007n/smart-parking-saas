import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { EnterIcon, ExitIcon, HomeIcon } from './icons'

const ListIcon = (props) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
)
const MenuIcon = (props) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

// The bottom bar of the operator pages on a phone (hidden from the md width up, where the top bar has everything):
// Home, Entry and Exit are one tap away, and the other pages sit under "Lists" and "Menu".
//   tabs       [{ to, label, kind? }]  Home / Entry / Exit, already filtered by the person's permissions
//   lists      [{ to, label }]         Entry List, Exit List, Vehicles Inside, Vehicle Search
//   menuItems  [{ to, label }]         everything else the person may open (Collection, Wallets, Reports ...)
const ICONS = { '/operator/dashboard': HomeIcon, '/operator/entry': EnterIcon, '/operator/exit': ExitIcon }

export default function MobileTabBar({ tabs, lists, menuItems, profile }) {
  const [sheet, setSheet] = useState('') // '', 'lists' or 'menu'
  const { pathname } = useLocation()
  const close = () => setSheet('')
  const inside = (items) => items.some((item) => pathname.startsWith(item.to))

  const tabClass = (active, kind) => {
    const colour = active ? 'text-[#007bff]' : kind === 'entry' ? 'text-emerald-600' : kind === 'exit' ? 'text-red-600' : 'text-slate-500'
    return `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-bold ${colour}`
  }
  const sheetItems = sheet === 'lists' ? lists : menuItems

  return (
    <>
      {sheet && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={close} />
          <div role="dialog" aria-label={sheet === 'lists' ? 'Lists' : 'Menu'} className="fixed inset-x-0 bottom-14 z-40 max-h-[70vh] overflow-y-auto rounded-t-3xl bg-white p-3 pb-4 shadow-2xl md:hidden">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
            {sheet === 'menu' && profile && (
              <NavLink to="/operator/account" onClick={close} className="mb-2 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#1d4ed8] to-[#3b82f6] p-3 text-white shadow">
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-extrabold">{(profile.name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-base font-extrabold">{profile.name}</span>
                  <span className="block truncate text-xs opacity-90">{profile.role}{profile.company ? ` · ${profile.company}` : ''}</span>
                </span>
                <span className="text-xs font-bold opacity-90">My profile ›</span>
              </NavLink>
            )}
            {sheetItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={close}
                className={({ isActive }) => `flex items-center justify-between rounded-xl px-4 py-3.5 text-base font-semibold ${isActive ? 'bg-blue-50 text-[#007bff]' : 'text-slate-700 active:bg-slate-100'}`}
              >
                {item.label}
                <span aria-hidden="true" className="text-slate-400">›</span>
              </NavLink>
            ))}
            {sheet === 'menu' && profile?.onLogout && (
              <button type="button" onClick={() => { close(); profile.onLogout() }} className="mt-1 flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left text-base font-semibold text-red-600 active:bg-red-50">
                Log out
                <span aria-hidden="true">›</span>
              </button>
            )}
          </div>
        </>
      )}
      <nav aria-label="Operator tabs" className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,0.08)] md:hidden">
        {tabs.map((item) => {
          const Icon = ICONS[item.to]
          return (
            <NavLink key={item.to} to={item.to} onClick={close} className={({ isActive }) => tabClass(isActive, item.kind)}>
              {Icon && <Icon width={22} height={22} />}
              {item.label}
            </NavLink>
          )
        })}
        {lists.length > 0 && (
          <button type="button" aria-expanded={sheet === 'lists'} onClick={() => setSheet(sheet === 'lists' ? '' : 'lists')} className={tabClass(sheet === 'lists' || inside(lists), '')}>
            <ListIcon />
            Lists
          </button>
        )}
        {menuItems.length > 0 && (
          <button type="button" aria-expanded={sheet === 'menu'} onClick={() => setSheet(sheet === 'menu' ? '' : 'menu')} className={tabClass(sheet === 'menu' || inside(menuItems), '')}>
            <MenuIcon />
            Menu
          </button>
        )}
      </nav>
    </>
  )
}
