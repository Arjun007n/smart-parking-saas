// One line under the lane bar that says which ANPR camera reads the plates on this screen.
// The number always comes from the gate's ANPR camera (shown as suggestions) or is typed by the operator.
// On the entry screen this computer's own camera can also be used to keep a photo of the vehicle.
const DIRECTIONS = { ENTRY: 'entry only', EXIT: 'exit only', BOTH: 'entry and exit' }

export default function GateCameraNote({ camera, direction, gate, fills, onUseOwn, ownLabel }) {
  if (!camera.ready) return null
  const tell = camera.hasCamera
    ? camera.previewUrl
      ? `The ANPR camera${camera.name ? ` (${camera.name})` : ''} reads the number plate and fills ${fills}. You can always type the number yourself.`
      : `The ANPR camera${camera.name ? ` (${camera.name})` : ''} reads the number plate and fills ${fills}. You can always type the number yourself. No live picture address is set for it, so no live picture shows here (optional: add one on the Hardware page).`
    : camera.elsewhere
      ? `The camera "${camera.elsewhere.name}" is set up for ${DIRECTIONS[camera.elsewhere.direction] || camera.elsewhere.direction}${camera.elsewhere.gate ? ` at gate ${camera.elsewhere.gate}` : ''}, so it is not used here. On the Hardware page edit it: set the direction to "Entry and exit" and clear the gate name (or add a second camera with direction ${direction}). Until then, type the vehicle number.`
      : `No ANPR camera is set for ${gate ? `gate "${gate}"` : 'this gate'}, so type the vehicle number. To read plates by camera, add an ANPR camera on the Hardware page with direction ${direction}${gate ? ` and gate ${gate}` : ''}.`
  return (
    <p className="no-print rounded-lg bg-white px-4 py-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200">
      {tell}
      {onUseOwn && (
        <>
          {' '}
          <button type="button" className="text-blue-700 underline" onClick={onUseOwn}>
            {ownLabel || 'Use this computer’s camera'}
          </button>
        </>
      )}
    </p>
  )
}
