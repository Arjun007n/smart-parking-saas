// A content security policy for the app's own pages (the WebView). It is put into the COPY of index.html that
// `npm run web` builds into mobile/web, never into the website's own index.html, so the website and the Vite dev
// server are not affected.
//
// Release only: the app may call only itself and the server in API_URL (plus Google Maps, which the shared pages can
// load). Test mode (APP_DEV=1) gets no policy because the emulator rewrites the server address at run time.

// The origin of API_URL, e.g. "https://api.your-site.example:8443".
const originOf = (api) => new URL(api).origin;

export const mobileCsp = ({ api }) =>
  [
    "default-src 'self'",
    "script-src 'self' https://maps.googleapis.com https://maps.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${originOf(api)} https://maps.googleapis.com`,
    "frame-src https://www.google.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

const META_MARK = 'http-equiv="Content-Security-Policy"';

// Puts the policy right after the charset tag (or <head>), before any script. Running again changes nothing.
export const injectCsp = (html, csp) => {
  if (html.includes(META_MARK)) return html;
  const tag = `<meta ${META_MARK} content="${csp}" />`;
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  if (charset) return html.replace(charset[0], () => `${charset[0]}\n    ${tag}`);
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.replace(head[0], () => `${head[0]}\n    ${tag}`);
  throw new Error("index.html has no <head> to put the content security policy in.");
};
