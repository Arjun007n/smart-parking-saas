// Small line icons for the gate staff header and buttons. Decorative: the text beside them says the same.
const base = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false }

export const HomeIcon = (props) => (
  <svg {...base} {...props}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" /></svg>
)
export const EnterIcon = (props) => (
  <svg {...base} {...props}><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></svg>
)
export const ExitIcon = (props) => (
  <svg {...base} {...props}><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
)
export const CarIcon = (props) => (
  <svg {...base} {...props}><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v3H3z" /><circle cx="7.5" cy="13.5" r="0.8" /><circle cx="16.5" cy="13.5" r="0.8" /></svg>
)
export const UserIcon = (props) => (
  <svg {...base} {...props}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
)
export const HistoryIcon = (props) => (
  <svg {...base} {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
)
export const PrintIcon = (props) => (
  <svg {...base} {...props}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1" /><path d="M7 14h10v7H7z" /></svg>
)
