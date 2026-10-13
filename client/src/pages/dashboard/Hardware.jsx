import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hardwareApi } from '../../services/api'
import { useMyLocations } from '../../hooks/useMyLocations'
import { usePageTitle } from '../../hooks/usePageTitle'
import { errorMessage } from '../../utils/errors'
import { dateTime } from '../../utils/format'
import { Alert, Badge, Button, Card, Checkbox, Field, PageLoader, Select } from '../../components/ui'
import { CommandStatus } from '../../components/operator/DeviceStatus'

const TYPE_LABELS = {
  ANPR_CAMERA: 'ANPR camera',
  BARRIER: 'Boom barrier',
  PRINTER: 'Thermal printer',
  RFID_READER: 'UHF / RFID reader',
  FASTAG_READER: 'FASTag reader',
  CCTV_CAMERA: 'CCTV camera',
}
// One line on what each kind of device does, shown when adding one.
const TYPE_HELP = {
  ANPR_CAMERA: 'Reads number plates. The operator sees each plate as a suggestion and confirms it.',
  BARRIER: 'Lifts the arm when a ticket is issued or a vehicle is cleared to leave.',
  PRINTER: 'Prints tickets and receipts at the gate.',
  RFID_READER: 'Reads the tag on a pass holder\'s vehicle and suggests that vehicle. Give each pass vehicle its tag number on the pass page.',
  FASTAG_READER: 'Reads a FASTag and suggests the vehicle, with FASTag preselected as the payment mode. The fee is only recorded, nothing is deducted by this software.',
  CCTV_CAMERA: 'Saves a snapshot to the ticket\'s photos when a vehicle enters or leaves. The camera\'s address and password stay on the gate PC.',
}
// What to test on each device that can be tested.
const TEST_ACTIONS = {
  BARRIER: { type: 'BARRIER_OPEN', button: 'Test barrier', run: 'Open the barrier', label: 'Barrier', placeholder: 'Testing the barrier after installation' },
  PRINTER: { type: 'PRINT_TEST', button: 'Test print', run: 'Print a test slip', label: 'Test slip', placeholder: 'Checking paper and print quality' },
  CCTV_CAMERA: { type: 'SNAPSHOT_TEST', button: 'Test camera', run: 'Take a test picture', label: 'Test picture', placeholder: 'Checking the camera picture after installation' },
}
const DIRECTION_LABELS = { ENTRY: 'Entry', EXIT: 'Exit', BOTH: 'Entry and exit' }
const STATUS = {
  ONLINE: { label: 'Online', tone: 'green' },
  OFFLINE: { label: 'Offline', tone: 'red' },
  NEVER_SEEN: { label: 'Never connected', tone: 'slate' },
  UNMONITORED: { label: 'Not monitored', tone: 'blue' },
  DISABLED: { label: 'Switched off', tone: 'slate' },
}
const EVENT_TONE = { info: 'text-slate-600', warning: 'text-amber-700', critical: 'text-red-700' }

// Shown once, right after a device is added or its key is replaced.
function KeyReveal({ reveal, onClose }) {
  const [copied, setCopied] = useState(false)
  const snippet = JSON.stringify(
    {
      name: reveal.name,
      key: reveal.key,
      type: reveal.type,
      driver: ['ANPR_CAMERA', 'RFID_READER', 'FASTAG_READER'].includes(reveal.type) ? 'listener' : 'simulated',
    },
    null,
    2,
  )
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.key)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Card title={`Device key for ${reveal.name}`}>
      <div className="space-y-3 text-sm">
        <Alert type="info">
          Copy this key now. It is shown only once and cannot be looked up later. If you lose it, replace the key.
        </Alert>
        <div className="flex flex-wrap items-center gap-3">
          <code className="break-all rounded bg-slate-100 px-3 py-2 font-mono text-slate-900">{reveal.key}</code>
          <Button variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy key'}</Button>
        </div>
        <p className="text-slate-600">
          Add this device to <code>gate-agent/config.json</code> on the PC at the gate:
        </p>
        <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{snippet}</pre>
        <Button onClick={onClose}>I have saved the key</Button>
      </div>
    </Card>
  )
}

const emptyForm = {
  name: '', type: 'BARRIER', gate: '', direction: 'BOTH', vendor: '', model: '',
  monitorOnline: true, minConfidence: '85', previewUrl: '', pulseMs: '1000', paperWidthMm: '80', autoPrint: true, printQr: false,
}

const fromDevice = (d) => ({
  name: d.name, type: d.type, gate: d.gate || '', direction: d.direction, vendor: d.vendor || '', model: d.model || '',
  monitorOnline: d.monitorOnline,
  minConfidence: String(Math.round((d.config?.minConfidence ?? 0.85) * 100)),
  previewUrl: d.config?.previewUrl || '',
  pulseMs: String(d.config?.pulseMs ?? 1000),
  paperWidthMm: String(d.config?.paperWidthMm ?? 80),
  autoPrint: d.config?.autoPrint !== false,
  printQr: Boolean(d.config?.printQr),
})

// The request body for a form. Settings that do not apply to the device type are left out.
function toBody(form, { locationId, creating }) {
  const config = {}
  if (form.type === 'ANPR_CAMERA') {
    config.minConfidence = Number(form.minConfidence) / 100
    config.previewUrl = form.previewUrl.trim()
  }
  if (form.type === 'BARRIER') config.pulseMs = Number(form.pulseMs)
  if (form.type === 'PRINTER') {
    config.paperWidthMm = Number(form.paperWidthMm)
    config.autoPrint = form.autoPrint
    config.printQr = form.printQr
  }
  return {
    ...(creating ? { locationId, type: form.type } : {}),
    name: form.name.trim(),
    gate: form.gate,
    direction: form.direction,
    vendor: form.vendor.trim(),
    model: form.model.trim(),
    monitorOnline: form.monitorOnline,
    config,
  }
}

function DeviceForm({ location, initial, creating, onSubmit, onCancel, saving, error }) {
  const [form, setForm] = useState(initial || emptyForm)
  const set = (name) => (event) =>
    setForm((f) => ({ ...f, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }))

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(toBody(form, { locationId: location._id, creating }))
      }}
    >
      <Alert>{error && errorMessage(error)}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" value={form.name} onChange={set('name')} placeholder="Gate A barrier" required />
        {creating ? (
          <Select label="Type" name="type" value={form.type} onChange={set('type')}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        ) : (
          <Field label="Type" name="type" value={TYPE_LABELS[form.type]} disabled readOnly />
        )}
        <Select label="Gate" name="gate" value={form.gate} onChange={set('gate')}>
          <option value="">Any gate</option>
          {(location.gates || []).map((g) => (
            <option key={g.name} value={g.name}>{g.name}</option>
          ))}
        </Select>
        <Select label="Used for" name="direction" value={form.direction} onChange={set('direction')}>
          {Object.entries(DIRECTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        {creating && <p className="text-xs text-slate-500 sm:col-span-2">{TYPE_HELP[form.type]}</p>}
        <Field label="Make (optional)" name="vendor" value={form.vendor} onChange={set('vendor')} />
        <Field label="Model (optional)" name="model" value={form.model} onChange={set('model')} />
        {form.type === 'ANPR_CAMERA' && (
          <Field
            label="Minimum confidence (%)" name="minConfidence" type="number" min="0" max="100"
            hint="Readings below this are marked 'Check this plate'."
            value={form.minConfidence} onChange={set('minConfidence')}
          />
        )}
        {form.type === 'ANPR_CAMERA' && (
          <Field
            label="Live picture address (optional)" name="previewUrl" placeholder="http://192.168.1.50/video.mjpg"
            hint="The camera's live video address (MJPEG). Shown on the Entry and Exit screens. Leave empty if you do not need a live picture there."
            value={form.previewUrl} onChange={set('previewUrl')}
          />
        )}
        {form.type === 'BARRIER' && (
          <Field
            label="Opening pulse (ms)" name="pulseMs" type="number" min="100" max="10000"
            hint="How long the relay is held to lift the arm."
            value={form.pulseMs} onChange={set('pulseMs')}
          />
        )}
        {form.type === 'PRINTER' && (
          <Select label="Paper width" name="paperWidthMm" value={form.paperWidthMm} onChange={set('paperWidthMm')}>
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </Select>
        )}
      </div>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="Alert me when it goes offline" checked={form.monitorOnline} onChange={set('monitorOnline')} />
        {form.type === 'PRINTER' && (
          <>
            <Checkbox label="Print tickets and receipts automatically" checked={form.autoPrint} onChange={set('autoPrint')} />
            <Checkbox label="Print a QR code" checked={form.printQr} onChange={set('printQr')} />
          </>
        )}
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={saving}>{creating ? 'Add device' : 'Save changes'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function Events({ id }) {
  const detail = useQuery({ queryKey: ['hardware', id], queryFn: () => hardwareApi.get(id) })
  if (detail.isLoading) return <p className="text-sm text-slate-500">Loading…</p>
  if (detail.error) return <Alert>{errorMessage(detail.error)}</Alert>
  const { events } = detail.data
  if (!events.length) return <p className="text-sm text-slate-500">Nothing has happened with this device yet.</p>
  return (
    <ul className="space-y-1 text-sm">
      {events.map((e) => (
        <li key={e._id} className={EVENT_TONE[e.severity]}>
          <span className="text-slate-400">{dateTime(e.createdAt)}</span> — {e.message || e.type}
        </li>
      ))}
    </ul>
  )
}

function TestPanel({ device, onClose }) {
  const [reason, setReason] = useState('')
  const action = TEST_ACTIONS[device.type]
  const send = useMutation({
    mutationFn: () => hardwareApi.send(device._id, { type: action.type, reason }),
  })
  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-4">
      <Alert>{send.error && errorMessage(send.error)}</Alert>
      <Field
        label="Reason (recorded in the audit log)" name="reason" value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={action.placeholder}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={send.isPending} disabled={reason.trim().length < 5} onClick={() => send.mutate()}>
          {action.run}
        </Button>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {send.data && <CommandStatus key={send.data.id} commandId={send.data.id} label={action.label} />}
    </div>
  )
}

function DeviceRow({ device, location, onReveal }) {
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState(null) // 'edit' | 'test' | 'events'
  const [confirmKey, setConfirmKey] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hardware'] })
  const status = STATUS[device.status] || STATUS.NEVER_SEEN

  const update = useMutation({
    mutationFn: (body) => hardwareApi.update(device._id, body),
    onSuccess: () => {
      refresh()
      setPanel(null)
    },
  })
  const rotate = useMutation({
    mutationFn: () => hardwareApi.rotateKey(device._id),
    onSuccess: (data) => {
      refresh()
      setConfirmKey(false)
      onReveal({ name: device.name, key: data.deviceKey, type: device.type })
    },
  })
  const canTest = Boolean(TEST_ACTIONS[device.type]) && device.isActive

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            {device.name} <span className="ml-1"><Badge tone={status.tone}>{status.label}</Badge></span>
          </p>
          <p className="text-sm text-slate-600">
            {TYPE_LABELS[device.type]} · {device.gate || 'any gate'} · {DIRECTION_LABELS[device.direction]}
            {device.vendor ? ` · ${device.vendor}${device.model ? ` ${device.model}` : ''}` : ''}
          </p>
          <p className="text-xs text-slate-500">
            Last contact: {device.lastSeenAt ? dateTime(device.lastSeenAt) : 'never'} · key {device.keyPrefix}…
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTest && (
            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setPanel(panel === 'test' ? null : 'test')}>
              {TEST_ACTIONS[device.type].button}
            </Button>
          )}
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setPanel(panel === 'events' ? null : 'events')}>
            History
          </Button>
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setPanel(panel === 'edit' ? null : 'edit')}>
            Edit
          </Button>
          <Button
            variant="secondary" className="px-3 py-1 text-xs" loading={update.isPending && panel !== 'edit'}
            onClick={() => update.mutate({ isActive: !device.isActive })}
          >
            {device.isActive ? 'Switch off' : 'Switch on'}
          </Button>
          {confirmKey ? (
            <Button variant="danger" className="px-3 py-1 text-xs" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              Yes, replace the key
            </Button>
          ) : (
            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setConfirmKey(true)}>
              Replace key
            </Button>
          )}
        </div>
      </div>
      {confirmKey && (
        <Alert type="info">The old key stops working immediately. The gate agent must be given the new key.</Alert>
      )}
      <Alert>{rotate.error && errorMessage(rotate.error)}</Alert>
      <Alert>{update.error && panel !== 'edit' && errorMessage(update.error)}</Alert>
      {panel === 'test' && <TestPanel device={device} onClose={() => setPanel(null)} />}
      {panel === 'events' && <Events id={device._id} />}
      {panel === 'edit' && (
        <DeviceForm
          location={location}
          initial={fromDevice(device)}
          onSubmit={(body) => update.mutate(body)}
          onCancel={() => setPanel(null)}
          saving={update.isPending}
          error={update.error}
        />
      )}
    </li>
  )
}

// Where to get the program that runs on the gate PC and connects the devices to this server.
function AgentDownload() {
  const info = useQuery({ queryKey: ['hardware', 'agent-info'], queryFn: hardwareApi.agentInfo, staleTime: 5 * 60_000 })
  const download = useMutation({ mutationFn: hardwareApi.downloadAgent })
  return (
    <Card title="Gate agent (the program for the gate PC)">
      <div className="space-y-3 text-sm text-slate-700">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Add each device below and copy its key (shown once).</li>
          <li>Download the agent and unzip it on the gate PC. Install <span className="font-semibold">Node.js 20 or newer</span> there first.</li>
          <li>Open <span className="font-mono">config.json</span>, paste the keys and set each device&apos;s driver. This server&apos;s address is already filled in.</li>
          <li>Double-click <span className="font-mono">start-agent.bat</span> (Windows) or run <span className="font-mono">sh start-agent.sh</span>. The devices show as online here within a minute.</li>
          <li>For the live camera picture on the Entry and Exit screens, add a <span className="font-mono">preview</span> block to the ANPR camera in <span className="font-mono">config.json</span> (see the README in the zip). The agent shows the picture on the gate PC and tells this server where it is.</li>
        </ol>
        {info.data && !info.data.available ? (
          <Alert type="info">The agent files are not on this server. Copy the <span className="font-mono">gate-agent</span> folder from the project to the gate PC instead; the steps are the same.</Alert>
        ) : (
          <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>Download gate agent (.zip)</Button>
        )}
        <Alert>{download.error && errorMessage(download.error)}</Alert>
        <p className="text-xs text-slate-500">The agent only makes outgoing connections, so nothing needs to be opened on the router. Keep <span className="font-mono">config.json</span> private: it holds the device keys.</p>
      </div>
    </Card>
  )
}

export default function Hardware() {
  usePageTitle('Gate hardware')
  const queryClient = useQueryClient()
  const { locations, defaultId, isLoading: loadingLocations, error: locationError } = useMyLocations()
  const [chosen, setChosen] = useState('')
  const [adding, setAdding] = useState(false)
  const [reveal, setReveal] = useState(null)

  const locationId = chosen || defaultId || locations[0]?._id || ''
  const location = locations.find((l) => l._id === locationId)

  const list = useQuery({
    queryKey: ['hardware', 'list', locationId],
    queryFn: () => hardwareApi.list({ locationId }),
    enabled: Boolean(locationId),
    refetchInterval: 15_000,
  })
  const create = useMutation({
    mutationFn: hardwareApi.create,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['hardware'] })
      setAdding(false)
      setReveal({ name: data.device.name, key: data.deviceKey, type: data.device.type })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gate hardware</h1>
          <p className="text-sm text-slate-600">
            Cameras, readers, barriers and printers at your locations. The gate agent on the PC at the gate connects them.
          </p>
        </div>
        {locations.length > 1 && (
          <Select label="Location" name="location" value={locationId} onChange={(e) => setChosen(e.target.value)}>
            {locations.map((l) => (
              <option key={l._id} value={l._id}>{l.name}</option>
            ))}
          </Select>
        )}
      </div>

      <Alert>{locationError && errorMessage(locationError)}</Alert>
      {reveal && <KeyReveal reveal={reveal} onClose={() => setReveal(null)} />}
      <AgentDownload />

      {loadingLocations ? (
        <PageLoader />
      ) : !location ? (
        <Alert type="info">Add a parking location first. Devices belong to a location.</Alert>
      ) : (
        <>
          {adding ? (
            <Card title="Add a device">
              <DeviceForm
                location={location}
                creating
                onSubmit={(body) => create.mutate(body)}
                onCancel={() => setAdding(false)}
                saving={create.isPending}
                error={create.error}
              />
            </Card>
          ) : (
            <Button onClick={() => setAdding(true)}>Add a device</Button>
          )}

          <Card title={`Devices at ${location.name}`}>
            {list.isLoading ? (
              <PageLoader />
            ) : list.error ? (
              <Alert>{errorMessage(list.error)}</Alert>
            ) : list.data.length === 0 ? (
              <p className="text-sm text-slate-600">
                No devices yet. Everything works by hand without them; add a device when you install one.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {list.data.map((device) => (
                  <DeviceRow key={device._id} device={device} location={location} onReveal={setReveal} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
