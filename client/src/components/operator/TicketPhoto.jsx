import { useQuery } from '@tanstack/react-query'
import { parkingApi } from '../../services/api'

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

// The entry photo of a visit, small enough to sit on a ticket or receipt. Shows nothing until the
// picture is there (it is saved a moment after the ticket is made). Shares the cache of PhotoPanel.
export default function TicketPhoto({ sessionId }) {
  const session = useQuery({ queryKey: ['session-photos', sessionId], queryFn: () => parkingApi.session(sessionId) })
  const photo = (session.data?.photos || []).find((p) => p.kind === 'ENTRY')
  const { data: src } = useQuery({
    queryKey: ['photo', sessionId, photo?._id],
    queryFn: async () => readAsDataUrl(await parkingApi.photo(sessionId, photo._id)),
    enabled: Boolean(photo),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
  if (!src) return null
  return <img src={src} alt="Vehicle at entry" className="mx-auto mt-3 h-28 w-40 rounded object-cover" />
}
