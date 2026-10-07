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
| Security headers | Tested | helmet: no-sniff, frame options, HSTS, content security policy; `X-Powered-By` removed |
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

## Changes made on Day 29

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
