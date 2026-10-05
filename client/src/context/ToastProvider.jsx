import { useCallback, useEffect, useRef, useState } from 'react'
import { ToastContext } from './ToastContext'

const TONES = {
  success: { bar: 'bg-green-500', icon: '✓' },
  error: { bar: 'bg-red-500', icon: '!' },
  info: { bar: 'bg-blue-500', icon: 'i' },
}
const MAX_VISIBLE = 4

// Small pop-up messages in the corner. They leave by themselves (errors stay a little longer) and
// can be closed. The corner is a polite live region, so screen readers hear them too.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    ({ title, message, tone = 'info', ms }) => {
      if (!title && !message) return
      const id = nextId.current
      nextId.current += 1
      setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, title, message, tone: TONES[tone] ? tone : 'info' }])
      timers.current.set(id, setTimeout(() => dismiss(id), ms || (tone === 'error' ? 7000 : 4000)))
    },
    [dismiss],
  )

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((timer) => clearTimeout(timer))
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="sp-toast pointer-events-auto flex overflow-hidden rounded-lg bg-white text-slate-900 shadow-lg ring-1 ring-slate-200">
            <span className={`flex w-8 shrink-0 items-center justify-center text-sm font-bold text-white ${TONES[t.tone].bar}`} aria-hidden="true">{TONES[t.tone].icon}</span>
            <div className="min-w-0 flex-1 px-3 py-2 text-sm">
              {t.title && <p className="font-semibold">{t.title}</p>}
              {t.message && <p className="text-slate-600">{t.message}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Close message" className="px-3 text-slate-400 hover:text-slate-700">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
