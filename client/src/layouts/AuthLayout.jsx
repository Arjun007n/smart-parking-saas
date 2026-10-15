import { Link, Outlet } from 'react-router-dom'

// A blue "P" with a car, drawn here so the sign-in screen of the phone app needs no picture file.
function LogoMark() {
  return (
    <svg viewBox="0 0 96 96" width="88" height="88" aria-hidden="true">
      <defs>
        <linearGradient id="sp-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6df6" />
          <stop offset="1" stopColor="#0b2a8f" />
        </linearGradient>
      </defs>
      <path d="M22 84V16h34c16 0 26 9 26 22s-10 22-26 22H40v24z" fill="url(#sp-logo)" />
      <circle cx="56" cy="38" r="9" fill="#fff" opacity="0.95" />
      <path d="M8 76q2-9 12-10h26q8 0 12 6l6 2q4 2 4 6v4H8z" fill="#1e3a8a" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="24" cy="84" r="6" fill="#0f172a" stroke="#fff" strokeWidth="2" />
      <circle cx="56" cy="84" r="6" fill="#0f172a" stroke="#fff" strokeWidth="2" />
    </svg>
  )
}

export default function AuthLayout() {
  return (
    <div className="auth-shell flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <span className="auth-logo mb-2"><LogoMark /></span>
      <Link to="/" className="auth-title mb-6 text-2xl font-bold text-slate-900">
        Smart Parking SaaS
      </Link>
      <div className="auth-card w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <Outlet />
      </div>
    </div>
  )
}
