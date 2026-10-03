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
    }),
    [session, loading, login, register, logout, setCompany],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
