import { useMemo } from 'react'
import { encode } from '../utils/qr'

// Draws a QR code as an inline SVG. It is made in the browser, so nothing is
// sent to an outside service and it prints crisply at any size.
export default function QrCode({ value, size = 120, level = 'M', label, className = '' }) {
  const drawing = useMemo(() => {
    try {
      const { size: modules, modules: grid } = encode(String(value), { level })
      const margin = 2
      let path = ''
      for (let y = 0; y < modules; y += 1) {
        for (let x = 0; x < modules; x += 1) {
          if (grid[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`
        }
      }
      return { full: modules + margin * 2, path }
    } catch {
      return null // too long to fit in a QR code
    }
  }, [value, level])

  if (!drawing) return null
  return (
    <svg
      role="img"
      aria-label={label || `QR code for ${value}`}
      viewBox={`0 0 ${drawing.full} ${drawing.full}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={drawing.full} height={drawing.full} fill="#fff" />
      <path d={drawing.path} fill="#000" />
    </svg>
  )
}
