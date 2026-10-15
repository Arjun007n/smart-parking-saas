import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useBookings } from '../../hooks/useBookings'
import { VEHICLE_LABELS, dateTime, money } from '../../utils/format'
import { printerAvailable, savedPrinter } from '../../native/printer'
import { EnterIcon, ExitIcon, HistoryIcon, CarIcon, PrintIcon } from './icons'

// The top of the operator's Home on a phone: the two big gate buttons first, then the shortcuts, the day's money and the
// customers who booked ahead. (On a wider screen the Home keeps its own layout, so this is hidden from the md width up.)
//   collection  { total, label }  the money tile; left out when the person may not see money
export default function PhoneHome({ collection, onOpenBookings }) {
  const { can } = useAuth()
  const { bookings } = useBookings('all')
  const printer = printerAvailable ? savedPrinter() : null
  const entry = can('ENTRY_CREATE')
  const exit = can('EXIT_CREATE')

  return (
    <div className="no-print space-y-3 md:hidden">
      <BookingsRow bookings={bookings} onOpenBookings={onOpenBookings} />

      {(entry || exit) && (
        <div className="grid grid-cols-2 gap-3">
          {entry && <GateTile to="/operator/entry" title="ENTRY" subtitle="Vehicle entry" kind="entry" Icon={EnterIcon} />}
          {exit && <GateTile to="/operator/exit" title="EXIT" subtitle="Vehicle exit" kind="exit" Icon={ExitIcon} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <ShortcutTile to="/operator/entry-list" title="History" subtitle="Vehicle history" Icon={HistoryIcon} />
        <ShortcutTile to="/operator/entries" title="Inside now" subtitle="Parked vehicles" Icon={CarIcon} />
      </div>

      {collection && can('PAYMENT_COLLECT') && (
        <Link to="/operator/collection" className="sp-press flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-emerald-200">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1.2" /></svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-emerald-700">{collection.label}</span>
            <span className="block text-3xl font-extrabold leading-tight text-slate-900">{money(collection.total)}</span>
          </span>
          <svg viewBox="0 0 80 28" width="72" height="26" aria-hidden="true" className="shrink-0 text-emerald-400">
            <polyline points="0,22 12,18 22,20 34,12 46,15 58,7 70,10 80,3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">›</span>
        </Link>
      )}

      {printerAvailable && (
        <Link to="/operator/printer" className="sp-press flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${printer ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}><PrintIcon width={20} height={20} /></span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-slate-900">{printer ? printer.name : 'No printer chosen'}</span>
            <span className="text-xs text-slate-500">{printer ? 'Tap to change or test the printer' : 'Tap to choose the Bluetooth printer'}</span>
          </span>
        </Link>
      )}
    </div>
  )
}

// A drawing of a gate barrier with a car (entry: car arriving, exit: car leaving), made here so it needs no picture file.
function GateArt({ kind }) {
  const flip = kind === 'exit'
  return (
    <svg viewBox="0 0 160 70" className="h-16 w-full" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <rect x="0" y="62" width="160" height="8" rx="4" fill="#dbeafe" />
      <g transform={flip ? 'translate(160 0) scale(-1 1)' : undefined}>
        <rect x="14" y="22" width="12" height="42" rx="3" fill="#1e3a8a" />
        <rect x="16" y="28" width="8" height="6" rx="1" fill="#93c5fd" />
        <rect x="26" y="26" width="64" height="5" rx="2.5" fill="#ef4444" />
        <rect x="42" y="26" width="8" height="5" fill="#fff" />
        <rect x="62" y="26" width="8" height="5" fill="#fff" />
        <path d="M92 58 v-12 q0-5 6-7 l12-4 q5-6 14-6 h10 q8 0 12 7 l6 3 q4 2 4 7 v12 z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" />
        <path d="M114 36 q4-3 9-3 h8 q5 0 8 5 h-25z" fill="#93c5fd" />
        <circle cx="110" cy="60" r="7" fill="#1e293b" /><circle cx="110" cy="60" r="3" fill="#94a3b8" />
        <circle cx="142" cy="60" r="7" fill="#1e293b" /><circle cx="142" cy="60" r="3" fill="#94a3b8" />
      </g>
    </svg>
  )
}

function GateTile({ to, title, subtitle, kind, Icon }) {
  return (
    <Link to={to} className="sp-press flex min-h-44 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-b from-white to-blue-50 p-3 shadow-sm ring-2 ring-blue-200">
      <span className="flex items-start justify-between">
        <span className="leading-tight">
          <span className="block text-2xl font-extrabold tracking-tight text-[#1d4ed8]">{title}</span>
          <span className="text-xs font-medium text-slate-600">{subtitle}</span>
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2563eb] text-white shadow"><Icon width={18} height={18} /></span>
      </span>
      <GateArt kind={kind} />
    </Link>
  )
}

function ShortcutTile({ to, title, subtitle, Icon }) {
  return (
    <Link to={to} className="sp-press flex items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-2 ring-blue-100">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#2563eb]"><Icon width={20} height={20} /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="block truncate text-[11px] text-slate-500">{subtitle}</span>
      </span>
      <span aria-hidden="true" className="text-lg text-slate-400">›</span>
    </Link>
  )
}

function BookingsRow({ bookings, onOpenBookings }) {
  return (
    <section aria-label="Customer bookings">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">Reserve Bookings</h2>
        <button type="button" onClick={onOpenBookings} className="text-xs font-semibold text-[#2563eb]">View all ({bookings.length}) ›</button>
      </div>
      {bookings.length === 0 ? (
        <p className="rounded-xl bg-white p-3 text-sm text-slate-500 ring-1 ring-slate-200">No customer is booked ahead.</p>
      ) : (
        <ul className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-1">
          {bookings.slice(0, 8).map((b) => (
            <li key={b._id} className="w-48 shrink-0 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <span className="flex items-start justify-between gap-2">
                <span className="font-mono text-sm font-bold tracking-wider text-slate-900">{b.vehicleNumber}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Not Parked</span>
              </span>
              <span className="mt-1 block text-xs text-slate-500">{VEHICLE_LABELS[b.vehicleType] || b.vehicleType} · {dateTime(b.expectedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
