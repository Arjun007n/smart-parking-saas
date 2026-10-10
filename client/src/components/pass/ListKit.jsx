import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../ui'
import { ENTRY_SIZES } from './listState'

// Small pieces shared by the Pass Management pages, laid out like the ismartparking.com list pages:
// coloured number tiles, "Show N entries" with a live search, a page strip and the Excel / Print buttons.


const TILE_TONES = {
  cyan: 'from-cyan-400 to-blue-500',
  green: 'from-emerald-500 to-lime-500',
  orange: 'from-orange-300 to-rose-400',
  purple: 'from-violet-600 to-fuchsia-500',
  dark: 'from-slate-700 to-slate-900',
}

// One number on a coloured card: "33 Total Pass Users".
export function StatTile({ tone = 'cyan', value, label, children }) {
  return (
    <div className={`rounded-lg bg-gradient-to-r ${TILE_TONES[tone]} p-4 text-white shadow-sm`}>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-sm opacity-95">{label}</p>
      {children}
    </div>
  )
}

export const TileGrid = ({ children }) => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{children}</div>

// "Show [25] entries".
export function ShowEntries({ value, onChange, sizes = ENTRY_SIZES }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      Show
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Entries per page"
      >
        {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
      entries
    </label>
  )
}

export function SearchBox({ value, onChange, label = 'Search' }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      {label}:
      <input
        type="search"
        className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

// A short list of the pages around the current one: 1 … 4 5 6 … 9.
const pageList = (page, pages) => {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const out = []
  let last = 0
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (n - last > 1) out.push(`gap-${n}`)
    out.push(n)
    last = n
  }
  return out
}

// "Showing 1 to 25 of 33 entries" with Previous / page numbers / Next.
export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const button = 'rounded-md border px-3 py-1 text-sm'
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>Showing {from} to {to} of {total} entries</span>
      <nav className="flex flex-wrap gap-1" aria-label="Pages">
        <button type="button" className={`${button} border-slate-300 disabled:opacity-40`} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        {pageList(page, pages).map((n) => (typeof n === 'string' ? (
          <span key={n} className="px-1 py-1">…</span>
        ) : (
          <button
            key={n}
            type="button"
            aria-current={n === page ? 'page' : undefined}
            className={`${button} ${n === page ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'}`}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        )))}
        <button type="button" className={`${button} border-slate-300 disabled:opacity-40`} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </nav>
    </div>
  )
}

// A group of toolbar buttons that sit above a table (Create Pass, Download Excel, Print ...).
export function Toolbar({ children }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>
}

// A narrow link-styled button used in the Action column.
export function IconLink({ to, title, children, tone = 'blue' }) {
  const tones = { blue: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700', outline: 'border-blue-600 text-blue-700 hover:bg-blue-50' }
  return (
    <Link to={to} title={title} aria-label={title} className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {children}
    </Link>
  )
}

export function IconButton({ title, onClick, tone = 'outline', disabled, children }) {
  const tones = {
    outline: 'border-blue-600 text-blue-700 hover:bg-blue-50',
    danger: 'border-red-600 text-red-700 hover:bg-red-50',
  }
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

// A page title with a Back link, like the inner pages of ismartparking.com.
export function PageTitle({ title, back, backLabel = 'Back', children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <div className="flex items-center gap-2">
        {children}
        {back && <Link to={back} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{backLabel}</Link>}
      </div>
    </div>
  )
}

// The Excel, PDF and Print buttons above a list. `download(format)` is a mutation's mutate.
export function ExportButtons({ onDownload, onPrint, disabled, pending }) {
  return (
    <>
      {onDownload && <Button type="button" variant="info" disabled={disabled || pending} onClick={() => onDownload('xlsx')}>Download Excel</Button>}
      {onPrint && <Button type="button" variant="dark" disabled={disabled} onClick={onPrint}>Print</Button>}
    </>
  )
}


// A dialog over the page (Add Company, Update Pass, the invoice preview ...). Esc or a click outside closes it.
export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="no-print fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mt-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-xl bg-blue-700 px-5 py-3 text-white">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="text-xl leading-none" onClick={onClose}>×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
