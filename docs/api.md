# API

Base URL: `/api`. Send `Authorization: Bearer <token>` on protected routes.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | companyName, name, email, password, phone? | Creates a company and its Company Admin. Returns a token. |
| POST | `/auth/login` | email, password | Returns token, user, company, permissions |
| GET | `/auth/me` | | Current user |
| POST | `/auth/logout` | | Ends all sessions of the user |
| POST | `/auth/forgot-password` | email | Always the same answer |
| POST | `/auth/reset-password` | token, password | |

Auth routes are limited to `AUTH_RATE_LIMIT_MAX` requests per IP per 15 minutes.

## Companies

| Method | Path | Who |
|---|---|---|
| GET | `/companies` | Own company; Super Admin sees all |
| POST | `/companies` | Super Admin |
| GET | `/companies/:id` | Own company or Super Admin |
| PUT | `/companies/:id` | `COMPANY_MANAGE`. Plan, subscription status, verification: Super Admin only |
| GET | `/companies/:id/onboarding` | Own company or Super Admin |

## Locations

| Method | Path | Who |
|---|---|---|
| GET | `/locations`, `/locations/:id` | Any signed-in user, limited to their company and assigned locations |
| POST | `/locations` | Company Admin (plan limit applies) |
| PUT | `/locations/:id` | `LOCATION_MANAGE`; Location Admin only for assigned locations |
| DELETE | `/locations/:id` | Company Admin. Deactivates; refused while vehicles are parked |

## Users

All need `USER_MANAGE`. You can only see and manage users with a lower role
than your own; a Location Admin only users of their own locations.

| Method | Path | Notes |
|---|---|---|
| GET | `/users`, `/users/:id` | |
| POST | `/users` | name, email, password, role, locationIds? (plan limit applies) |
| PUT | `/users/:id` | name, phone, role, locationIds, isActive, password (reset access) |
| DELETE | `/users/:id` | Deactivates |

`operator` (optional on create and update): `{ employeeCode, shift: { name, start, end } }`.

## Slots

| Method | Path | Who |
|---|---|---|
| GET | `/slots?locationId=` | Any signed-in user with access to the location. Returns slots and a status summary |
| POST | `/slots` | `LOCATION_MANAGE`. locationId, code, zone?, floor?, vehicleType?, type? |
| POST | `/slots/bulk` | `LOCATION_MANAGE`. locationId, prefix?, start?, count (max 500). Existing codes are skipped |
| PUT | `/slots/:id` | `LOCATION_MANAGE`. status may be FREE or MAINTENANCE only |
| DELETE | `/slots/:id` | `LOCATION_MANAGE`. Refused while occupied |

## Vehicles

| Method | Path | Who |
|---|---|---|
| GET | `/vehicles?q=&blocked=true&page=` | Any signed-in user. `q` = start of the number, or a phone |
| GET | `/vehicles/:id` | Any signed-in user |
| POST | `/vehicles` | `VEHICLE_MANAGE`. plateNumber, type?, ownerName?, phone? |
| PUT | `/vehicles/:id` | `VEHICLE_MANAGE`. Blocking needs `blockedReason` |

## Tariffs

All need `TARIFF_MANAGE`. A Location Admin only sees tariffs of assigned locations.

| Method | Path | Notes |
|---|---|---|
| GET | `/tariffs?locationId=&vehicleType=` | |
| POST | `/tariffs` | locationId, name, vehicleType, plus pricing fields |
| GET | `/tariffs/:id` | |
| PUT | `/tariffs/:id` | Send `null` for maxDailyFee, overnightFee, lostTicketFee, validFrom or validTo to clear it |
| DELETE | `/tariffs/:id` | Switches the tariff off |
| POST | `/tariffs/preview` | locationId, vehicleType, entryTime, exitTime, lostTicket?, hasValidPass?, discountPercent? |

## Parking (entry and exit)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/parking/entry` | `ENTRY_CREATE` | locationId, vehicleNumber, vehicleType, gate?, idempotencyKey?. Returns the session with its ticket number |
| GET | `/parking/entries?locationId=&q=&date=&page=` | Gate staff, admins | Vehicles inside now. `q` = ticket, or start of a vehicle number |
| POST | `/parking/exit` | `EXIT_CREATE` | locationId, ticketNumber or vehicleNumber, lostTicket?, gate?. Calculates the fee. Returns `paymentRequired` |
| GET | `/parking/exits?locationId=&q=&date=&page=` | Gate staff, admins | Closed sessions of one day (default today) |
| GET | `/parking/sessions/:id` | Gate staff, admins | |
| GET | `/parking/sessions/:id/receipt` | Gate staff, admins | After exit only |
| POST | `/parking/sessions/:id/cancel` | `LOCATION_MANAGE` | reason. For an entry made by mistake |
| POST | `/parking/sessions/:id/override` | `LOCATION_MANAGE` | reason. Exit without the normal payment |

## Payments

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/payments` | `PAYMENT_COLLECT` | sessionId, method (CASH, UPI, CARD, GATEWAY), amount, transactionId?. Completes the exit |
| GET | `/payments?locationId=&date=&page=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | |
| GET | `/payments/collection?locationId=&date=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Day total, by method and by operator |
| POST | `/payments/webhook` | Payment gateway | Header `x-signature` = HMAC-SHA256 of the body with `PAYMENT_WEBHOOK_SECRET` |
| POST | `/payments/:id/refund` | `LOCATION_MANAGE` | reason. Full refund of a cash, UPI or card payment |

## Shifts

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/shifts` | `PAYMENT_COLLECT` | locationId, openingCash. One open shift per operator |
| GET | `/shifts/current` | `PAYMENT_COLLECT` | My open shift with live totals, or null |
| POST | `/shifts/:id/close` | `PAYMENT_COLLECT` | closingCash, notes?. Own shift, or an admin of the location |
| POST | `/shifts/:id/adjustments` | `LOCATION_MANAGE` | amount (+ or -), reason |
| GET | `/shifts?date=&locationId=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Admins and report viewers see all; others their own |

## Dashboard and reports

All need `REPORT_VIEW` and only cover locations the user may see.

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard?locationId=` | Everything on the operations dashboard, in one call |
| GET | `/reports/revenue?from=&to=&groupBy=&locationId=` | groupBy: day, week, month, location. Up to 366 days |
| GET | `/reports/collection?from=&to=&locationId=&operatorId=&method=&page=` | One row per payment |
| GET | `/reports/vehicles?from=&to=&locationId=&q=&status=&page=` | One row per visit |
| GET | `/reports/occupancy?date=&locationId=` | Vehicles inside for each hour of a day |
| GET | `/reports/operators?from=&to=&locationId=&operatorId=` | Entries, exits, collections, refunds per person |

Add `format=csv` to any report to download it. Dates are `YYYY-MM-DD` in
local time; a period may be at most 92 days unless stated.

## Audit log and notifications

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/audit-logs?from=&to=&action=&actor=&page=` | `COMPANY_MANAGE` | Read only; `format=csv` to download |
| GET | `/notifications?unread=true` | `LOCATION_MANAGE` | Latest 100 and the unread count |
| POST | `/notifications/read` | `LOCATION_MANAGE` | `{ ids: [...] }` or `{ all: true }` |

## Public website

"Platform admin" means Super Admin (`PLATFORM_MANAGE`).

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/leads` | Anyone | name, email, phone?, company?, message?, type?, subject?. Limited to `LEAD_RATE_LIMIT_MAX` per IP per 15 minutes |
| GET | `/leads?status=&page=` | Platform admin | |
| PUT | `/leads/:id` | Platform admin | status, notes |
| GET | `/faq` | Anyone | Published questions |
| GET | `/faq/all` | Platform admin | Includes hidden ones |
| POST, PUT, DELETE | `/faq`, `/faq/:id` | Platform admin | question, answer, category, order, isPublished |
| GET | `/blog?category=&tag=&page=` | Anyone | Published articles, without the body |
| GET | `/blog/:slug` | Anyone | One article; counts a view |
| GET | `/blog/admin/all` | Platform admin | Includes drafts |
| POST, PUT, DELETE | `/blog`, `/blog/:id` | Platform admin | title, body, excerpt, category, tags, isPublished. The slug is made from the title and never changes |

Super Admin: send the `x-company-id` header to work inside one company.

## Roles and permissions

| Permission | Super Admin | Company Admin | Location Admin | Entry Op | Exit Op | Collection Op |
|---|---|---|---|---|---|---|
| ENTRY_CREATE | yes | yes | yes | yes | | |
| EXIT_CREATE | yes | yes | yes | | yes | |
| PAYMENT_COLLECT | yes | yes | yes | | yes | yes |
| REPORT_VIEW | yes | yes | yes | | | yes |
| USER_MANAGE | yes | yes | yes | | | |
| LOCATION_MANAGE | yes | yes | yes | | | |
| TARIFF_MANAGE | yes | yes | yes | | | |
| PASS_MANAGE | yes | yes | yes | | | |
| VEHICLE_MANAGE | yes | yes | yes | | | |
| COMPANY_MANAGE | yes | yes | | | | |
| PLATFORM_MANAGE | yes | | | | | |

Defined in `server/config/permissions.js`.
