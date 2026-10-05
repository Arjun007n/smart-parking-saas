import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { errorMessage } from '../../utils/errors'
import { dateTime } from '../../utils/format'
import { shrinkImage } from '../../utils/image'
import { Alert, Button } from '../ui'

const KIND_LABELS = { ENTRY: 'Entry', EXIT: 'Exit', OTHER: 'Other' }

// Reads a picture from the server (it needs the login, so a plain <img src>
// cannot be used) as a data address the <img> tag can show. Kept by the query
// cache and dropped with it, so there is nothing to clean up by hand.
const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

function Thumb({ sessionId, photo, onOpen, canDelete }) {
  const queryClient = useQueryClient()
  const { data: src, error } = useQuery({
    queryKey: ['photo', sessionId, photo._id],
    queryFn: async () => readAsDataUrl(await parkingApi.photo(sessionId, photo._id)),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
  const remove = useMutation({
    mutationFn: () => parkingApi.deletePhoto(sessionId, photo._id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-photos', sessionId] }),
  })

  const confirmDelete = () => {
    if (window.confirm('Delete this photo? This cannot be undone.')) remove.mutate()
  }

  return (
    <figure className="w-28">
      {src ? (
        <button type="button" onClick={() => onOpen(src, photo)} className="block overflow-hidden rounded-lg ring-1 ring-slate-300">
          <img src={src} alt={`${KIND_LABELS[photo.kind]} photo, ${dateTime(photo.takenAt)}`} className="h-20 w-28 object-cover" />
        </button>
      ) : (
        <div className="flex h-20 w-28 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">
          {error ? 'Not available' : 'Loading…'}
        </div>
      )}
      <figcaption className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{KIND_LABELS[photo.kind]}</span>
        {canDelete && (
          <button type="button" className="text-red-700 hover:underline disabled:opacity-60" disabled={remove.isPending} onClick={confirmDelete}>
            Delete
          </button>
        )}
      </figcaption>
      {remove.error && <p className="text-xs text-red-600">{errorMessage(remove.error)}</p>}
    </figure>
  )
}

// The pictures of one vehicle visit, and (unless readOnly) a button to add one.
// On a phone or tablet the button opens the camera; on a computer it opens a file picker.
export default function PhotoPanel({ sessionId, kind = 'ENTRY', readOnly = false }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const input = useRef(null)
  const [big, setBig] = useState(null)
  const canAdd = !readOnly && (can('ENTRY_CREATE') || can('EXIT_CREATE') || can('LOCATION_MANAGE'))

  const session = useQuery({ queryKey: ['session-photos', sessionId], queryFn: () => parkingApi.session(sessionId) })
  const photos = session.data?.photos || []

  const add = useMutation({
    mutationFn: async (file) => parkingApi.uploadPhoto(sessionId, await shrinkImage(file), kind),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-photos', sessionId] }),
  })

  const onPick = (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same picture can be chosen again
    if (file) add.mutate(file)
  }

  if (!canAdd && photos.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Vehicle photos</h3>
        {canAdd && (
          <>
            <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={onPick} />
            <Button variant="secondary" loading={add.isPending} onClick={() => input.current?.click()}>
              Take {KIND_LABELS[kind].toLowerCase()} photo
            </Button>
          </>
        )}
      </div>
      <Alert>{add.error && errorMessage(add.error)}</Alert>
      {photos.length === 0 ? (
        <p className="text-sm text-slate-500">{session.isLoading ? 'Loading…' : 'No photos yet.'}</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <Thumb key={photo._id} sessionId={sessionId} photo={photo} canDelete={can('LOCATION_MANAGE')} onOpen={(src, p) => setBig({ src, photo: p })} />
          ))}
        </div>
      )}

      {big && (
        <div
          role="dialog"
          aria-label="Photo"
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setBig(null)}
          onKeyDown={(event) => event.key === 'Escape' && setBig(null)}
        >
          <img src={big.src} alt={`${KIND_LABELS[big.photo.kind]} photo`} className="max-h-full max-w-full rounded-lg" />
          <button type="button" autoFocus className="absolute right-4 top-4 rounded-lg bg-white px-3 py-1 text-sm font-semibold" onClick={() => setBig(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
