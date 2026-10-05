# API

Base URL: `/api`. Send `Authorization: Bearer <token>` on protected routes.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | companyName, name, email, password, phone? | Creates a company and its Company Admin. Returns a token. |
| GET | `/auth/signup-options` | | `{otpRequired}` for the signup page |
| POST | `/auth/otp/send` | phone | Sends a code by SMS (only when `SIGNUP_OTP=on`) |
| POST | `/auth/otp/verify` | phone, code | Returns `phoneToken`, sent to `/auth/register` as `phoneToken` |
| POST | `/auth/login` | email, password | Returns token, user, company, permissions |
| GET | `/auth/me` | | Current user |
| PUT | `/auth/profile` | name, phone? (empty clears it) | The signed-in user edits their own name and mobile number. Email, role and company cannot be set here. Audited as `AUTH_PROFILE_CHANGED` |
| PUT | `/auth/preferences` | emailAlerts (`OFF`, `CRITICAL`, `IMPORTANT`, `ALL`) | Which alerts are also emailed to this user (admins). Audited as `AUTH_PREFERENCES_CHANGED` |
| POST | `/auth/logout` | | Ends all sessions of the user |
| POST | `/auth/change-password` | currentPassword, newPassword | Returns a new token; other devices are logged out |
| POST | `/auth/forgot-password` | email | Always the same answer; the reset link is emailed when email is switched on |
| POST | `/auth/reset-password` | token, password | |

Register and password routes are limited to `AUTH_RATE_LIMIT_MAX` (20) requests
per IP per 15 minutes; login to five times that. Ten wrong passwords lock an
account for 15 minutes. The whole API is limited to `API_RATE_LIMIT_MAX` (600)
requests per IP per minute.

## Companies

| Method | Path | Who |
|---|---|---|
| GET | `/companies` | Own company; Super Admin sees all |
| POST | `/companies` | Super Admin |
| GET | `/companies/:id` | Own company or Super Admin |
| PUT | `/companies/:id` | `COMPANY_MANAGE`. Plan, subscription status, verification: Super Admin only |
| GET | `/companies/:id/onboarding` | Own company or Super Admin |
| GET / PUT | `/companies/:id/report-email` | `COMPANY_MANAGE`. `{enabled, recipients[], sendAt "HH:MM"}` for the end-of-day report email |
| POST | `/companies/:id/report-email/test` | `COMPANY_MANAGE`. Sends today so far to the caller |

## Billing (plan checkout and GST invoices)

All need `COMPANY_MANAGE`. See `docs/billing.md`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/billing` | | Plan, period, price table, open order, invoices, whether the seller details are ready |
| POST | `/billing/checkout` | users, months, buyer details (company name, GSTIN, address, state) | Creates an order and a payment link (30 per 15 minutes) |
| GET | `/billing/orders/:id` | | Order status (the page polls it) |
| POST | `/billing/orders/:id/simulate` | | Pays the order with the simulated gateway (testing only) |
| GET | `/billing/invoices/:id` | | Invoice data |
| GET | `/billing/invoices/:id/pdf` | | GST invoice PDF |

## Hardware shop

Public catalog and cart, company checkout, and the platform's product and order management.
See `docs/shop.md` for the full table.

## Locations

| Method | Path | Who |
|---|---|---|
| GET | `/locations`, `/locations/:id` | Any signed-in user, limited to their company and assigned locations |
| POST | `/locations` | Company Admin (plan limit applies) |
| PUT | `/locations/:id` | `LOCATION_MANAGE`; Location Admin only for assigned locations. `receiptSettings` `{ headerNote?, ticketFooter?, receiptFooter?, showAddress?, showGst?, showQr? (DEVICE\|ON\|OFF) }` changes how tickets and receipts look (an empty footer means the standard wording) |
| DELETE | `/locations/:id` | Company Admin. Deactivates; refused while vehicles are parked |

## Users

All need `USER_MANAGE`. You can only see and manage users with a lower role
than your own; a Location Admin only users of their own locations.

| Method | Path | Notes |
|---|---|---|
| GET | `/users`, `/users/:id` | |
| POST | `/users` | name, email, password, role **or** customRoleId, locationIds? (plan limit applies) |
| PUT | `/users/:id` | name, phone, role, customRoleId (`null` removes the custom role), locationIds, isActive, password (reset access) |
| DELETE | `/users/:id` | Deactivates |

`operator` (optional on create and update): `{ employeeCode, shift: { name, start, end } }`.

## Roles (custom roles)

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/roles` | `ROLE_MANAGE` or `USER_MANAGE` | Each role has `userCount` and `assignable` (can *I* hand it out) |
| GET | `/roles/catalog` | `ROLE_MANAGE` | Grantable permissions with labels, base roles, what the standard roles allow |
| POST | `/roles` | `ROLE_MANAGE` | name, baseRole, permissions, description? |
| PUT | `/roles/:id` | `ROLE_MANAGE` | name, description, permissions (base role is fixed) |
| DELETE | `/roles/:id` | `ROLE_MANAGE` | 409 while users hold it |

`/auth/login` and `/auth/me` return `permissions` (the user's real list) and `user.customRole` (`{ id, name }` or null).

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
| POST | `/tariffs` | locationId, name, vehicleType, plus pricing fields. Event/airport: kind (STANDARD, EVENT, AIRPORT), eventName, priority, startTime/endTime (HH:MM), flatFee, longStayAfterMinutes, longStayDailyRate |
| GET | `/tariffs/:id` | |
| PUT | `/tariffs/:id` | Send `null` for maxDailyFee, overnightFee, lostTicketFee, validFrom, validTo, startTime, endTime, flatFee, longStayAfterMinutes, longStayDailyRate or eventName to clear it |
| DELETE | `/tariffs/:id` | Switches the tariff off |
| POST | `/tariffs/preview` | locationId, vehicleType, entryTime, exitTime, lostTicket?, hasValidPass?, discountPercent? |

## Parking (entry and exit)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/parking/entry` | `ENTRY_CREATE` | locationId, vehicleNumber, vehicleType, gate?, idempotencyKey?. Returns the session with its ticket number |
| GET | `/parking/entries?locationId=&q=&date=&page=&match=` | Gate staff, admins | Vehicles inside now. `q` = ticket, or start of a vehicle number; `match=contains` finds the text anywhere in the number (exit search box) |
| POST | `/parking/exit` | `EXIT_CREATE` | locationId, ticketNumber or vehicleNumber, lostTicket?, gate?. Calculates the fee. Returns `paymentRequired` |
| GET | `/parking/exits?locationId=&q=&date=&page=` | Gate staff, admins | Closed sessions of one day (default today) |
| GET | `/parking/sessions/:id` | Gate staff, admins | |
| GET | `/parking/sessions/:id/receipt` | Gate staff, admins | After exit only |
| POST | `/parking/sessions/:id/cancel` | `LOCATION_MANAGE` | reason. For an entry made by mistake |
| POST | `/parking/sessions/:id/override` | `LOCATION_MANAGE` | reason. Exit without the normal payment. Opens the exit barrier |
| POST | `/parking/sessions/:id/barrier` | `ENTRY_CREATE` (entry) / `EXIT_CREATE` (exit) | Asks the gate barrier again. Only for a vehicle cleared in the last 10 minutes. Optional body `{ gate }` when several devices cannot be told apart |
| POST | `/parking/sessions/:id/print` | `ENTRY_CREATE` or `EXIT_CREATE` | Prints the ticket (vehicle inside) or receipt (exited) on the gate's thermal printer |

### Gate staff screens

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/operator/summary?locationId=&date=` | any gate permission or `REPORT_VIEW` | Home: `license`, `counts` (all and per vehicle type: capacity, parked, available, entries, exits) and `collection` (by vehicle type; `null` without `PAYMENT_COLLECT` or `REPORT_VIEW`) |
| GET | `/operator/collection?locationId=&date=&format=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Money by vehicle type: entry (advance) and exit amounts, cash, online, UPI, card, FASTag, total, refunded, net. `format` = xlsx, csv or pdf |
| GET | `/operator/entries?locationId=&date=&q=&page=&pageSize=&format=` | any gate permission or `REPORT_VIEW` | Vehicles that came in on a day. `pageSize` 10, 25, 50, 100 or 200 (default 25) |
| GET | `/operator/exits?...` | same | Vehicles that left on a day, with out time, total time, advance, paid and payable |
| GET | `/bookings?locationId=&status=waiting\|all` | any gate permission or `REPORT_VIEW` | Customer bookings (old ones expire on read) |
| POST | `/bookings` | `ENTRY_CREATE` | locationId, vehicleNumber, vehicleType, customerName?, phone?, note?, expectedAt? |
| POST | `/bookings/:id/cancel` | `ENTRY_CREATE` | reason?. A cancelled booking with a paid online fee becomes `payment.state: REFUND_DUE` and an admin is alerted |
| POST | `/parking/barrier` | `ENTRY_CREATE` / `EXIT_CREATE` | Open the lane barrier by hand: locationId, direction (ENTRY or EXIT), gate?, reason?. 6 a minute per user |
| POST | `/parking/sessions/:id/re-entry` | `ENTRY_CREATE` | Cancel this ticket and issue a new one: gate?, vehicleType?. Operators within `RE_ENTRY_WINDOW_MINUTES`, admins any age |
| GET | `/hardware/agent-package` | `LOCATION_MANAGE` | Zip of the gate agent with this server's address in `config.json` (404 when the files are not on the server) |
| GET | `/hardware/agent-package/info` | `LOCATION_MANAGE` | `{ available }` |

### Public online booking (no login)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/booking/locations` | Locations that take online bookings: name, address, hours, note, `types: [{ type, fee }]`, `paymentAvailable`. Without a gateway only free classes are listed |
| GET | `/public/booking/locations/:id` | One of them (404 if not bookable) |
| POST | `/public/booking/bookings` | locationId, vehicleNumber, vehicleType, customerName, phone, expectedAt, note?. 10 per 15 minutes per address. Answers `{ booking, token }`; the token is shown once. Free: `BOOKED`. Paid: `AWAITING_PAYMENT` with `booking.payment.payUrl` |
| GET | `/public/booking/bookings/:id?token=` | The customer's view: status, amount, payment state, `payUrl` while pending. Wrong id or token: 404 |
| POST | `/public/booking/bookings/:id/simulate?token=` | `{ outcome: SUCCESS \| FAILED }`. Only with `PAYMENT_PROVIDER=simulated` (never in production) |

Booking statuses: `AWAITING_PAYMENT`, `BOOKED`, `ARRIVED`, `CANCELLED`, `EXPIRED`. Payment states: `NONE`, `PENDING`, `PAID`, `FAILED`, `REFUND_DUE`. Staff list entries carry `source` (`STAFF` or `ONLINE`), `amount` and `payment`. The gateway webhook (`/payments/webhook`) also settles booking fees. `/parking/entry` answers `booking.feePaidOnline` when the fee became the advance.
Locations accept `onlineBooking: { enabled, fees: { car, bike, heavy, taxi, tempo }, note }` on update.

Payment methods are CASH, UPI, CARD, FASTAG (recorded by the operator) and GATEWAY (online). `/parking/entry` answers with `booking` when the vehicle had one waiting.

`/parking/entry` and `/parking/exit` also accept `detectionId` (the camera suggestion being used).
`/parking/entry` also accepts `advance: { amount, method (CASH, UPI, CARD, FASTAG), transactionId? }` (needs `PAYMENT_COLLECT`; an amount of 0 is no advance). The session then has `advance`. `/parking/exit` returns `session.fee.advanceApplied` and `session.fee.due` (the amount `POST /payments` must carry) and, when there was an advance, `advance: { taken, applied, refund, method }`: `paymentRequired` is false when the advance covered the fee, and `refund` is what to hand back. Cancelling a session answers with `advanceRefunded` when an advance was given back. Receipts include `advance` and `amount.due`.
Entry, exit, payment and override answers include `hardware: { barrier, print }`, each `null` or
`{ deviceName, commandId, status }`, plus `problem: true` when a device call failed (do it by hand). Follow a command with `GET /hardware/commands/:id`.

## Payments

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/payments` | `PAYMENT_COLLECT` | sessionId, method (CASH, UPI, CARD, FASTAG, WALLET, GATEWAY), amount, transactionId?, walletId (WALLET only), tagId (FASTAG when a FASTag partner is set up: charges the tag; 202 `completed:false` means not confirmed yet, send the same request again; 422 declined). Completes the exit |
| GET | `/payments?locationId=&date=&page=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | |
| GET | `/payments/collection?locationId=&date=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Day total, by method and by operator, plus `walletTopups` (money put into wallets, shown apart from income) |
| GET | `/payments/options` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Which gateway is set up (and whether it is the simulator), and `fastag` (true when FASTag is really charged) |
| GET | `/payments/:id` | `PAYMENT_COLLECT` or `REPORT_VIEW` | One payment; used to follow an online payment |
| POST | `/payments/:id/cancel` | `PAYMENT_COLLECT` | Stop waiting for a pending online payment |
| POST | `/payments/:id/simulate` | `PAYMENT_COLLECT` | `{ outcome: SUCCESS or FAILED }`. Simulated provider only, never in production |
| POST | `/payments/webhook` | Payment gateway | Generic: header `x-signature` = HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET`. Razorpay: `x-razorpay-signature` |
| POST | `/payments/:id/refund` | `LOCATION_MANAGE` | reason. Full refund; online payments are refunded through the gateway; wallet payments go back into the wallet |

With method `GATEWAY`, `POST /payments` starts an online payment and answers with a pending payment
(`payUrl`, `expiresAt`) instead of finishing the exit. Details in `docs/phase2.md`.

## Wallets (prepaid parking cards)

`docs/wallets.md` explains the rules. All wallets belong to one company.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/wallets?q=&status=&page=` | `WALLET_MANAGE` or `PAYMENT_COLLECT` | Search by number, holder, phone or vehicle. Each wallet has `balance` (rupees) and `low` |
| GET | `/wallets/lookup?number=` or `plate=` or `phone=` | same | Exact match; `{ wallet }` or `{ wallet: null }` |
| GET | `/wallets/:id` | same | The wallet and its latest 50 ledger rows |
| GET | `/wallets/:id/transactions?page=` | same | The full ledger, newest first |
| POST | `/wallets` | `WALLET_MANAGE` | holderName, phone?, vehicles? (max 5), notes?, lowBalanceAlert? |
| PUT | `/wallets/:id` | `WALLET_MANAGE` | Details and vehicles; `status: BLOCKED` needs `statusReason` |
| POST | `/wallets/:id/topup` | `PAYMENT_COLLECT` | amount (1 to 100000, 2 decimals), method (CASH, UPI, CARD), reference?, locationId, requestId? (a repeat with the same id adds nothing) |
| POST | `/wallets/:id/adjust` | `WALLET_MANAGE`, company admin only | amount (plus or minus), reason, requestId? |
| GET | `/wallets/:id/verify` | `WALLET_MANAGE` | Does the balance equal the sum of the ledger? |

`POST /parking/exit` also answers with `wallet` ({ number, holderName, balance, enough }) when an active wallet is linked to the vehicle.

## Passes

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/passes/lookup?locationId=&vehicleNumber=` or `&passNumber=` | `ENTRY_CREATE`, `EXIT_CREATE` or `PASS_MANAGE` | The valid pass for a vehicle at a location, if any. The answer lists the pass's `vehicles` and which of them are `inside` |
| GET | `/passes?state=&type=&q=&page=`, `/passes/:id` | `PASS_MANAGE` | |
| POST | `/passes` | `PASS_MANAGE` | locationId, vehicleNumber, vehicleType, holderName, `unit`+`count` (or `months`; default 1 month), amount, method, startDate?, locationIds?, phone?, email? (pass details and an ending-soon reminder are emailed there), notes?, passType?, maxVehicles?, extraVehicles? (`[{vehicleNumber, vehicleType}]`) |
| POST | `/passes/:id/renew` | `PASS_MANAGE` | `unit`+`count` (or `months`), amount, method, locationId |
| POST | `/passes/:id/suspend`, `/resume`, `/cancel` | `PASS_MANAGE` | suspend and cancel need a reason |
| PUT | `/passes/:id` | `PASS_MANAGE` | holderName, phone, email (empty removes), notes, locationIds, passType, maxVehicles |
| POST | `/passes/:id/vehicles` | `PASS_MANAGE` | vehicleNumber, vehicleType, reason? Adds a vehicle (limit `maxVehicles`) |
| POST | `/passes/:id/vehicles/remove` | `PASS_MANAGE` | vehicleNumber, reason. Not the last vehicle, not one that is parked |
| POST | `/passes/:id/vehicles/replace` | `PASS_MANAGE` | from, to, vehicleType?, reason. The new plate takes the old one's place |
| PUT | `/passes/:id/vehicles/tag` | `PASS_MANAGE` | vehicleNumber, tag (4–48 letters and digits; empty removes). 409 if another vehicle has that tag |

## Vehicle photos

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/parking/sessions/:id/photos?kind=` | `ENTRY_CREATE`, `EXIT_CREATE` or `LOCATION_MANAGE` | The body is the image itself (`Content-Type` image/jpeg, image/png or image/webp). At most 6 per ticket |
| GET | `/parking/sessions/:id/photos/:photoId` | anyone who can see the session | Streams the image |
| DELETE | `/parking/sessions/:id/photos/:photoId` | `LOCATION_MANAGE` | |

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

| GET | `/reports/peak-hours?by=hour\|weekday` | Entries by hour of day or weekday |
| GET | `/reports/occupancy-trend` | Daily average and peak occupancy |
| GET | `/reports/exceptions?type=` | Cancelled entries, admin releases, lost tickets, refunds, failed online payments, payment problems, vehicles inside over 24 hours |
| GET | `/reports/payments` | By method and status, refunds, failures |
| GET | `/reports/durations` | How long vehicles stay (buckets) |
| GET | `/reports/passes?due=7\|14\|30\|60\|90` | Active and expiring passes, pass revenue |
| GET | `/reports/hardware` | Device uptime and failed commands |
| GET | `/reports/frequent-vehicles?min=2\|3\|5\|10\|20&q=&page=` | Vehicles that came back: visits, locations, stay, fees, free pass visits, lost tickets, their pass. `summary` has the repeat share of all visits. Up to 366 days |
| GET | `/reports/locations` | Every location side by side: capacity, inside now, entries, exits, stay, pass visits, lost tickets, collected, pass sales, refunds, net, net per entry. Up to 366 days |

Add `format=csv`, `format=xlsx` (Excel) or `format=pdf` to any report to download it
(any other format is refused with 400). The file holds the same rows as the screen, with the same
filters and the same location scoping, but is not paged (CSV and Excel up to 10 000 rows, PDF up to
2 000, and the PDF says when it stopped). Excel and PDF show dates in local time and use words for
codes (Online instead of GATEWAY); CSV keeps the raw codes. The PDF uses the standard Helvetica font, so
characters outside Latin-1 (for example Hindi names) show as `?` there; Excel and CSV keep them. Every download
is recorded in the audit log as `REPORT_EXPORT`. Dates are `YYYY-MM-DD` in
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

| GET | `/testimonials` | Anyone | Published testimonials |
| GET | `/testimonials/all` | Platform admin | Includes hidden ones |
| POST, PUT, DELETE | `/testimonials`, `/testimonials/:id` | Platform admin | quote (max 600), name, role?, company?, order, isPublished |
| GET | `/public/stats` | Anyone | `{ locations, vehicles30d }` (active locations; vehicle entries in the last 30 days). Cached for 10 minutes, limited to 60 per minute per IP. Counts only, no names |

Super Admin: send the `x-company-id` header to work inside one company.

## Gate hardware

See `docs/hardware.md` for how devices, the gate agent and cameras fit together.

Admin and operator endpoints (logged-in users):

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/hardware?locationId=&type=` | `LOCATION_MANAGE` or `REPORT_VIEW` | Devices with live `status` (ONLINE, OFFLINE, NEVER_SEEN, UNMONITORED, DISABLED). Never includes keys |
| POST | `/hardware` | `LOCATION_MANAGE` | locationId, name, type (ANPR_CAMERA, BARRIER, PRINTER, RFID_READER, FASTAG_READER, CCTV_CAMERA), gate?, direction?, vendor?, model?, monitorOnline?, offlineAfterSeconds?, config? (minConfidence, pulseMs, paperWidthMm, autoPrint, printQr, previewUrl: an http(s) address). Returns `deviceKey` **once** |
| GET | `/hardware/:id` | `LOCATION_MANAGE` or `REPORT_VIEW` | Device, last 20 events, last 10 commands |
| PUT | `/hardware/:id` | `LOCATION_MANAGE` | Same fields, plus `isActive` (switch off) |
| POST | `/hardware/:id/rotate-key` | `LOCATION_MANAGE` | New key (shown once); the old one stops working at once |
| GET | `/hardware/:id/events` | `LOCATION_MANAGE` or `REPORT_VIEW` | Last 100 |
| POST | `/hardware/:id/commands` | `LOCATION_MANAGE` | type (BARRIER_OPEN, BARRIER_CLOSE, PRINT_TEST, SNAPSHOT_TEST), reason (audited) |
| GET | `/hardware/commands/:id` | Gate staff, admins | Command progress: PENDING, SENT, ACKED, FAILED, EXPIRED |
| GET | `/anpr?locationId=&status=&direction=` | Gate staff, admins | Camera suggestions (default: waiting) |
| POST | `/anpr/:id/dismiss` | Gate staff, admins | A wrong or irrelevant reading |
| GET | `/anpr/preview?locationId=&direction=ENTRY\|EXIT&gate=` | Gate staff, admins | `{ hasCamera, previewUrl, camera }` for the camera at that gate (`hasCamera` is true when a matching ANPR camera exists; `previewUrl` is null when none is set). The Entry and Exit screens use `hasCamera` to hide the browser-camera panel. The address comes from the camera's `config.previewUrl` and carries a secret token |
| GET | `/anpr/options` | Gate staff, admins | `{ photoReading, maxBytes, simulated }`: is plate reading from photos switched on? |
| POST | `/anpr/read?locationId=&direction=ENTRY\|EXIT` | `ENTRY_CREATE` (entry) / `EXIT_CREATE` (exit) | Body is the picture (`image/jpeg`, `image/png`, `image/webp`). Answers `{ detection, plate, confidence, reviewReasons, readable }`. The picture is not stored. `testPlate=` (simulated reader only) makes any picture "read" as that plate. 503 when switched off, 415 not a picture, 413 too large, 429 over the limit, 502 when the reading service fails |

Device endpoints (header `x-device-key`, not a user token):

| Method | Path | Notes |
|---|---|---|
| POST | `/device/heartbeat` | Device is alive; answer has the poll interval |
| GET | `/device/commands` | Takes up to 5 commands; each must be acknowledged |
| POST | `/device/commands/:id/ack` | `{ ok, error? }`; repeating is harmless |
| POST | `/device/events` | `{ type: DEVICE_ERROR or DEVICE_INFO, message, severity? }` |
| POST | `/device/anpr` | Cameras: `{ plate, confidence, eventId?, capturedAt?, imageUrl?, direction? }` |
| POST | `/device/rfid` | UHF readers: `{ tag, eventId?, capturedAt?, direction? }`. Unknown tag: `{ known: false }` |
| POST | `/device/fastag` | FASTag readers: `{ plate, tagId?, confidence?, eventId?, capturedAt?, direction? }` (record only, no charge) |
| POST | `/device/snapshots?commandId=` | CCTV cameras: body is the picture (jpeg, png, webp); attaches it to the ticket |

| GET | `/device/stream` | Event stream for the gate agent: `ready`, then `wake` on connect and whenever a command is queued for that device. One stream per device (a newer one replaces the older). 503 when the server is full |

Suggestions from `/anpr` carry `source` (CAMERA, PHOTO, RFID, FASTAG) and, for tags, `passNumber` and `tagId`.

### Live stream for screens

`GET /api/live/stream` (logged-in users; `Authorization: Bearer ...`; optional `?locationId=` to narrow it) is a
Server-Sent Events stream. Messages carry **ids only**: `entry`, `exit`, `occupancy`, `payment` (`status`
SUCCESS/FAILED), `anpr`, `notification`, `hardware`, `command` (`commandId`, `status`). A client hears only its
own company and its allowed locations (403 for a location it may not see, 400 for a bad id). A heartbeat comment
arrives every 25 s. At most 6 streams per user and `LIVE_MAX_STREAMS` (500) in total; 503 when full.

Gates in `POST/PUT /locations` accept optional `laneCode`, `plazaId` and `fastagLaneId` (text, up to 30 characters).

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
| WALLET_MANAGE | yes | yes | yes | | | |
| COMPANY_MANAGE | yes | yes | | | | |
| PLATFORM_MANAGE | yes | | | | | |
| ROLE_MANAGE | yes | yes | | | | |

A company can also define **custom roles** that replace the permission list of a base role (see
`docs/phase2.md`). Company settings, role editing and platform control can never be given to one.

Defined in `server/config/permissions.js`.
