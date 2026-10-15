import { Link } from 'react-router-dom'
import { printerAvailable, savedPrinter } from '../../native/printer'
import { useLiveStatus } from '../../hooks/useLive'
import { ExitIcon, EnterIcon, HistoryIcon, PrintIcon } from './icons'

const ONLINE = {
  live: { text: 'ONLINE', dot: 'bg-emerald-500', box: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  connecting: { text: 'CONNECTING', dot: 'bg-amber-400', box: 'bg-amber-50 text-amber-700 ring-amber-200' },
  offline: { text: 'NOT LIVE', dot: 'bg-slate-400', box: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

// The top bar of the phone's Entry and Exit screens: back, the other screen, the printer, the history and the barrier.
//   other  'entry' | 'exit'   the screen the link in the bar leads to
export default function GateBar({ other, children }) {
  const printer = printerAvailable ? savedPrinter() : null
  const Icon = other === 'exit' ? ExitIcon : EnterIcon
  return (
    <div className="no-print flex items-center gap-2 md:hidden">
      <Link to="/operator/dashboard" aria-label="Back to Home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#2563eb] active:bg-blue-50">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      </Link>
      <span className="ml-auto flex items-center gap-1">
        <Link to={`/operator/${other}`} className="flex items-center gap-1 rounded-full px-2 py-2 text-sm font-bold text-[#2563eb] active:bg-blue-50">
          <Icon width={20} height={20} />
          {other === 'exit' ? 'Exit' : 'Entry'}
        </Link>
        <Link to="/operator/printer" aria-label={printer ? `Printer: ${printer.name}` : 'Choose a printer'} className={`flex h-10 w-10 items-center justify-center rounded-full active:bg-blue-50 ${printer ? 'text-emerald-600' : 'text-red-500'}`}>
          <PrintIcon width={22} height={22} />
        </Link>
        <Link to="/operator/entry-list" aria-label="History" className="flex h-10 w-10 items-center justify-center rounded-full text-[#2563eb] active:bg-blue-50">
          <HistoryIcon width={22} height={22} />
        </Link>
        {children}
      </span>
    </div>
  )
}

export function OnlinePill() {
  const status = useLiveStatus()
  const look = ONLINE[status] || ONLINE.offline
  return (
    <p className={`no-print flex items-center justify-center gap-1.5 rounded-lg py-1 text-[11px] font-extrabold tracking-wide ring-1 md:hidden ${look.box}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${look.dot}`} aria-hidden="true" />
      {look.text}
    </p>
  )
}

// Camera | Keyboard (Entry) or QR Code | Vehicle Number (Exit): two big switch buttons.
export function ModeSwitch({ value, onChange, options }) {
  return (
    <div className="no-print grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 md:hidden" role="group" aria-label="How to enter the vehicle">
      {options.map(([key, label, Glyph]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${value === key ? 'bg-[#2563eb] text-white shadow' : 'text-slate-600'}`}
        >
          {Glyph && <Glyph />}
          {label}
        </button>
      ))}
    </div>
  )
}

// The top bar of the phone's other screens (Collection, My profile): back to Home and the title.
export function PageBar({ title, children }) {
  return (
    <div className="no-print flex items-center gap-2 md:hidden">
      <Link to="/operator/dashboard" aria-label="Back to Home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#2563eb] active:bg-blue-50">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold text-[#1e3d73]">{title}</h1>
      {children}
    </div>
  )
}
