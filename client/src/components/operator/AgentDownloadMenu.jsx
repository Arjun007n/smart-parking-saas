import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { hardwareApi } from '../../services/api'
import { errorMessage } from '../../utils/errors'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui'

// The "Download" menu of the operator bar (ismartparking.com has the same: its agent and printer services).
// The gate agent is the program on the gate PC that connects the barrier, the printer and the camera to this server and
// serves the camera's live picture to the Entry and Exit screens. The zip holds the program and this server's
// address, never a device key.
export default function AgentDownloadMenu({ ink }) {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState({ left: 0, top: 0 })
  const allowed = can('ENTRY_CREATE') || can('EXIT_CREATE') || can('LOCATION_MANAGE')
  const info = useQuery({ queryKey: ['hardware', 'agent-info'], queryFn: hardwareApi.agentInfo, staleTime: 5 * 60_000, enabled: allowed && open })
  const download = useMutation({ mutationFn: hardwareApi.downloadAgent })
  if (!allowed) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          // The bar scrolls sideways and would clip a list placed inside it, so the list is placed on the page itself.
          const box = event.currentTarget.getBoundingClientRect()
          setPlace({ left: Math.max(8, Math.min(box.left, window.innerWidth - 328)), top: box.bottom + 4 })
          setOpen((on) => !on)
        }}
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold hover:bg-slate-100/20 ${ink}`}
      >
        Download <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div style={{ left: place.left, top: place.top }} className="fixed z-30 w-80 max-w-[calc(100vw-1rem)] space-y-3 rounded-xl bg-white p-4 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200">
            <div>
              <p className="font-bold text-slate-900">Gate agent</p>
              <p className="mt-1 text-xs text-slate-600">
                The program for the gate PC. It works the barrier and the printer, reads the camera and shows the camera&apos;s live picture on the Entry and Exit screens.
              </p>
            </div>
            {info.isLoading ? (
              <p className="text-xs text-slate-500">Checking…</p>
            ) : info.data && !info.data.available ? (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">The agent is not on this server. Ask your admin for the <span className="font-mono">gate-agent</span> folder.</p>
            ) : (
              <Button variant="secondary" className="w-full" loading={download.isPending} onClick={() => download.mutate()}>Download gate agent (.zip)</Button>
            )}
            {download.error && <p className="text-xs text-red-600">{errorMessage(download.error)}</p>}
            <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
              <li>Install <span className="font-semibold">Node.js 20 or newer</span> on the gate PC and unzip the file there.</li>
              <li>Open <span className="font-mono">config.json</span> and paste each device&apos;s key. Your admin adds the devices on the Hardware page and gets the keys.</li>
              <li>Double-click <span className="font-mono">start-agent.bat</span>. The devices show as online within a minute.</li>
              <li>For the live camera picture, add a <span className="font-mono">preview</span> block to the camera (steps are in the zip&apos;s README).</li>
            </ol>
            {can('LOCATION_MANAGE') && (
              <Link to="/dashboard/hardware" onClick={() => setOpen(false)} className="block text-xs font-semibold text-blue-700 underline">Open the Hardware page</Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}
