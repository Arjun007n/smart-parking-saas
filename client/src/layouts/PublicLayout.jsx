import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { SITE } from '../config/site'
import { homePathFor } from '../utils/roles'
import InstallApp from '../components/public/InstallApp'
import { useCart } from '../hooks/useCart'
import { Icon } from '../components/public/Art'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/aboutus', label: 'About us', short: 'About' },
  { to: '/#features', label: 'Features' },
  { to: '/#subscription', label: 'Plan & pricing', short: 'Pricing' },
  { to: '/product', label: 'Products' },
  { to: '/ResellerLogin', label: 'Partners' },
  { to: '/book', label: 'Book parking' },
  { to: '/faq', label: 'FAQ' },
  { to: '/blog', label: 'Blog' },
  { to: '/contact', label: 'Contact us', short: 'Contact' },
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

function CartIcon({ count }) {
  return (
    <Link
      to="/cart"
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-[#0047ab] transition hover:bg-blue-50"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-6 w-6">
        <path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM1 2v2h2l3.6 7.600-1.400 2.400A2 2 0 0 0 7 17h12v-2H7.400l1.100-2h7.500a2 2 0 0 0 1.700-1l3.600-6.500A1 1 0 0 0 20.400 4H5.200l-.9-2H1Z" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#fc7800] px-1 text-[11px] font-bold text-white">{count}</span>
    </Link>
  )
}

export default function PublicLayout() {
  const { isAuthenticated, user, permissions } = useAuth()
  const { count: cartCount } = useCart()
  const [open, setOpen] = useState(false)
  useScrollToHash()

  const close = () => setOpen(false)

  return (
    <div className="site-skin flex min-h-screen flex-col bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-[#e1eaf7] bg-white/95 shadow-[0_6px_20px_-14px_rgba(16,35,63,0.35)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" onClick={close} className="flex shrink-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#1867e1] to-[#0047ab] font-['Outfit'] text-xl font-extrabold text-white shadow-md shadow-blue-600/30">P</span>
            <span className="pub-display whitespace-nowrap text-base font-bold sm:text-lg leading-tight text-[#0047ab]">{SITE.name}</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-x-5 xl:flex">
            {NAV.map((item) =>
              item.to.includes('#') ? (
                <Link key={item.to} to={item.to} className="pub-nav-link">{item.short || item.label}</Link>
              ) : (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `pub-nav-link ${isActive ? 'is-active' : ''}`}>
                  {item.short || item.label}
                </NavLink>
              ),
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <CartIcon count={cartCount} />
            {isAuthenticated ? (
              <Link to={homePathFor(user, permissions)} className="pub-pill">Go to dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="pub-pill">Login</Link>
                <Link to="/register" className="pub-pill hidden sm:inline-flex">Register</Link>
              </>
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((value) => !value)}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#eaf2ff] text-[#0047ab] xl:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="h-6 w-6">
                {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>

        {open && (
          <nav id="mobile-menu" aria-label="Main (mobile)" className="border-t border-[#e1eaf7] bg-white px-4 py-3 xl:hidden">
            <ul className="mx-auto grid max-w-7xl gap-1 sm:grid-cols-2">
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} onClick={close} className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-[#10233f] hover:bg-[#eef4ff]">{item.label}</Link>
                </li>
              ))}
              {!isAuthenticated && (
                <li className="sm:hidden">
                  <Link to="/register" onClick={close} className="block rounded-lg bg-[#fc7800] px-3 py-2.5 text-center text-sm font-semibold text-white">Register</Link>
                </li>
              )}
            </ul>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="pub-night">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white font-['Outfit'] text-xl font-extrabold text-[#0047ab]">P</span>
              <span className="pub-display text-lg font-bold text-white">{SITE.name}</span>
            </div>
            <p className="mt-4 leading-relaxed text-blue-100">{SITE.description}</p>
            {SITE.address && (
              <p className="mt-4 flex gap-2 text-blue-100">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9a3c]" />
                {SITE.address}
              </p>
            )}
          </div>
          <nav aria-label="Footer">
            <p className="pub-display text-base font-semibold text-white">Quick links</p>
            <ul className="mt-4 space-y-2 text-blue-100">
              {NAV.slice(0, 5).map((item) => (
                <li key={item.to}><Link to={item.to} className="hover:text-white hover:underline">{item.label}</Link></li>
              ))}
            </ul>
          </nav>
          <nav aria-label="More links">
            <p className="pub-display text-base font-semibold text-white">Explore</p>
            <ul className="mt-4 space-y-2 text-blue-100">
              {NAV.slice(5).map((item) => (
                <li key={item.to}><Link to={item.to} className="hover:text-white hover:underline">{item.label}</Link></li>
              ))}
              <li><Link to="/login" className="hover:text-white hover:underline">Operator login</Link></li>
            </ul>
          </nav>
          <div>
            <p className="pub-display text-base font-semibold text-white">Get in touch</p>
            <ul className="mt-4 space-y-3 text-blue-100">
              {SITE.phone && (
                <li className="flex items-center gap-2">
                  <Icon name="phone" className="h-4 w-4 text-[#ff9a3c]" />
                  <a href={`tel:${SITE.phone.replace(/\s/g, '')}`} className="hover:text-white hover:underline">{SITE.phone}</a>
                </li>
              )}
              {SITE.email && (
                <li className="flex items-center gap-2">
                  <Icon name="mail" className="h-4 w-4 text-[#ff9a3c]" />
                  <a href={`mailto:${SITE.email}`} className="hover:text-white hover:underline">{SITE.email}</a>
                </li>
              )}
              <li>
                <Link to="/contact" className="pub-btn pub-btn-orange !px-4 !py-2 text-sm">Send us a message</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/10 px-4 py-5 text-xs text-blue-200">
          <span>© {new Date().getFullYear()} {SITE.legalName || SITE.name}. All rights reserved.</span>
          <Link to="/privacy-policy" className="hover:text-white hover:underline">Privacy Policy</Link>
          <Link to="/terms-conditions" className="hover:text-white hover:underline">Terms &amp; Conditions</Link>
          <Link to="/sitemap" className="hover:text-white hover:underline">Sitemap</Link>
          <Link to="/government/login" className="hover:text-white hover:underline">Government login</Link>
          <InstallApp className="rounded border border-white/30 px-2 py-0.5 text-blue-100 hover:bg-white/10" />
        </div>
      </footer>
    </div>
  )
}

// Shared page heading band for the inner pages.
export function PageHeader({ title, intro }) {
  return (
    <div className="pub-hero-bg relative overflow-hidden">
      <div aria-hidden="true" className="pub-dots absolute inset-y-0 right-0 hidden w-1/3 opacity-60 md:block" />
      <div className="relative mx-auto max-w-6xl px-4 py-14">
        <h1 className="pub-title !text-4xl sm:!text-5xl">{title}</h1>
        {intro && <p className="pub-lead mt-3 max-w-2xl text-lg">{intro}</p>}
      </div>
    </div>
  )
}
