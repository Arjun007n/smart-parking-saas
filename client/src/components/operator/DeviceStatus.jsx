import { useMutation, useQuery } from '@tanstack/react-query'
import { hardwareApi, parkingApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { Alert, Button } from '../ui'

const FINAL = ['ACKED', 'FAILED', 'EXPIRED']

// Follows one device command until the device has confirmed it (or failed).
function useCommand(first) {
  const id = first?.commandId
  return useQuery({
    queryKey: ['command', id],
    queryFn: () => hardwareApi.command(id),
    enabled: Boolean(id),
    // The answer from the entry / exit request is already a status; poll until it is final.
    refetchInterval: (query) => (FINAL.includes(query.state.data?.status) ? false : 1500),
    initialData: first ? { status: first.status, deviceName: first.deviceName } : undefined,
    initialDataUpdatedAt: 0,
  })
}

function Line({ tone, children, action }) {
  const colour = { ok: 'text-green-700', wait: 'text-slate-600', bad: 'text-red-700' }[tone]
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className={`font-medium ${colour}`}>{children}</span>
      {action}
    </div>
  )
}

function BarrierLine({ barrier, sessionId, direction }) {
  const retry = useMutation({ mutationFn: () => parkingApi.barrier(sessionId) })
  // Trying again makes a new command; follow that one instead.
  const current = retry.data || barrier
  const { data } = useCommand(current)
  const status = data?.status || current.status
  const side = direction === 'ENTRY' ? 'entry' : 'exit'

  if (status === 'ACKED') return <Line tone="ok">The {side} barrier opened ✓</Line>
  if (status === 'FAILED' || status === 'EXPIRED') {
    return (
      <div className="space-y-2">
        <Alert>The {side} barrier did not respond. Open it manually, or try again.</Alert>
        {retry.error && <Alert>{errorMessage(retry.error)}</Alert>}
        <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
          Try the barrier again
        </Button>
      </div>
    )
  }
  return <Line tone="wait">Opening the {side} barrier…</Line>
}

function PrintLine({ print, sessionId, label }) {
  const { user } = useAuth()
  const again = useMutation({ mutationFn: () => parkingApi.print(sessionId) })
  const current = again.data || print
  const { data } = useCommand(current)
  const status = data?.status || current.status
  const name = label.toLowerCase()

  const button = user?.access?.reprint === false ? null : (
    <Button variant="secondary" className="px-3 py-1 text-xs" loading={again.isPending} onClick={() => again.mutate()}>
      Print again
    </Button>
  )
  if (status === 'ACKED') return <Line tone="ok" action={button}>The {name} printed ✓</Line>
  if (status === 'FAILED' || status === 'EXPIRED') {
    return <Line tone="bad" action={button}>The printer did not print the {name}.</Line>
  }
  return <Line tone="wait">Printing the {name}…</Line>
}

// The "Open barrier" button of the entry and exit screens: lifts the barrier of this gate by hand
// and follows the command until the device confirms it.
export function OpenBarrierButton({ locationId, direction, gate }) {
  const open = useMutation({ mutationFn: () => parkingApi.openBarrier({ locationId, direction, ...(gate ? { gate } : {}) }) })
  const { data } = useCommand(open.data)
  const status = data?.status || open.data?.status
  const side = direction === 'ENTRY' ? 'Entry' : 'Exit'
  let note = null
  if (open.error) note = <span className="text-xs font-medium text-red-700">{errorMessage(open.error)}</span>
  else if (open.data && status === 'ACKED') note = <span className="text-xs font-medium text-green-700">{side} barrier opened ✓</span>
  else if (open.data && (status === 'FAILED' || status === 'EXPIRED')) note = <span className="text-xs font-medium text-red-700">The barrier did not respond</span>
  else if (open.data) note = <span className="text-xs text-slate-600">Opening…</span>
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        className="px-3 py-1 text-xs"
        disabled={!locationId}
        loading={open.isPending}
        onClick={() => open.mutate()}
        title={`Lift the ${side.toLowerCase()} barrier by hand. This is recorded.`}
      >
        🚧 Open barrier
      </Button>
      {note}
    </span>
  )
}

// A single command's progress, for admin screens that sent it by hand.
export function CommandStatus({ commandId, label = 'Command' }) {
  const { data } = useCommand({ commandId, status: 'PENDING' })
  const text = {
    PENDING: 'waiting for the device…',
    SENT: 'sent to the device…',
    ACKED: 'done ✓',
    FAILED: `failed${data?.error ? `: ${data.error}` : ''}`,
    EXPIRED: 'not completed in time (is the gate agent running?)',
  }[data?.status || 'PENDING']
  const tone = data?.status === 'ACKED' ? 'ok' : FINAL.includes(data?.status) ? 'bad' : 'wait'
  return <Line tone={tone}>{label}: {text}</Line>
}

// Shows what the gate devices are doing after an entry or exit.
// `hardware` is the `hardware` part of the entry / exit / payment answer.
export default function DeviceStatus({ hardware, sessionId, direction }) {
  if (!hardware || (!hardware.barrier && !hardware.print && !hardware.problem)) return null
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-live="polite">
      {hardware.problem && (
        <Alert>Could not reach the gate devices. Lift the barrier and give the slip by hand.</Alert>
      )}
      {hardware.barrier && <BarrierLine barrier={hardware.barrier} sessionId={sessionId} direction={direction} />}
      {hardware.print && (
        <PrintLine print={hardware.print} sessionId={sessionId} label={direction === 'ENTRY' ? 'Ticket' : 'Receipt'} />
      )}
    </div>
  )
}
