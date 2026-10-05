import { useQuery } from '@tanstack/react-query'
import { bookingApi } from '../services/api'

// Customers who booked ahead and have not arrived yet, for one location, or
// pass 'all' for every location the signed-in user can see.
export function useBookings(locationId) {
  const everywhere = locationId === 'all'
  const query = useQuery({
    queryKey: ['bookings', locationId],
    queryFn: () => bookingApi.list(everywhere ? {} : { locationId }),
    enabled: Boolean(locationId),
    refetchInterval: 60_000,
  })
  return { ...query, bookings: query.data?.bookings || [] }
}
