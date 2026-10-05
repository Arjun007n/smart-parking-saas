import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { PageLoader } from './ui'
import { homePathFor } from '../utils/roles'

// Sends visitors to /login unless they are signed in. When `permission` is
// given, signed-in users without it go back to the dashboard.
// This is a convenience for the user; real security is on the API.
export function ProtectedRoute({ permission }) {
  const { isAuthenticated, loading, can, user, permissions } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (permission && !can(permission)) return <Navigate to={homePathFor(user, permissions)} replace />
  return <Outlet />
}

// Keeps signed-in users away from the login/register pages.
export function GuestRoute() {
  const { isAuthenticated, loading, user, permissions } = useAuth()
  if (loading) return <PageLoader />
  if (isAuthenticated) return <Navigate to={homePathFor(user, permissions)} replace />
  return <Outlet />
}
