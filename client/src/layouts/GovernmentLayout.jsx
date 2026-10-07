import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui'

// The frame of the government officer's pages: who is signed in, and Log out. Nothing else to open.
export default function GovernmentLayout() {
  const { user, company, logout } = useAuth()
  const navigate = useNavigate()

  const signOut = async () => {
    await logout()
    navigate('/government/login')
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="no-print border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="leading-tight">
            <p className="text-base font-extrabold text-slate-900">Government reports</p>
            <p className="text-xs text-slate-600">
              {company?.name ? `${company.name} · ` : ''}
              {user?.name} · Government Officer
            </p>
          </div>
          <Button variant="secondary" onClick={signOut}>Log out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
