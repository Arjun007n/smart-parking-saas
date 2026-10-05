import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { anprApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { shrinkImage } from '../../utils/image'
import { Alert, Badge, Button } from '../ui'

// "Read plate from photo": the operator takes (or chooses) a picture of the
// vehicle and the server's plate reader suggests the number. It is only a
// suggestion: the operator still checks it and presses the normal button.
// Shown only when the server has a reader switched on.
export default function PlateFromPhoto({ locationId, direction, onRead }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const input = useRef(null)
  const [testPlate, setTestPlate] = useState('')
  const allowed = can(direction === 'ENTRY' ? 'ENTRY_CREATE' : 'EXIT_CREATE')

  const options = useQuery({
    queryKey: ['anpr-options'],
    queryFn: anprApi.options,
    enabled: allowed,
    staleTime: 5 * 60 * 1000,
  })

  const read = useMutation({
    // A little larger than the vehicle-photo size: small letters need pixels.
    mutationFn: async (file) => anprApi.read(locationId, direction, await shrinkImage(file, { maxSide: 1600, quality: 0.85 }), testPlate.trim()),
    onSuccess: (data) => {
      if (data.detection) {
        onRead(data.detection)
        queryClient.invalidateQueries({ queryKey: ['anpr'] })
      }
    },
  })

  if (!allowed || !locationId || !options.data?.photoReading) return null

  const onPick = (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same picture can be chosen again
    if (file) read.mutate(file)
  }

  const result = read.data
  return (
    <div className="no-print space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Read plate from photo</h2>
          <p className="text-xs text-slate-500">Take a clear picture of the number plate. You still check the number before continuing.</p>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of the number plate" onChange={onPick} />
        <Button variant="secondary" loading={read.isPending} onClick={() => input.current?.click()}>
          Read from photo
        </Button>
      </div>
      {options.data.simulated && (
        <label className="block text-xs text-slate-600">
          Test mode (pretend reader): plate to "read"
          <input
            value={testPlate}
            onChange={(event) => setTestPlate(event.target.value)}
            maxLength={20}
            placeholder="RJ14AB1234"
            className="ml-2 rounded border border-slate-300 px-2 py-1 font-mono uppercase"
          />
        </label>
      )}
      <Alert>{read.error && errorMessage(read.error)}</Alert>
      {result && !read.isPending && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          {result.readable ? (
            <>
              <span className="font-mono text-lg font-bold tracking-wider text-slate-900">{result.plate}</span>
              {result.confidence != null && <span className="text-xs text-slate-500">{Math.round(result.confidence * 100)}% sure</span>}
              {result.reviewReasons.length > 0 && <Badge tone="red">Check this plate</Badge>}
            </>
          ) : (
            <span className="text-amber-800">No plate could be read from this picture. Try again closer, or type the number.</span>
          )}
          {result.readable && result.reviewReasons.length > 0 && (
            <span className="text-xs text-amber-800">{result.reviewReasons.join(' · ')}</span>
          )}
        </div>
      )}
    </div>
  )
}
