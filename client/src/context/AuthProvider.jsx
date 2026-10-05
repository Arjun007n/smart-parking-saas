import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AuthContext } from './AuthContext'
import { authApi, tokenStore } from '../services/api'

const signedOut = { user: null, company: null, permissions: [] }

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(signedOut)
  // True while we check whether a saved token is still valid.
  const [loading, setLoading] = useState(() => Boolean(tokenStore.get()))

  useEffect(() => {
    if (!tokenStore.get()) return
    let cancelled = false
    authApi
      .me()
      .then((data) => {
        if (!cancelled) setSession(data)
      })
      .catch(() => tokenStore.clear())
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Roles can be edited while someone is logged in. The server applies the
  // change at once; this makes the menus catch up when the person comes back
  // to the tab, instead of waiting for a reload.
  const signedIn = Boolean(session.user)
  useEffect(() => {
    if (!signedIn) return undefined
    const refresh = () => {
      if (document.visibilityState === 'hidden' || !tokenStore.get()) return
      authApi
        .me()
        .then((data) =>
          setSession((current) => {
            const same =
              JSON.stringify([current.permissions, current.user?.role, current.user?.customRole]) ===
              JSON.stringify([data.permissions, data.user?.role, data.user?.customRole])
            return same ? current : data
          }),
        )
        .catch(() => {
          // A failed check is not a reason to sign out; the next request will say if the session ended.
        })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [signedIn])

  const start = useCallback(({ token, ...rest }) => {
    tokenStore.set(token)
    setSession(rest)
    return rest
  }, [])

  const login = useCallback(async (values) => start(await authApi.login(values)), [start])
  const register = useCallback(async (values) => start(await authApi.register(values)), [start])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Even if the server call fails, sign out on this device.
    }
    tokenStore.clear()
    queryClient.clear()
    setSession(signedOut)
  }, [queryClient])

  const setCompany = useCallback((company) => setSession((s) => ({ ...s, company })), [])
  const setUser = useCallback((user) => setSession((s) => ({ ...s, user: { ...s.user, ...user } })), [])

  const value = useMemo(
    () => ({
      ...session,
      loading,
      isAuthenticated: Boolean(session.user),
      // For showing/hiding UI only. The backend checks every request.
      can: (permission) => session.permissions.includes(permission),
      login,
      register,
      logout,
      setCompany,
      setUser,
    }),
    [session, loading, login, register, logout, setCompany, setUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
