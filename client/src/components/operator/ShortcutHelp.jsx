// The keyboard shortcuts of the gate staff screens, shown from the "?" key or the header button.
const KEYS = [
  ['F2', 'Vehicle Entry'],
  ['F4', 'Vehicle Exit'],
  ['F6', 'Home'],
  ['Alt + B', 'Customer bookings'],
  ['/', 'Jump to the vehicle number box'],
  ['Esc', 'Close this and other panels'],
  ['?', 'Show this list'],
]

export default function ShortcutHelp({ onClose }) {
  return (
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-5 text-slate-900 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {KEYS.map(([key, what]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <dt><kbd className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-xs">{key}</kbd></dt>
              <dd className="text-slate-600">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
