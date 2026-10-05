# Smart Parking SaaS

Multi-tenant parking management platform. This repository follows the
30-day master work plan. **Status: Day 29 — release candidate, plus gate hardware (cameras, barriers, printers; `docs/hardware.md`). Phase 2 (passes, QR, online payments, advanced reports, photos, custom roles; `docs/phase2.md`) is built. Days 26-27 (mobile app) and Day 30 (deployment) are not started.**

```
client/   React + Vite + Tailwind web app
server/   Node.js + Express + MongoDB API
docs/     Design notes
```

## Run it locally

You need Node.js 20+ and MongoDB (local, or a MongoDB Atlas connection string).

**1. API**

```bash
cd server
npm install
# copy .env.example to .env and fill in MONGO_URI and JWT_SECRET
npm run dev
```

The API runs on http://localhost:5000 (check http://localhost:5000/api/health).

**2. Web app** (second terminal)

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173, choose **Start free trial**, register your
company, then create your first parking under **Parking Locations**.

**3. Platform Super Admin** (optional)

Set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` in `server/.env`, then:

```bash
cd server
npm run seed:admin
```

## Tests

```bash
cd server
npm run test:unit   # no database needed
npm test            # unit + API tests, needs MongoDB
```

`npm test` uses the database in `MONGO_URI_TEST` (default
`mongodb://127.0.0.1:27017/smart_parking_test`). Its name must end in `_test`
because the tests delete everything in it. Never point it at real data.

## Phase 2

Monthly passes, QR codes and camera scanning, online payments (generic webhook, simulator, Razorpay),
seven more reports, vehicle photos and company-defined roles. Setup, rules and settings:
[docs/phase2.md](docs/phase2.md). Its database tests have not been run yet; run `npm test` in `server`.

## Gate hardware (ANPR cameras, boom barriers, thermal printers)

Built early at the owner's request, against a simulator. Admins register devices on the **Hardware**
page; a small program in `gate-agent/` runs at the site and connects them. Camera plates are
suggestions an operator confirms; barriers and printers follow entry, exit and payment without ever
blocking them. See `docs/hardware.md` (setup, simulator, real devices, safety rules).

## Security and testing (Day 29)

The full checklist, what was tested, what was fixed and the known limits are in
[docs/security.md](docs/security.md).

- Every user can change their own password under **My account**.
- Ten wrong passwords lock an account for 15 minutes.
- `npm run backup` saves the whole database to `server/backups/`;
  `npm run restore -- <folder>` restores it into a separate `_restore`
  database to prove the backup works.

## Public website (Day 28)

| Route | Page |
|---|---|
| `/` | Home: hero, overview, features (`/#features`), how it works, pricing (`/#subscription`), hardware, call to action |
| `/aboutus` | Mission and product overview |
| `/product` | Planned hardware, with category filter and an interest form |
| `/faq` | Questions by category, with search |
| `/blog`, `/blog/:slug` | Articles with categories, tags, dates and view counts |
| `/contact` | Contact and demo-request form, plus your contact details |
| `/ResellerLogin` | Partner program (planned): register interest |
| `/login` | Login for admins and operators |

**Before you publish the site:**

1. Put your company details in `client/src/config/site.js` (name, email, phone,
   address, about text). Empty values are not shown.
2. Set your plan prices in `client/src/data/site.js`. While a price is `null`
   the site says "Contact us for pricing".
3. Add starter FAQs and three articles: `npm run seed:content` in `server`.
4. Create the platform admin (`npm run seed:admin`), log in, and open
   **Website** in the dashboard to read enquiries and edit FAQs and articles.

## What Days 22-25 include

| Day | Delivered |
|---|---|
| 22 | Operations dashboard: occupancy, traffic by hour, revenue, payment breakdown, operator activity, exceptions, alerts, per-location comparison |
| 23 | Collection: shifts with opening and closing cash, reconciliation, refunds, adjustments |
| 24 | Reports: revenue (day/week/month/location), collection, vehicle history, occupancy, operators; filters and CSV export |
| 25 | Audit log screen; in-app notifications with alerts for capacity, failed payments, cash differences and subscription expiry |

Details: [docs/operations.md](docs/operations.md).

## What Week 3 includes

| Day | Delivered |
|---|---|
| 15 | Entry API with all entry validations, duplicate-request protection, capacity check |
| 16 | Operator screens: Vehicle Entry (with printable ticket) and Vehicles Inside |
| 17 | Session state machine and ticket numbers (`server/services/sessionService.js`) |
| 18 | Exit API: lookup by ticket or vehicle number, fee calculation, lost ticket |
| 19 | Payments: cash, UPI, card; online gateway abstraction with signed webhook |
| 20 | Receipt (printable, save as PDF from the browser) |
| 21 | End-to-end test of the whole flow (`server/tests/week3.integration.test.js`) |

How the flow works: [docs/parking-flow.md](docs/parking-flow.md).

## What Week 2 includes

| Day | Delivered |
|---|---|
| 8 | Location detail page: address, contact, hours, capacity, zones, gates |
| 9 | Parking slots: add in bulk, types (normal, reserved, EV, accessible, VIP), maintenance |
| 10 | Vehicles: register, search by number or phone, block and unblock |
| 11 | Tariffs per location and vehicle type, with weekday rules |
| 12 | Fee engine (`server/services/tariffService.js`) with unit tests — see [docs/tariffs.md](docs/tariffs.md) |
| 13 | Operators: edit, reassign, shift, reset access; separate operator area at `/operator` |
| 14 | API tests for all of the above |

## What Week 1 includes

| Day | Delivered |
|---|---|
| 1 | Project structure, client and server shells, database connection |
| 2 | Mongoose models and indexes — see [docs/database.md](docs/database.md) |
| 3 | Error handling, auth, tenant, permission, validation, rate limiting |
| 4 | Register, login, logout, forgot/reset password (API and screens), protected routes |
| 5 | Roles and permissions enforced on the API — see [docs/api.md](docs/api.md) |
| 6 | Company management, onboarding progress, plan limits |
| 7 | Tests for auth, RBAC and tenant isolation |

Also included early, because it is the next onboarding step: creating and
managing parking locations (Day 8) and users/operators (part of Day 13).

## Conventions

- **Tenant isolation:** every tenant-owned record has `companyId`. Controllers
  always query with `req.tenantFilter`. `companyId` is taken from the logged-in
  user, never from the request body.
- **Permissions are enforced on the API.** The web app only hides things.
- **Validation:** each route lists the fields it accepts (`validateBody`).
  Anything else in the body is dropped.
- **Responses:** `{ success: true, data }` or `{ success: false, message, errors? }`.
- **Business rules live on the server**, so the web and mobile apps stay thin.
- Server code is CommonJS (`require`); client code is ES modules.

## Known gaps (planned later)

- Password reset emails are not sent yet (Day 25). In development the reset
  link is printed in the API terminal and shown on the forgot-password page.
- Online payments work through a signed webhook, a simulator, or Razorpay. The
  Razorpay adapter has not been tried against Razorpay yet (use test keys first).
- Vehicle photos are stored on the server's disk (`PHOTO_STORAGE_DIR`); use a
  persistent volume in production. Custom roles cannot be company-wide.
- Website: the hardware catalogue is a list of planned integrations with an
  interest form, not a shop (no cart or checkout). The partner page collects
  interest; there is no partner login yet. New enquiries are not emailed to
  you; check the Website screen.
- Blog articles are plain text with headings. There are no images or rich
  formatting yet.
- The dashboard refreshes every 20 seconds. Push updates over Socket.IO are
  not connected yet; the server already publishes the events
  (`server/services/eventBus.js`), so adding it needs `npm install socket.io
  socket.io-client` and a small transport file.
- Email, SMS, WhatsApp and push are defined as channels
  (`server/integrations/notifications`) but no provider is connected, so only
  in-app notifications are delivered. Password reset emails are still not sent.
- Hardware is built against a simulator (see `docs/hardware.md`). It has not yet been tried with a
  real camera, barrier or printer; the first real device may need a driver option or camera translator.
- Reports export CSV. PDF export is not built.
- Refunds are full refunds only; partial refunds are not supported.
- Passes are not built yet, so every exit is charged by tariff.
- Email/OTP verification of new companies is a flag a Super Admin sets.
- The login token is kept in the browser's localStorage. Review this before
  production (Day 29), along with a shared store for rate limiting.
