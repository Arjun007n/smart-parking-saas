import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A number that counts up (or down) to its new value. `format` turns the number into text.
export function CountUp({ value, format = (n) => String(Math.round(n)), ms = 600 }) {
  const target = Number.isFinite(value) ? value : 0
  const [shown, setShown] = useState(target)
  const from = useRef(target)

  useEffect(() => {
    if (reducedMotion() || from.current === target) {
      from.current = target
      const id = requestAnimationFrame(() => setShown(target))
      return () => cancelAnimationFrame(id)
    }
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - (1 - t) ** 3
      const current = begin + (target - begin) * eased
      from.current = current
      setShown(current)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, ms])

  return <span className="tabular-nums">{format(shown)}</span>
}

// A grey placeholder shown while data loads.
export function Skeleton({ className = 'h-4 w-full' }) {
  return <div aria-hidden="true" className={`sp-skeleton rounded-md ${className}`} />
}

// Placeholder for a card of numbers.
export function CardSkeleton({ count = 4 }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

// How full something is: green, then amber, then red as it fills. `used` and `total` are counts.
export function FillBar({ used, total, label }) {
  const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const tone = percent >= 100 ? 'bg-red-500' : percent >= 80 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

// Fades and slides its content in when it scrolls into view (once). Shows at once when the
// browser cannot observe, or when the person asked for less motion.
export function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined' || reducedMotion())

  useEffect(() => {
    const node = ref.current
    if (seen || !node) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [seen])

  return (
    <div ref={ref} className={`${seen ? 'sp-revealed' : 'sp-hidden-until-seen'} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}
