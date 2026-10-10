import { useState } from 'react'

// The base of every Pass Management route.
export const PM = '/dashboard/pass-management'

export const ENTRY_SIZES = [25, 50, 100, 200, 500, 1000, 2000]

// A tiny hook for "which page, how many per page, what was typed": the state every list needs.
export function useListState(initial = {}) {
  const [state, setState] = useState({ page: 1, limit: 25, ...initial })
  const patch = (changes) => setState((s) => ({ ...s, page: 1, ...changes }))
  const setPage = (page) => setState((s) => ({ ...s, page }))
  return [state, patch, setPage]
}
