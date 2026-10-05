import { useContext } from 'react'
import { LiveContext } from '../context/LiveContext'

// 'live' while the server pushes changes to this screen, else 'connecting' or 'offline'.
export const useLiveStatus = () => useContext(LiveContext)

// How often a screen should still ask on its own: rarely while live (a safety net), often otherwise.
export const useFallbackInterval = (liveMs, otherMs) => (useContext(LiveContext) === 'live' ? liveMs : otherMs)
