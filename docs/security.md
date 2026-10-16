# Security and release checklist (Day 29)

Status of every item the plan asks to verify. "Tested" means an automated
test in `server/tests` proves it. "At deployment" means it depends on how and
where the system is hosted and must be done on Day 30.

## Plan checklist

| Item | Status | How |
|---|---|---|
| HTTPS | At deployment | The host provides the certificate. HSTS header is sent. Set `FORCE_HTTPS=true` if the host does not redirect http itself |
| Password hashing | Tested | bcrypt, cost 12. Plain passwords are never stored or returned |
| JWT/session security | Tested | HS256 only; unsigned, re-signed, altered, expired and orphaned tokens are refused; 7-day expiry; logout, password change, deactivation and role change end existing sessions |
| Tenant isolation | Tested | 32 different requests against another company's records are all refused, with and without the Super Admin header |
| Backend RBAC | Tested | Every route checks permissions on the server |
| Input validation | Tested | Each route lists the fields it accepts; anything else is dropped; wrong types are refused (blocks database-operator injection) |
| Rate limiting | Tested | 600 requests/min per IP for the whole API; 20 per 15 min on register and password routes; 100 per 15 min on login; 5 per 15 min on the contact form |
| CSRF protection | Not needed | Login uses an `Authorization` header, not cookies, so a foreign site cannot send it |
| CORS | Tested | Only the addresses in `CLIENT_URL` (one or several, comma separated) may call the API from a browser. In production `CLIENT_URL` is required and must be https, or the server will not start |
| Operators in requests | Tested | Any `$operator` key in a body, query or route parameter is refused with 400 (`middleware/noOperators.js`), on top of each route's field list |
| Security headers | Tested (API) | helmet: no-sniff, frame options, HSTS, content security policy; `X-Powered-By` removed. The website's own pages get theirs from the host: `client/public/_headers` has them (see "Website security headers" below) |
| Payment webhook verification | Tested | HMAC-SHA256 over the exact body, constant-time comparison; refused when no secret is set |
| Audit logs | Tested | Append-only in the model, no API to change them |
| Secret management | Partly | Secrets live in `.env`, which Git ignores. Production secrets must be set in the host's settings, never in files. **Rotate the database password** that was shared in chat |
| File access control | Not applicable | The system stores no uploaded files yet |
| Database backups | Built, run it yourself | `npm run backup` writes every collection to `server/backups/` |
| Restore testing | Built, run it yourself | `npm run restore -- <folder>` restores into a separate `_restore` database and verifies the counts |
| Error monitoring | Hook built | Unexpected errors go through `server/utils/monitor.js` as structured log lines. No external service is connected |
| Idempotency for duplicate-sensitive operations | Tested | See "Duplicate and parallel requests" below |

## What was tested for Day 29

| Plan item | Test |
|---|---|
| Authentication and authorization | Login, lock after 10 wrong passwords, password change, token forgery, every protected route without a login |
| Tenant isolation | The sweep described above, plus per-feature tests from earlier weeks |
| Tariff calculations | 21 unit tests of the fee engine |
| Entry and exit | End-to-end flow tests |
| Duplicate requests and duplicate exits | Parallel tests, below |
| Invalid tickets, invalid payments | Unknown ticket, ticket from another location, mismatched vehicle, wrong amount, unknown method, payment before fee calculation |
| Full parking | Entry refused at capacity; six simultaneous arrivals for two spaces admit exactly two |
| Government officer opening anything else | One check on every request (`middleware/auth.js`): an officer reaches only `/api/government` and `/api/auth`, everything else is 403 |
| Wrong location, wrong operator | Operators cannot act outside their assigned locations or roles |
| Network failures | A retried entry or a retried payment returns the original result instead of creating a second one |

### Duplicate and parallel requests

Each is sent six times at the same moment against the real database:

- Same vehicle entering: one ticket, one space taken.
- Same entry retried with its request key: the same ticket every time.
- More arrivals than free spaces: never more vehicles than capacity.
- Same ticket exiting: the space is freed once.
- Same session paid: one successful payment, counted once in the shift.
- Same payment refunded, same shift closed or opened: happens once.
- Afterwards, each location's occupancy equals its number of open sessions.

## Security review of 13 October 2026

A code review of the whole site found no way for an outsider to break in. What it found, and what was done:

| Finding | What was done |
|---|---|
| The customer's booking link and the reset link carry a secret in the address (`?token=`), and the production log wrote full addresses | The log now hides `token`, `key`, `code`, `secret` and `password` values in the address and in the referrer (`server/utils/redactUrl.js`, tested) |
| The server trusted exactly one proxy, whatever the hosting | `TRUST_PROXY` (0 to 5, default 1) sets how many proxies sit in front. See below |
| The website's pages had no security headers of their own (only the API did) | `client/public/_headers` carries a content security policy, frame protection, no-sniff, a referrer policy that sends the site name only (so a token in a page address never leaves the site), a permissions policy and HSTS |

Looked at and left as they are, on purpose:

* **Sign-in token lasts 7 days.** Gate staff stay signed in across shifts. Set `JWT_EXPIRES_IN` (for example `12h`) to make it shorter. In the mobile app the token must be kept in the phone's secure storage, not browser storage.
* **The 15-minute account lock can be set off by someone who knows a login ID** (ten wrong passwords). The locked person opens Forgot password: a reset clears the lock at once.
* **Sign-up says when an email is already registered, and the company-code check says when a code is taken.** The signup form needs both answers; they are rate limited.
* **Password rule** is 8 to 72 characters, by choice.
* **Rate limits are kept in the server's memory.** One server process is fine. With several instances, move them to a shared store such as Redis.

### TRUST_PROXY

The rate limits and the audit log use the caller's IP address, which the server reads from the proxy in front of it. Set `TRUST_PROXY` to the number of proxies: **1** for Render alone, **2** with a CDN such as Cloudflare in front of Render, **0** with none. Too low, and everyone shares one address (one busy gate can use up everybody's limit); too high, and a caller can write their own address into the header.

### Website security headers

The API sets its own headers; the website's pages come from a separate static host. `client/public/_headers` is read by Netlify and Cloudflare Pages. On Render, open the static site's Settings, then Headers, and add each header name and value from that file for the path `/*`. After deploying, open the site with the browser console open: the policy lists anything it blocks (for example a new outside service). The policy allows Google Maps and Google Fonts, the API on https, and the gate agent's live picture on `127.0.0.1`.

### Narrowing `connect-src` to the real API address

`client/public/_headers` has `connect-src 'self' https:` because the repository does not know the API's host name. Once the API has its final address (for example `https://api.your-site.example`), replace the two words after `'self'` so the pages may call only that server:

```
connect-src 'self' https://api.your-site.example https://maps.googleapis.com
```

* Keep every API origin the site really calls (if the API is on two hosts, list both). `https://maps.googleapis.com` is for Google Maps; keep it while the maps are used.
* `img-src` is left wide (`https:`) on purpose: pictures come from the API's upload addresses, Google Maps tiles and other hosts that are not fixed. Narrow it the same way only after listing them in the browser console.
* `style-src` keeps `'unsafe-inline'` because React sets inline `style` attributes; removing it would break layouts. Do not change it without testing every page.
* After changing the header, open each main screen with the browser console open; a blocked call is named there ("Refused to connect to ..."). Roll back by putting `https:` back.

The phone app's pages get their own, tighter policy automatically in release builds: `npm run web` adds a `Content-Security-Policy` meta tag to the app's copy of `index.html` (`mobile/scripts/csp.mjs`) with `connect-src` limited to the app itself and the `API_URL` address. The website's `index.html` is never touched. Set `APP_CSP=0` to leave it out; test mode (`APP_DEV=1`) never gets one.

## Hardening of 16 October 2026 (gate agent and phone app)

| Finding | What was done |
|---|---|
| Gate-agent listeners (camera port 8081, RFID 8082, FASTag 8083) accepted forged events from anyone on the network | They listen on `127.0.0.1` by default (`options.bind`). A non-local `bind` without `options.secret` stops the agent at start with a clear message. The secret may be sent in the `x-agent-secret` header or, as before, in `?secret=`; it is compared in constant time. **A camera on another machine now needs `"bind": "0.0.0.0"` and a secret** (see `gate-agent/README.md`) |
| The live-picture token never changed and the picture was sent with `access-control-allow-origin: *` | The token includes a random value picked at each agent start (the agent re-sends its address to the cloud with every heartbeat). No CORS header is sent unless the request's `Origin` is listed in `previewOrigins`; the Entry and Exit screens show the picture in an `<img>`, which needs none |
| The agent accepted a plain `http://` server address and sent the device key over it | `serverUrl` must be `https://`. Plain `http://` is accepted only for localhost and private LAN addresses, or with `GATE_AGENT_ALLOW_HTTP=1` |
| The phone app fell back to `localStorage` for the sign-in token when secure storage failed | In a release app the token then stays in memory for that run only; the fallback is kept in test mode (`APP_DEV=1`) and in the website |
| The plate reader decoded any size of picture | Over 4 MB of base64 is refused, the size is read first and the picture is shrunk to at most 2048 pixels; running out of memory rejects the call instead of crashing the app |
| A release could be built in test mode or with plain http allowed | `npm run check:release` (in `mobile`) fails when `APP_DEV=1`, when `API_URL` is http or private, or when the Android project allows plain http, backup or debugging. The Android project gets a `network_security_config.xml` (plain http off, on only in test mode) and release builds are minified with R8 |
| No lock files for `mobile` and `gate-agent` | Not possible without the package registry: run `npm install` in each folder, commit the generated `package-lock.json`, and use `npm ci` from then on (see the two READMEs) |


Found while reviewing the code, and fixed:

1. **Login response time revealed registered emails.** Unknown emails now do
   the same password-hash work as real ones.
2. **No limit on guessing one account from many IP addresses.** Ten wrong
   passwords now lock the account for 15 minutes.
3. **Users could not change their own password.** Operators kept the password
   their admin chose. Added "My account" with change password.
4. **Internal error text was shown when `NODE_ENV` was not set.** Error
   details and the development reset link now need `NODE_ENV` to be exactly
   `development` or `test`.
5. **A token's user id was passed to the database without a type check.** It
   needed a validly signed token to matter, but it is now checked.
6. **Only login and contact routes were rate limited.** Added a limit for the
   whole API.
7. **A location admin editing a shared operator removed the operator from
   other locations.** Other locations' assignments are now kept.
8. **A payment retried after a lost connection showed an error** although the
   first attempt had succeeded. The retry now returns the original payment.
9. **A new vehicle entering twice at the same moment could get a confusing
   error.** The second request now reads the record the first one created.
10. Tokens are now verified against one fixed algorithm (HS256).
11. The server now shuts down cleanly and reports unhandled errors.

## Known limits (accepted for the MVP, decide before going live)

| Limit | Risk | What would fix it |
|---|---|---|
| The login token is kept in the browser's localStorage | A script injected into the web app could read it. The app renders all user text as text, never as HTML, which is the main defence | An httpOnly cookie plus CSRF protection |
| Registration and the lock message reveal whether an email is registered | Low; limited by rate limits | Email-based confirmation flows |
| Password reset emails are not sent | Users who forget a password need an admin to reset it | Connect an email provider |
| New operators get a password chosen by their admin and are not forced to change it | The admin knows it until the user changes it | "Must change password at first login" |
| Rate limits are kept in the server's memory | They reset on restart and are per server process | A shared store such as Redis, when running more than one server |
| Entry and payment are not database transactions | A crash between two writes could leave occupancy off by one | Transactions (needs a replica set, which Atlas has) or a reconciliation job; a test checks occupancy against open sessions |
| An online payment started before a fee is recalculated could complete for the earlier amount | Only when a gateway is connected | Cancel pending online payments when the fee changes |
| No external error-monitoring service | Errors are only in the host's logs | Connect one in `server/utils/monitor.js` |
| Dependency vulnerabilities not reviewed | `npm install` reported 3 high-severity advisories | Run `npm audit` in `server` and `client`; apply fixes that do not need `--force` |

## Before every release

1. `npm test` in `server`: all tests pass, none skipped.
2. `npm run lint` and `npm run build` in `client`.
3. `npm audit` in both folders.
4. `npm run backup`, then restore it into a `_restore` database once.


## Your security checklist, item by item (checked against the code, October 2026)

**Done and tested in code**
* Passwords: bcrypt, cost 12. Tokens: HS256 only, 7-day expiry (`JWT_EXPIRES_IN`), checked on every protected route, ended by logout, password change, deactivation or role change.
* Rate limits: login, register, password routes, OTP, contact form, checkout, and the whole API per IP. Request bodies are limited to 100 KB.
* Errors: production answers say "Something went wrong"; stack traces and details show only when `NODE_ENV` is `development` or `test`.
* Every route except the public booking and gate-device routes sits behind `protect`, then the tenant filter, then a permission check. The gate-device routes use a device key.
* Another company's data cannot be reached by changing an id (the isolation sweep). Roles: nobody can manage a role equal to or above their own, so nobody can promote or edit themselves through the user screens (test added).
* IDs, types and allowed fields are validated per route; unknown fields are dropped.
* Bookings and entries: parallel tests prove one ticket, one space and no overfilling. Money, shifts, refunds and sensitive changes are written to the append-only audit log.
* `.env` and device keys are in `.gitignore`. Secrets are read from environment variables, and `JWT_SECRET` must be 32+ characters in production.

**Needs you (cannot be done from code)**
* MongoDB Atlas: Network Access must not be `0.0.0.0/0` in production (allow only the host's addresses), and the app's database user should have only readWrite on its own database, not Atlas admin. Rotate the database password that was shared in chat.
* HTTPS: the host (Render) provides the certificate. Set `FORCE_HTTPS=true` if it does not redirect http itself.
* Production settings: set `NODE_ENV=production`, `JWT_SECRET`, `MONGO_URI`, `CLIENT_URL` (https) and the provider keys in the host's settings, never in files.
* `npm audit` in `server` and `client` (this environment has no internet access to run it), and apply fixes that do not need `--force`.
* Backups: run `npm run backup`, then `npm run restore -- <folder>` once into the `_restore` database, and keep scheduled Atlas backups on.
* Monitoring: connect an error-monitoring service in `server/utils/monitor.js` and watch the host's logs.
* Run `npm test` in `server` (all tests) and `npm run build` in `client`.
