import { useEffect, useRef } from 'react'

const isTyping = (target) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

// Keyboard shortcuts for a screen. `map` is { 'F2': fn, 'Alt+b': fn, '/': fn, '?': fn }.
// Keys with Alt, Ctrl or an F-key work everywhere; plain keys (like "/" and "?") are ignored while
// the person is typing in a box. A shortcut that returns false lets the key do its normal job.
export function useShortcuts(map) {
  const latest = useRef(map)
  useEffect(() => {
    latest.current = map
  })

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing) return
      const parts = []
      if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)
      const name = parts.join('+')
      const action = latest.current[name]
      if (!action) return
      const modified = parts.length > 1 || /^F\d+$/.test(event.key)
      if (!modified && isTyping(event.target)) return
      if (action(event) !== false) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
