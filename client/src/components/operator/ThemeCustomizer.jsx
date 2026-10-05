import { Button } from '../ui'
import { THEME_COLORS } from '../../hooks/useTheme'

// A small panel for the colour of the header, light or dark pages, and a compact menu.
export default function ThemeCustomizer({ theme, setTheme, reset, onClose }) {
  return (
    <div role="dialog" aria-label="Customize your template" className="no-print absolute right-4 top-full z-30 mt-2 w-72 rounded-xl bg-white p-4 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Customize your template</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-slate-500 hover:text-slate-900">×</button>
      </div>

      <p className="mb-1 font-medium">Template colour</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {THEME_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.name}
            aria-label={c.name}
            aria-pressed={theme.color === c.value}
            onClick={() => setTheme({ color: c.value })}
            className={`h-7 w-7 rounded-full ring-offset-2 ${theme.color === c.value ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-300'}`}
            style={{ backgroundColor: c.value }}
          />
        ))}
        <input
          type="color"
          aria-label="Pick another colour"
          value={theme.color}
          onChange={(event) => setTheme({ color: event.target.value })}
          className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0"
        />
      </div>

      <p className="mb-1 font-medium">Template style</p>
      <div className="mb-4 flex gap-4">
        {[['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="theme-style" checked={theme.style === value} onChange={() => setTheme({ style: value })} />
            {label}
          </label>
        ))}
      </div>

      <label className="mb-4 flex items-center gap-2">
        <input type="checkbox" checked={theme.compact} onChange={(event) => setTheme({ compact: event.target.checked })} />
        Compact menu
      </label>

      <Button variant="secondary" onClick={reset}>Reset</Button>
    </div>
  )
}
