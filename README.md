# Smart Parking SaaS

Multi-tenant parking management platform. This repository follows the
30-day master work plan. **Status: Day 28 — public website added. Days 26-27 (mobile app) are not started.**

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
- No online payment gateway is connected. Cash, UPI and card are recorded by
  the operator. The gateway webhook exists and is switched off until
  `PAYMENT_WEBHOOK_SECRET` is set.
- Tickets and receipts show the reference as text. A QR image needs a QR
  library (`npm install qrcode`), planned with the QR work in Phase 2.
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
- There is no hardware yet, so the "hardware offline" alert is never raised.
- Reports export CSV. PDF export is not built.
- Refunds are full refunds of cash, UPI and card payments. Partial refunds
  and gateway refunds are not supported.
- Passes are not built yet, so every exit is charged by tariff.
- Email/OTP verification of new companies is a flag a Super Admin sets.
- The login token is kept in the browser's localStorage. Review this before
  production (Day 29), along with a shared store for rate limiting.
