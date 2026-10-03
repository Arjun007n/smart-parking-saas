import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SITE } from '../config/site'
import { homePathFor } from '../utils/roles'

const NAV = [
  { to: '/#features', label: 'Features' },
  { to: '/#subscription', label: 'Pricing' },
  { to: '/product', label: 'Hardware' },
  { to: '/blog', label: 'Blog' },
  { to: '/faq', label: 'FAQ' },
  { to: '/aboutus', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

// Scrolls to the section named in the address (#features), or to the top
// when moving to another page.
function useScrollToHash() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else window.scrollTo(0, 0)
  }, [pathname, hash])
}

export default function PublicLayout() {
  const { isAuthenticated, user } = useAuth()
  useScrollToHash()

  const linkClass = 'rounded px-2 py-1 text-sm text-slate-200 hover:text-white'

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
          <Link to="/" className="text-xl font-bold">{SITE.name}</Link>
          <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-x-1 gap-y-1 md:order-2 md:w-auto">
            {NAV.map((item) =>
              item.to.includes('#') ? (
                <Link key={item.to} to={item.to} className={linkClass}>{item.label}</Link>
              ) : (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => `${linkClass} ${isActive ? 'font-semibold text-white underline underline-offset-4' : ''}`}>
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="order-2 flex items-center gap-2 text-sm md:order-3">
            {isAuthenticated ? (
              <Link to={homePathFor(user.role)} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-700">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="px-3 py-2 hover:underline">Log in</Link>
                <Link to="/register" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold hover:bg-blue-700">
                  Start free trial
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-slate-900 text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
          <div>
            <p className="text-base font-bold text-white">{SITE.name}</p>
            <p className="mt-2">{SITE.description}</p>
          </div>
          <nav aria-label="Footer">
            <p className="font-semibold text-white">Explore</p>
            <ul className="mt-2 space-y-1">
              {NAV.map((item) => (
                <li key={item.to}><Link to={item.to} className="hover:text-white hover:underline">{item.label}</Link></li>
              ))}
              <li><Link to="/ResellerLogin" className="hover:text-white hover:underline">Partners</Link></li>
              <li><Link to="/login" className="hover:text-white hover:underline">Operator login</Link></li>
            </ul>
          </nav>
          <div>
            <p className="font-semibold text-white">Contact</p>
            <ul className="mt-2 space-y-1">
              {SITE.email && <li><a href={`mailto:${SITE.email}`} className="hover:text-white hover:underline">{SITE.email}</a></li>}
              {SITE.phone && <li><a href={`tel:${SITE.phone.replace(/\s/g, '')}`} className="hover:text-white hover:underline">{SITE.phone}</a></li>}
              {SITE.address && <li>{SITE.address}</li>}
              <li><Link to="/contact" className="hover:text-white hover:underline">Send us a message</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-slate-700 px-4 py-4 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} {SITE.name}
        </p>
      </footer>
    </div>
  )
}

// Shared page heading band for the inner pages.
export function PageHeader({ title, intro }) {
  return (
    <div className="bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 max-w-2xl text-lg text-slate-600">{intro}</p>}
      </div>
    </div>
  )
}
