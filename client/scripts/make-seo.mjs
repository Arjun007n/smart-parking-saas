// Writes public/sitemap.xml and public/robots.txt before a production build.
// Set VITE_SITE_URL (for example https://www.yourparking.com) in client/.env or in the build environment.
// Without it the sitemap is skipped and robots.txt has no Sitemap line, because a sitemap needs full addresses.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readEnvFile = () => {
  const file = join(root, '.env')
  if (!existsSync(file)) return {}
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  )
}

const site = (process.env.VITE_SITE_URL || readEnvFile().VITE_SITE_URL || '').replace(/\/+$/, '')
const PAGES = [
  ['/', 'weekly', '1.0'],
  ['/book', 'weekly', '0.8'],
  ['/product', 'monthly', '0.8'],
  ['/aboutus', 'monthly', '0.6'],
  ['/faq', 'monthly', '0.6'],
  ['/blog', 'weekly', '0.6'],
  ['/contact', 'monthly', '0.6'],
  ['/register', 'monthly', '0.7'],
  ['/privacy-policy', 'yearly', '0.3'],
  ['/terms-conditions', 'yearly', '0.3'],
]

mkdirSync(join(root, 'public'), { recursive: true })
const robots = ['User-agent: *', 'Allow: /', 'Disallow: /dashboard', 'Disallow: /operator', 'Disallow: /cart', 'Disallow: /checkout', 'Disallow: /api/']

if (site) {
  const today = new Date().toISOString().slice(0, 10)
  const urls = PAGES.map(
    ([path, freq, priority]) =>
      `  <url><loc>${site}${path}</loc><lastmod>${today}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`,
  ).join('\n')
  writeFileSync(
    join(root, 'public', 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  )
  robots.push(`Sitemap: ${site}/sitemap.xml`)
  console.log(`sitemap.xml written for ${site}`)
} else {
  console.log('VITE_SITE_URL is not set: sitemap.xml skipped (set it to your public address before the production build).')
}
writeFileSync(join(root, 'public', 'robots.txt'), `${robots.join('\n')}\n`)
