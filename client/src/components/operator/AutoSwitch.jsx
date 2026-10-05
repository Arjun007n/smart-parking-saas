// The AUTO ENTRY / AUTO EXIT switch: a pill with a status light on the left and a knob on the right.
// Off every time the page opens.
export default function AutoSwitch({ label, on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title="Click to switch automatic mode on or off"
      className={`sp-press flex items-center gap-3 rounded-xl border px-2.5 py-1.5 text-left shadow-sm transition-colors ${
        on ? 'border-green-300 bg-green-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full ${on ? 'bg-green-500' : 'bg-red-100'}`}>
        <span className={`h-2 w-2 rounded-full ${on ? 'animate-pulse bg-white' : 'border-2 border-red-500'}`} />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-extrabold text-slate-800">{label}</span>
        <span className={`block text-[11px] font-bold ${on ? 'text-green-700' : 'text-red-500'}`}>{on ? 'ENABLED' : 'DISABLED'}</span>
      </span>
      <span aria-hidden="true" className={`relative ml-2 h-6 w-11 rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
