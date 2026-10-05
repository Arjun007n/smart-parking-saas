import { useQuery } from '@tanstack/react-query'
import { anprApi } from '../services/api'

// The camera registered for a gate and direction (the AI service or any plate-reading camera).
// `hasCamera`: there is one, so the screen uses it and does not ask for the computer's own camera.
// `ready`: the answer is known (a failed question counts as "no gate camera", so nothing is blocked).
export function useGateCamera(locationId, direction, gate) {
  const info = useQuery({
    queryKey: ['camera-preview', locationId, direction, gate || ''],
    queryFn: () => anprApi.preview({ locationId, direction, ...(gate ? { gate } : {}) }),
    enabled: Boolean(locationId),
    staleTime: 60_000,
    // Until the AI service has told the server its picture address, look again every 10 seconds.
    refetchInterval: (query) => (query.state.data?.previewUrl ? false : 10_000),
  })
  return {
    hasCamera: Boolean(info.data?.hasCamera),
    previewUrl: info.data?.previewUrl || null,
    name: info.data?.camera || null,
    // A camera that exists here but does not fit this gate: { name, direction, gate }.
    elsewhere: info.data?.elsewhere || null,
    ready: !locationId || info.isSuccess || info.isError,
  }
}
