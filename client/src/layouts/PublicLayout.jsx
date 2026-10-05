import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SITE } from '../config/site'
import { homePathFor } from '../utils/roles'
import InstallApp from '../components/public/InstallApp'
import { useCart } from '../hooks/useCart'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/aboutus', label: 'About us' },
  { to: '/#features', label: 'Features' },
  { to: '/#subscription', label: 'Plan & pricing' },
  { to: '/product', label: 'Products' },
  { to: '/ResellerLogin', label: 'Partners' },
  { to: '/book', label: 'Book parking' },
  { to: '/faq', label: 'FAQ' },
  { to: '/blog', label: 'Blog' },
  { to: '/contact', label: 'Contact us' },
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
  const { isAuthenticated, user, permissions } = useAuth()
  const { count: cartCount } = useCart()
  useScrollToHash()

  const linkClass = 'rounded-md px-2.5 py-1.5 text-sm font-semibold text-[#1e3d73] transition hover:bg-blue-50 hover:text-[#007bff]'

  return (
    <div className="site-skin flex min-h-screen flex-col bg-white text-slate-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-xl font-extrabold text-[#1e3d73]">
            <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#007bff] to-[#0056b3] text-lg font-extrabold text-white">P</span>
            {SITE.name}
          </Link>
          <nav aria-label="Main" className="order-3 flex w-full flex-wrap gap-x-1 gap-y-1 md:order-2 md:w-auto">
            {NAV.map((item) =>
              item.to.includes('#') ? (
                <Link key={item.to} to={item.to} className={linkClass}>{item.label}</Link>
              ) : (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `${linkClass} ${isActive ? 'bg-blue-50 !text-[#007bff]' : ''}`}>
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>
          <div className="order-2 flex items-center gap-2 text-sm md:order-3">
            {cartCount > 0 && (
              <Link to="/cart" className="relative rounded-lg border border-slate-300 px-3 py-2 font-semibold text-[#1e3d73] hover:bg-blue-50" aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}>
                Cart
                <span className="ml-1.5 rounded-full bg-[#ff7a18] px-1.5 py-0.5 text-xs font-bold text-white">{cartCount}</span>
              </Link>
            )}
            {isAuthenticated ? (
              <Link to={homePathFor(user, permissions)} className="sp-press rounded-lg bg-gradient-to-r from-[#ff7a18] to-[#ff9a3c] px-4 py-2 font-bold text-white shadow hover:brightness-105">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="sp-press rounded-lg bg-gradient-to-r from-[#ff7a18] to-[#ff9a3c] px-4 py-2 font-bold text-white shadow hover:brightness-105">Login</Link>
                <Link to="/register" className="sp-press rounded-lg bg-gradient-to-r from-[#ff7a18] to-[#ff9a3c] px-4 py-2 font-bold text-white shadow hover:brightness-105">
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-[#0b2a55] text-slate-300">
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
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-slate-700 px-4 py-4 text-xs text-slate-400">
          <span>© {new Date().getFullYear()} {SITE.legalName || SITE.name}</span>
          <Link to="/privacy-policy" className="hover:text-white hover:underline">Privacy Policy</Link>
          <Link to="/terms-conditions" className="hover:text-white hover:underline">Terms &amp; Conditions</Link>
          <Link to="/sitemap" className="hover:text-white hover:underline">Sitemap</Link>
          <InstallApp className="rounded border border-slate-500 px-2 py-0.5 text-slate-200 hover:bg-white/10" />
        </div>
      </footer>
    </div>
  )
}

// Shared page heading band for the inner pages.
export function PageHeader({ title, intro }) {
  return (
    <div className="bg-gradient-to-b from-[#e8f1ff] to-white">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <h1 className="text-3xl font-extrabold text-[#0b4ea2] sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 max-w-2xl text-lg text-slate-600">{intro}</p>}
      </div>
    </div>
  )
}
