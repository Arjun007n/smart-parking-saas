import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LiveContext } from './LiveContext'
import { connectLive } from '../services/live'
import { API_ORIGIN, tokenStore } from '../services/api'

// What to reload when the server says something happened.
const GATE_LISTS = ['locations', 'entries', 'collection', 'exits', 'operator-list', 'operator-summary', 'operator-collection', 'exit-search', 'dashboard']
const RELOAD = {
  anpr: ['anpr'],
  entry: GATE_LISTS,
  exit: GATE_LISTS,
  occupancy: GATE_LISTS,
  payment: ['payment', ...GATE_LISTS],
  command: ['command', 'hardware'],
  hardware: ['hardware'],
  notification: ['notifications'],
}

const STREAM_URL = `${API_ORIGIN}/api/live/stream`

// Keeps one live connection while someone is signed in and reloads what changed.
// Several events in quick succession cause one reload each (a short pause gathers them).
export function LiveProvider({ children, onLiveEvent }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('connecting')
  const wasLive = useRef(false)
  // The latest listener, kept in a ref so changing it never reconnects the stream.
  const listener = useRef(onLiveEvent)
  useEffect(() => {
    listener.current = onLiveEvent
  })

  useEffect(() => {
    const pending = new Set()
    let timer = null
    const flush = () => {
      timer = null
      for (const key of pending) queryClient.invalidateQueries({ queryKey: [key] })
      pending.clear()
    }
    const queue = (keys) => {
      keys.forEach((key) => pending.add(key))
      if (!timer) timer = setTimeout(flush, 150)
    }

    const stop = connectLive({
      url: STREAM_URL,
      getToken: () => tokenStore.get(),
      onStatus: (next) => {
        setStatus(next)
        // Anything that happened while the connection was down is picked up now.
        if (next === 'live') {
          if (wasLive.current) queue(['anpr', 'command', 'hardware', ...GATE_LISTS])
          wasLive.current = true
        }
      },
      onEvent: (type, data) => {
        queue(RELOAD[type] || [])
        if (listener.current) listener.current(type, data)
      },
    })
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [queryClient])

  return <LiveContext.Provider value={status}>{children}</LiveContext.Provider>
}
