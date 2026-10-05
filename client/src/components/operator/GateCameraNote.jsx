// One line under the lane bar that says which camera reads the plates on this screen.
// The gate camera is the only camera by default; this computer's own camera is a choice, not a given.
const DIRECTIONS = { ENTRY: 'entry only', EXIT: 'exit only', BOTH: 'entry and exit' }

export default function GateCameraNote({ camera, direction, gate, fills, onUseOwn }) {
  if (!camera.ready) return null
  const tell = camera.hasCamera
    ? camera.previewUrl
      ? `The gate camera${camera.name ? ` (${camera.name})` : ''} reads the number plate and fills ${fills}.`
      : `The gate camera${camera.name ? ` (${camera.name})` : ''} is set, but its AI service is not connected yet. Start it on the gate computer (python main.py); the live picture appears here by itself.`
    : camera.elsewhere
      ? `The camera "${camera.elsewhere.name}" is set up for ${DIRECTIONS[camera.elsewhere.direction] || camera.elsewhere.direction}${camera.elsewhere.gate ? ` at gate ${camera.elsewhere.gate}` : ''}, so it is not used here. On the Hardware page edit it: set the direction to "Entry and exit" and clear the gate name (or add a second camera with direction ${direction}). Then restart the AI service with "direction": "AUTO".`
      : `No camera is set for ${gate ? `gate "${gate}"` : 'this gate'}. On the Hardware page add an ANPR camera with direction ${direction}${gate ? ` and gate ${gate}` : ''}, then start the AI service.`
  return (
    <p className="no-print rounded-lg bg-white px-4 py-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
      {tell}{' '}
      <button type="button" className="text-blue-700 underline" onClick={onUseOwn}>
        Use this computer&apos;s camera instead
      </button>
    </p>
  )
}
