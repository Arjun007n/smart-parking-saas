import { useLiveStatus } from '../../hooks/useLive'

const LOOK = {
  live: { dot: 'bg-green-400', text: 'Live', hint: 'Changes appear by themselves' },
  connecting: { dot: 'bg-amber-400', text: 'Connecting…', hint: 'Connecting to live updates' },
  offline: { dot: 'bg-red-400', text: 'Offline', hint: 'Live updates are off; screens refresh every few seconds instead' },
}

// A small light in the header: green when the server is pushing changes to this screen.
export default function LiveBadge({ light = false }) {
  const status = useLiveStatus()
  const look = LOOK[status] || LOOK.offline
  return (
    <span title={look.hint} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${light ? 'border-slate-200 text-slate-600' : 'border-white/20'}`}>
      <span className={`h-2 w-2 rounded-full ${look.dot} ${status === 'live' ? 'animate-pulse' : ''}`} aria-hidden="true" />
      {look.text}
    </span>
  )
}
