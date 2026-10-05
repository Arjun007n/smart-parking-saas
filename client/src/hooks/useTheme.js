import { useState } from 'react'

const STORAGE_KEY = 'sp_theme'
export const THEME_COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Slate', value: '#0f172a' },
  { name: 'Navy', value: '#1e3d73' },
  { name: 'Green', value: '#166534' },
  { name: 'Teal', value: '#115e59' },
  { name: 'Purple', value: '#581c87' },
  { name: 'Red', value: '#991b1b' },
]
export const DEFAULT_THEME = { color: '#ffffff', style: 'light', compact: false }

const read = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : DEFAULT_THEME.color,
      style: saved.style === 'dark' ? 'dark' : 'light',
      compact: saved.compact === true,
    }
  } catch {
    return DEFAULT_THEME
  }
}

// True when white text would be hard to read on this colour.
export const isLightColor = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (r * 299 + g * 587 + b * 114) / 1000 > 160
}

// How the gate staff screens look: header colour, light or dark pages, and a
// smaller menu. Kept on this device only.
export function useTheme() {
  const [theme, setThemeState] = useState(read)
  const setTheme = (patch) => {
    const next = { ...theme, ...patch }
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not being able to remember the choice is harmless.
    }
  }
  const reset = () => setTheme(DEFAULT_THEME)
  return { theme, setTheme, reset }
}
