import { Link, Outlet } from 'react-router-dom'

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <Link to="/" className="mb-6 text-2xl font-bold text-slate-900">
        Smart Parking SaaS
      </Link>
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <Outlet />
      </div>
    </div>
  )
}
