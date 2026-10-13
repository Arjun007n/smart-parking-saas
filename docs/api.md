# API

Base URL: `/api`. Send `Authorization: Bearer <token>` on protected routes.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | companyName, companyCode? (4 to 12 letters or digits, chosen by the admin; made automatically if left out; 409 when taken or reserved), name, email, password, phone?, gstNumber? (15 characters), city?, state? | Creates a company (with its sign-in `code`) and its Company Admin. Returns a token. |
| GET | `/auth/signup-options` | | `{otpRequired}` for the signup page |
| POST | `/auth/otp/send` | phone | Sends a code by SMS (only when `SIGNUP_OTP=on`) |
| POST | `/auth/otp/verify` | phone, code | Returns `phoneToken`, sent to `/auth/register` as `phoneToken` |
| GET | `/auth/company-code?code=ACME1` | | `{ code, available, reason? }`, for the signup form to check a code while the admin types |
| POST | `/auth/login` | companyCode, **loginId or email**, password | Returns token, user, company (with `code`), permissions. The code is required for every user except the platform administrator (email alone). Missing code: 401 "Enter your company code to sign in" (same answer whether or not the email exists); wrong code, ID or password: 401 "Invalid company code, login ID or password". Optional `portal: "government"` is sent by the Government login page: only a Government Officer gets in through it (anyone else: 401 as for a wrong password), and a Government Officer is refused on the normal login (403 "Government officers sign in on the Government login page") |
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

## Subscriptions (Manage Subscriptions, one per location)

`/catalog` needs `COMPANY_MANAGE` or `PLATFORM_MANAGE`; `PUT /prices` needs `PLATFORM_MANAGE` (Super Admin);
everything else needs a company and `COMPANY_MANAGE`. See `docs/billing.md`.

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/subscriptions/catalog` | | The seven add-ons with their current and standard prices, user price, GST, plan lengths, and whether payment is ready |
| PUT | `/subscriptions/prices` | prices: { pass: 300, ... } | Super Admin. A price equal to the standard price removes the override |
| GET | `/subscriptions?q=` | | One row per location with the subscription that counts now (`state`: ACTIVE, UPCOMING, EXPIRED, CANCELLED, NONE) |
| GET | `/subscriptions/locations/:locationId` | | Location page: current subscription, running ones, order history |
| POST | `/subscriptions/quote` | kind (PURCHASE, RENEWAL, UPDATE), locationId or subscriptionId, users, months, addons or change | Price breakup; nothing is saved |
| POST | `/subscriptions/orders` | same as the quote | Creates the order and its payment link (30 per 15 minutes). The same open quote returns the same order (`repeated`) |
| GET | `/subscriptions/orders/:id` | | Order, invoice summary, seller and buyer (the order page polls it) |
| GET | `/subscriptions/:id` | | One subscription (the renew and update pages) |
| POST | `/subscriptions/:id/cancel` | reason (5 to 300 letters) | Cancels a bought subscription |

Paying a test order: `POST /billing/orders/:id/simulate` works for subscription orders too. Invoices:
`GET /billing/invoices/:id` and `/pdf`.

## My Orders (all of a company's orders in one list)

Need a company and `COMPANY_MANAGE`.

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/my-orders` | q (part of the order number), status (PAID, PENDING, FAILED, CANCELLED), type (SUBSCRIPTION, HARDWARE, PLAN), limit (10, 25, 50, 100, 200), page | Subscription orders (all locations), hardware shop orders and the earlier company-wide plan orders (`PLAN`, which have no order number, so they are left out when an order number is typed), newest first. Each row: type, number, date, status, amount, invoice number, details, items, quantity, link |
| GET | `/my-orders/all` | same filters | Every matching row, for the Excel and Print buttons |

`GET /subscriptions/orders/:id` also returns `taxLines` (each line with its GST and total; the GST adds up to the order's GST) and, once paid, `paymentId` and `gatewayOrderId`.

## Hardware shop

Public catalog and cart, company checkout, and the platform's product and order management.
See `docs/shop.md` for the full table.

## Locations

| Method | Path | Who |
|---|---|---|
| GET | `/locations`, `/locations/:id` | Any signed-in user, limited to their company and assigned locations |
| POST | `/locations` | Company Admin (plan limit applies) |
| PUT | `/locations/:id` | `LOCATION_MANAGE`; Location Admin only for assigned locations. `receiptSettings` `{ headerNote?, ticketFooter?, receiptFooter?, showAddress?, showGst?, showQr? (DEVICE\|ON\|OFF) }` changes how tickets and receipts look (an empty footer means the standard wording). `onlineBooking` also takes `waitingMinutes` (how long a booking waits after its arrival time: 5 to 4320; 0 or empty = the standard `BOOKING_GRACE_HOURS`, 12 hours) and `cancelBeforeMinutes` (0 to 10080; 0 = customers cannot cancel online). `operations` `{ allowReEntry?, exitAmountEdit?, autoExitHours? (0-720; 0 = never), printTicketNumber?, printPhoto?, photoAutoCapture?, printPassReceipt? }` are the gate switches (unset ones keep the defaults, so old locations behave as before). `reportRecipients` is up to 10 email addresses that get this location's end-of-day report |
| GET | `/locations/:id/lanes` | Each row is one lane `{ _id, sn, name, type, vehicleType, vehicleClass, doorNo, readerNo, fastag, fastagLaneId, gateNo, floorNo, direction, fastagLaneType, fastagLaneMode, cameraSerial, isActive, operators, devices }`; `setup.missing` lists the lanes a location still needs. `?q=` (name, lane code, plaza, FASTag lane, camera serial, operator or device name) `&page=&limit=` (default 10, at most 100). `{ rows: [{ _id, sn, name, type, vehicleType, laneCode, plazaId, fastagLaneId, cameraSerial, isActive, operators, devices }], total, page, limit, pages }` |
| POST | `/locations/:id/lanes` | `LOCATION_MANAGE`. The Create Parking Lane form: `{ vehicleType (a type the location takes), type (ENTRY or EXIT), cameraSerial?, fastag?, fastagLaneId?, gateNo?, floorNo?, direction?, fastagLaneType?, fastagLaneMode?, doorNo?, readerNo? }`. The name is `<Vehicle>-<Entry or Exit>` (a second one is `Car-Entry 2`) and the Door/Lane No. and Reader are given when not sent. Audited as `LOCATION_LANE_ADD` |
| PUT | `/locations/:id/lanes/:laneId` | `LOCATION_MANAGE`. The Edit Parking Lane form: the same fields, all optional. A new vehicle or direction renames the lane (its operators and devices follow); Door/Lane No. and Reader must be unique (409); FASTag details are cleared when `fastag` is false; the last entry or exit lane of a class cannot be changed away (400). Audited as `LOCATION_LANE_EDIT` |
| PATCH | `/locations/:id/lanes/:laneId/status` | `LOCATION_MANAGE`. `{ isActive }` switches a lane on or off. A lane that is off refuses entries, exits and manual barrier lifts with 409; the switch turns one lane on or off. Audited as `LOCATION_LANE_ON` / `LOCATION_LANE_OFF` |
| PUT | `/locations/:id` (more fields) | `parkingType` (`NORMAL` or `AIRPORT`); `gates[]` `{ _id (send it back for an existing gate), name, type, lane, vehicleType, vehicleClass, doorNo, readerNo, fastag, fastagLaneId, cameraSerial, laneCode, plazaId, isActive }`. **Lanes:** a lane is one gate for one vehicle and one direction (`type` `ENTRY` or `EXIT`, never `BOTH`), named `Car-Entry`, `Bike-Exit` ...; send `lane` (the vehicle's short name) and `vehicleType` and the server sets `vehicleClass` (`TWO_WHEELER` for `BIKE`, `FOUR_WHEELER` for every other type) and gives each lane its Door/Lane No. (`L1D1`) and Reader (`L1R1`). When any gate has a `lane`, every gate must, and the location needs an entry lane and an exit lane for two-wheelers and for four-wheelers (400 otherwise; a location that works with lanes cannot go back to none). Gates with no `lane` are old-style gates and behave as before. A lane refuses the other class of vehicle at entry and at exit (400). Normally lanes are added one at a time with `POST /locations/:id/lanes`. Gate names must be unique (case does not matter, 400); a rename follows the lane's operators and devices; a lane missing from the list is removed, refused with 409 while operators or devices are tied to it; `operations.autoExitRules` `[{ vehicleType, active, days (1-365), amount }]` closes a ticket of that vehicle type that is still open after `days` days (no payment is recorded; `amount` is written on the ticket and in the alert). A type without an active rule follows `autoExitHours` |
| GET | `/locations/export?format=xlsx\|csv\|pdf` | The Locations table as a file (default xlsx): parking type, seats and valid upto, the gate switches, auto exit on or off, capacity, lanes |
| POST | `/locations/:id/auto-exit/run` | `LOCATION_MANAGE`. `{ vehicleType }` applies that type's active rule now; returns `{ closed }` |
| DELETE | `/locations/:id` | Company Admin. Deactivates; refused while vehicles are parked |

## Users

All need `USER_MANAGE`. You can only see and manage users with a lower role
than your own; a Location Admin only users of their own locations.

| Method | Path | Notes |
|---|---|---|
| GET | `/users`, `/users/:id` | |
| POST | `/users` | name, email **and/or** loginId, password, role **or** customRoleId, locationIds?, lanes?, access? (plan and location licence limits apply) |
| PUT | `/users/:id` | name, phone, loginId, role, customRoleId (`null` removes the custom role), locationIds, lanes, access, isActive, password (reset access) |
| GET | `/users/export?format=` | The Users list as csv, xlsx or pdf: name, role, login ID, mobile, email, locations, lanes, status |
| DELETE | `/users/:id` | Deactivates |
| GET | `/users/licences` | Seats per location: `{ planUsers, activeUsers, allotted, validUpto, expired, locations: [{ locationId, name, limit, used, left }] }` |
| PUT | `/users/licences/:locationId` | `COMPANY_MANAGE`. `{ limit }` (omit or null = no limit of its own). Not below the staff already there; the limits together not above the plan's users. Audited as `LICENCE_SET` |

`access` is `{ reprint, showEntryCollection, showExitCollection, showTotalCollection }`, each a boolean; a flag that was never set counts as allowed. `reprint: false` makes `POST /parking/sessions/:id/reprint` and `.../print` answer 403 for that person. The three `show…` flags remove figures from `GET /operator/collection` and `GET /operator/summary` for that person: entry amount; exit amount; and cash, online, UPI, card, FASTag, wallet, total, refunded, net (the money columns are dropped from exports too).

`loginId`: 3 to 30 letters, digits, `.`, `-`, `_`; stored in lower case; unique inside the company. `lanes`: `[{ locationId, gate }]` (gate = a lane name of that location, at a location the user works at); a location with no lane listed is open to all its gates. **At a location with lanes**, a gate operator (`GATE_OPERATOR`, `ENTRY_OPERATOR`, `EXIT_OPERATOR`) must be given at least one lane (400 otherwise; name both the entry lane and the exit lane to work both), and a lane has one active operator (409). Gate operators with no lane there get 403 at entry and exit. Supervisors and admins are not tied to a lane. Roles `SUPERVISOR` (rank 40) and `VIEWER` (rank 10) can be handed out by a Company Admin or Location Admin. The permission `SESSION_OVERRIDE` (cancel, release without payment, re-entry beyond the grace window) is held by admins and supervisors; `LOCATION_MANAGE` still works for these routes.

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
| POST | `/parking/entry` | `ENTRY_CREATE` | locationId, vehicleNumber, vehicleType, gate?, idempotencyKey?. Returns the session with its ticket number. A vehicle that already has an open ticket gets `409` with `data: { code: "ALREADY_INSIDE", session }` (that ticket), so the entry screen can offer Re-Print, Re-Entry or Exit |
| GET | `/parking/entries?locationId=&q=&date=&page=&match=` | Gate staff, admins | Vehicles inside now. `q` = ticket, or start of a vehicle number; `match=contains` finds the text anywhere in the number (exit search box) |
| POST | `/parking/exit` | `EXIT_CREATE` | locationId, ticketNumber or vehicleNumber, lostTicket?, gate?, editedAmount?, editReason?. Calculates the fee. Returns `paymentRequired`. `editedAmount` (with a reason of at least 5 letters) is accepted only when the location's `exitAmountEdit` switch is on; tax is worked out again, the original fee is kept on the ticket and the change is audited as `PARKING_FEE_EDITED`. |
| GET | `/parking/exits?locationId=&q=&date=&page=` | Gate staff, admins | Closed sessions of one day (default today) |
| GET | `/parking/sessions/:id` | Gate staff, admins | |
| GET | `/parking/sessions/:id/receipt` | Gate staff, admins | After exit only |
| POST | `/parking/sessions/:id/cancel` | `LOCATION_MANAGE` | reason. For an entry made by mistake |
| POST | `/parking/sessions/:id/override` | `LOCATION_MANAGE` | reason. Exit without the normal payment. Opens the exit barrier |
| POST | `/parking/sessions/:id/barrier` | `ENTRY_CREATE` (entry) / `EXIT_CREATE` (exit) | Asks the gate barrier again. Only for a vehicle cleared in the last 10 minutes. Optional body `{ gate }` when several devices cannot be told apart |
| POST | `/parking/sessions/:id/reprint` | gate staff | Counts one reprint of the ticket (shown in the collection report) |
| POST | `/parking/sessions/:id/print` | `ENTRY_CREATE` or `EXIT_CREATE` | Prints the ticket (vehicle inside) or receipt (exited) on the gate's thermal printer |

### Gate staff screens

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/operator/summary?locationId=&date=` (or `&from=2026-10-01T09:00&to=2026-10-05T18:00`: a period between two local date-times, both minutes included, at most 92 days; `from` and `to` go together and replace `date`; the other operator lists and the collection take them too) | any gate permission or `REPORT_VIEW` | Home: `license`, `counts` (all and per vehicle type: capacity, parked, available, entries, exits) and `collection` (by vehicle type; `null` without `PAYMENT_COLLECT` or `REPORT_VIEW`) |
| GET | `/operator/collection?locationId=&date=&format=` | `PAYMENT_COLLECT` or `REPORT_VIEW` | Money by vehicle type: entry (advance) and exit amounts, cash, online, UPI, card, FASTag, total, refunded, net. `format` = xlsx, csv or pdf |
| GET | `/operator/entries?locationId=&date=&q=&type=&method=&page=&pageSize=&format=` | any gate permission or `REPORT_VIEW` | Vehicles that came in on a day. `pageSize` 10, 25, 50, 100 or 200 (default 25). `type` is a vehicle type; `method` is `PASS`, `CASH`, `UPI`, `CARD`, `GATEWAY`, `FASTAG` or `WALLET` (how the advance was paid; `NA` is accepted by `/operator/exits` only, for a stay that left without any payment). On `/operator/exits` the method is how the fee was paid |
| GET | `/operator/exits?...` | same | Vehicles that left on a day, with out time, total time, advance, paid and payable |
| GET | `/bookings?locationId=&status=waiting\|all` | any gate permission or `REPORT_VIEW` | Customer bookings (old ones expire on read) |
| POST | `/bookings` | `ENTRY_CREATE` | locationId, vehicleNumber, vehicleType, customerName?, phone?, note?, expectedAt? |
| POST | `/bookings/:id/cancel` | `ENTRY_CREATE` | reason?. A cancelled booking with a paid online fee becomes `payment.state: REFUND_DUE` and an admin is alerted |
| POST | `/parking/barrier` | `ENTRY_CREATE` / `EXIT_CREATE` | Open the lane barrier by hand: locationId, direction (ENTRY or EXIT), gate?, reason?. 6 a minute per user |
| POST | `/parking/sessions/:id/re-entry` | `ENTRY_CREATE` | Cancel this ticket and issue a new one: gate?, vehicleType?. No daily limit, age window or advance rule (an advance on the old ticket is given back); only the location's `allowReEntry` switch can turn it off. Every one is counted for the operator (see `/reports/re-entries`) |
| GET | `/hardware/agent-package` | `LOCATION_MANAGE` | Zip of the gate agent with this server's address in `config.json` (404 when the files are not on the server) |
| GET | `/hardware/agent-package/info` | `LOCATION_MANAGE` | `{ available }` |

### Public online booking (no login)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/booking/locations` | Locations that take online bookings: name, address, hours, note, `types: [{ type, fee }]`, `paymentAvailable`. Without a gateway only free classes are listed |
| GET | `/public/booking/locations/:id` | One of them (404 if not bookable) |
| POST | `/public/booking/bookings` | locationId, vehicleNumber, vehicleType, customerName, phone, expectedAt, note?. 10 per 15 minutes per address. Answers `{ booking, token }`; the token is shown once. Free: `BOOKED`. Paid: `AWAITING_PAYMENT` with `booking.payment.payUrl` |
| GET | `/public/booking/bookings/:id?token=` | The customer's view: status, amount, payment state, `payUrl` while pending. Wrong id or token: 404 |
| POST | `/public/booking/bookings/:id/cancel?token=` | The customer cancels. Only a `BOOKED` booking, and only until `cancelBeforeMinutes` before the arrival time (0 = customers cannot cancel: 409). A paid fee is flagged for refund. The booking view carries `canCancel`, `cancelBeforeMinutes` and `waitingMinutes` |
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
| POST | `/payments` | `PAYMENT_COLLECT` | sessionId, method (CASH, UPI, CARD, FASTAG, WALLET, GATEWAY), amount, transactionId?, walletId (WALLET only), tagId (FASTAG when a FASTag partner is set up: charges the tag; 202 `completed:false` means not confirmed yet, send the same request again; 422 declined). Completes the exit. `amount` must be what is due; for CASH, UPI and CARD it may be more (what the customer paid): that amount is recorded on the payment and as the ticket's fee (the tariff amount stays in `feeEdit.calculated`), nothing is returned. Less is refused (409); WALLET, GATEWAY and FASTAG must match exactly |
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
| GET | `/passes?state=&type=&passCompanyId=&q=&page=`, `/passes/:id` | `PASS_MANAGE` | |
| GET | `/passes/users?q=&passCompanyId=&page=&format=` | `PASS_MANAGE` | Pass users: passes with the same mobile (or, with none, the same name) are one user. Company, GST number, vehicles, passes, active now. csv, xlsx or pdf |
| POST | `/passes/bulk-upload` | `PASS_MANAGE` | `{ locationId, rows (max 200) }`; each row has text cells holderName, vehicleNumber, vehicleType (required), phone, email, passType, startDate, unit, count, amount, method, company (a name in the company master), notes, transactionId. Each row is a normal sale and fails alone with a reason. Answers `{ created, failed, results: [{ row, ok, passNumber \| error }] }` |
| GET | `/passes/summary` | `PASS_MANAGE` | Counts for the tiles: users, active, ending soon, expired, suspended, sold this month |
| GET | `/passes/vehicles?locationId=&q=&passCompanyId=&page=&format=` | `PASS_MANAGE` | One row per vehicle on a pass (vehicle, type, pass, holder, company, validity, inside now). `format` = csv, xlsx or pdf |
| GET | `/passes/invoices?from=&to=&locationId=&passCompanyId=&q=&page=&format=` | `PASS_MANAGE` | Pass receipts, one per payment (sale or renewal): receipt number `passNumber/n`, taxable value, tax, total, method |
| POST | `/passes/bulk` | `PASS_MANAGE` | `{ ids (max 200), action: EXTEND\|SET_DATES\|UPDATE_TERM\|SUSPEND\|RESUME\|CANCEL, days?, startDate?, endDate?, amount?, reason? }`; UPDATE_TERM (the Update Pass window) needs `endDate` and `amount`, startDate is optional. Changes many passes at once without taking money (use Renew for a paid extension). Answers with what changed and what was skipped, with the reason |
| GET | `/passes?approval=APPROVED\|PENDING&vehicleNumber=&vehicleType=&passUserId=&passCompanyId=&locationId=&ids=a,b&q=&limit=&page=&format=` | `PASS_MANAGE` | The Passes List: every pass with `approval`, `amount`, `company` and `locationNames`. `ids` (max 200) is what Print Pass uses. `format` = csv, xlsx or pdf |
| PATCH | `/passes/:id/approval` | `PASS_MANAGE` | `{ approval: APPROVED\|PENDING }`. A pending pass is on the list but gets no free exit and cannot be invoiced |
| POST | `/passes/delete` and DELETE `/passes/:id` | `PASS_MANAGE` | `{ ids }`. Only an unused pass goes: never used at a gate, no money taken (amount over 0), not on an invoice. Others are skipped with the reason (409 for the single form) |
| GET | `/pass-users/stats`, `/pass-users/options` | `PASS_MANAGE` | Tiles for the Pass Users page (companies, users, vehicles, passes, active, expired, revenue of active passes); the user picker |
| GET, POST | `/pass-users` | `PASS_MANAGE` | List (`?q=&passCompanyId=&limit=&page=&format=`); POST is **Create Pass**: a new user (`name, mobile (10 digits), address`, email?, gstNumber?, passCompanyId?) or `passUserId`, plus `rows[]` (`vehicleNumber, vehicleType, locationId, startDate?, endDate, amount`), `method` CASH\|UPI\|CARD, `transactionId` (one row only). A row with amount 0 is complimentary. 409 for a duplicate mobile, a vehicle that already has a pass, or a vehicle that belongs to another user |
| GET, PUT, DELETE | `/pass-users/:id` | `PASS_MANAGE` | One user with vehicles; edit (the user's passes show the new name, mobile, email, company); delete only when the user has no passes |
| POST, PUT | `/pass-users/:id/vehicles`, `/pass-users/:id/vehicles/:vehicleId` | `PASS_MANAGE` | Add or edit a vehicle record. A plate is unique in the company; a vehicle on a current pass cannot be renamed here |
| POST | `/pass-users/:id/passes` | `PASS_MANAGE` | **Create / Renew** for one of the user's vehicles: `vehicleId, locationId, startDate?, endDate, amount, method?, transactionId?`. A vehicle with a pass has that pass re-dated (one payment recorded); one without gets a new pass |
| GET | `/pass-users/vehicles?q=&vehicleNumber=&vehicleType=&passUserId=&passCompanyId=&format=` | `PASS_MANAGE` | The Vehicle List |
| GET | `/pass-invoices/eligible?locationId=&passCompanyId=(id\|none)&passUserId=` | `PASS_MANAGE` | Passes that can go on a GST invoice: approved, not cancelled, not already invoiced, with charges |
| POST | `/pass-invoices/preview`, `/pass-invoices` | `PASS_MANAGE` | `{ locationId, passCompanyId (id or "none"), passUserId?, passIds, taxPercent? }`. Preview shows the figures; the second saves the invoice (numbers count up from 100001 in a company) and marks the passes. 409 if a pass was invoiced meanwhile |
| GET | `/pass-invoices`, `/pass-invoices/:id` | `PASS_MANAGE` | List (`?locationId=&passCompanyId=&passUserId=&q=&format=`) and one invoice with the seller details |
| GET, POST | `/pass-charges` | `PASS_MANAGE` | The Pass Charges table. GET lists the rates of the user's locations (`locationName` included). POST `{ locationId, vehicleType, monthlyRate, dailyRate }` adds one, or changes the rate when that location and vehicle type already has one (audited `PASS_CHARGE_SAVED`) |
| DELETE | `/pass-charges/:id` | `PASS_MANAGE` | Removes a rate (audited `PASS_CHARGE_REMOVED`) |
| GET | `/pass-charges/quote?locationId=&vehicleType=&startDate=&endDate=` | `PASS_MANAGE` | What a pass would cost for those days (both included, `YYYY-MM-DD`): `{ found, months, days, totalDays, monthlyRate, dailyRate, amount }`; `found: false` when the table has no rate. Months are calendar months from the start day, leftover days use the daily rate |
| DELETE | `/pass-companies/:id` | `PASS_MANAGE` | Only a company with no users and no passes (otherwise 409: switch it off) |
| GET, POST | `/pass-companies` | `PASS_MANAGE` | List (`?q=&active=true`, with pass counts) or add a company master: name, contactName, phone, email, gstin, address, notes |
| PUT | `/pass-companies/:id` | `PASS_MANAGE` | Edit, or switch off with `isActive: false` |
| POST | `/passes` | `PASS_MANAGE` | locationId, passCompanyId?, vehicleNumber, vehicleType, holderName, `unit`+`count` (or `months`; default 1 month), amount, method, startDate?, locationIds?, phone?, email? (pass details and an ending-soon reminder are emailed there), notes?, passType?, maxVehicles?, extraVehicles? (`[{vehicleNumber, vehicleType}]`) |
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

## Government officer reports

A Government Officer (role `GOVERNMENT_OFFICER`, permission `GOVERNMENT_REPORT`) can use only `/government/*` and `/auth/*` (login, me, logout, change password). Every other route answers 403 "This account can only open the government reports", checked in one place (`middleware/auth.js`). Company and location admins also hold the permission, so they can check what officers see. The officer sees only the locations the admin chose; a location outside them is 404. No money is in any answer. An entry is a ticket made in the period (cancelled tickets do not count); an exit is a vehicle that left in the period (automatic closes do not count).

| Method | Path | Notes |
|---|---|---|
| GET | `/government/locations` | The officer's locations, for the filter |
| GET | `/government/summary?from=&to=&locationId=` | `totals` {entries, exits, inside}, `byDay`, `byType`, `byLocation`. Up to 366 days |
| GET | `/government/movements?from=&to=&locationId=&direction=ALL\|ENTRY\|EXIT&vehicleType=&q=&page=&pageSize=` | One row per entry or exit: time, vehicle number, type, ticket, location, gate. `q` is part of a vehicle number or a ticket number. Add `format=xlsx\|csv\|pdf` for a file (up to 10,000 rows; audited as `REPORT_EXPORT`) |

## Dashboard and reports

All need `REPORT_VIEW` and only cover locations the user may see.

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard?locationId=&from=&to=` | Everything on the operations dashboard, in one call. `from` and `to` (local dates, up to 92 days apart, default today) set the period of the day figures: `traffic` by hour, `revenue.byHour` (24 hours, after refunds) and `revenue.inPeriod`, `byVehicleType`, operators, payments, exceptions, reprints. `period` echoes them (`isToday`). Not affected by the period: vehicles inside now, month tiles, `revenue.last7Days`, `momentum` (vehicles inside by hour, today only: empty for other periods), `passes` {active, endingSoon, total, `activeRevenue` = paid for passes valid now}, `subscription` and `locationPlans` (each location with its plan status RUNNING, EXPIRING within 30 days, EXPIRED or NO_PLAN, the expiry date, package and validity; one plan covers the whole company, so locations share a date) Admins (`LOCATION_MANAGE`) also get `reEntries: { total, operators: [{ userId, name, loginId, count }] }`, the re-entries each operator made in the period; other roles do not get the field. |
| GET | `/reports/revenue?from=&to=&groupBy=&locationId=` | groupBy: day, week, month, location. Up to 366 days |
| GET | `/reports/collection?from=&to=&locationId=&operatorId=&method=&page=` | One row per payment |
| GET | `/reports/vehicles?from=&to=&locationId=&q=&status=&entryOperatorId=&exitOperatorId=&page=` | One row per visit. Filter by the person who made the entry or did the exit |
| GET | `/reports/occupancy?date=&locationId=` | Vehicles inside for each hour of a day |
| GET | `/reports/operators?from=&to=&locationId=&operatorId=` | Entries, exits, collections per person |

| GET | `/reports/operator-collection?from=&to=&locationId=&operatorId=&vehicleType=` | With `vehicleType`, only tickets of that class are counted (pass sales and shift differences are left out). Per operator: entries, reprints, pass and paid entries, exits, cash, UPI, card, online, FASTag, pass sales, refunded, **system collection**, closed shifts, **actual collection** (system plus the cash differences found when shifts were closed in the period) and the difference |
| GET | `/reports/transactions?kind=fastag\|online&from=&to=&locationId=&status=&q=&view=list\|daily&page=` | Every FASTag charge attempt or online (gateway) payment, whatever its outcome: date, location, vehicle, ticket or tag, transaction number, provider, status, amount, reason. `status` (FASTag: SUCCESS, PENDING, UNKNOWN, FAILED; online: SUCCESS, PENDING, FAILED, REFUNDED). `tiles` give accepted, in-progress, declined and refunded amounts for the whole period. `view=daily` lists successful amounts per day. This is what our system recorded, not a bank settlement statement |
| GET | `/reports/day-summary?date=&locationId=` | One day, one line per location: entries, exits, vehicle-type split, collection by method |
| GET | `/reports/periods` | `{ currentDays, currentFrom }`: where the Current and Old periods split |
| GET | `/reports/peak-hours?by=hour\|weekday` | Entries by hour of day or weekday |
| GET | `/reports/occupancy-trend` | Daily average and peak occupancy |
| GET | `/reports/exceptions?type=` | Cancelled entries, admin releases, lost tickets, failed online payments, payment problems, vehicles inside over 24 hours |
| GET | `/reports/reprints?from=&to=&locationId=&operatorId=&page=` | Admins only (`LOCATION_MANAGE`, 403 for others). Every reprint of a ticket or receipt: when, location, operator, ticket, vehicle, ticket or receipt; `byOperator` gives the count and last time per operator. Reprints have no limit; only the user's `access.reprint` switch can turn them off. Counted from the audit log (`PARKING_REPRINT`) |
| GET | `/reports/re-entries?from=&to=&locationId=&operatorId=&page=` | Admins only (`LOCATION_MANAGE`, 403 for others). Every ticket replaced with Re-entry: when, location, operator, vehicle, type, old and new ticket, gate, how long the old ticket had been open; `byOperator` gives the count and last time per operator |
| GET | `/reports/payments` | By method and status, failures |
| GET | `/reports/durations` | How long vehicles stay (buckets) |
| GET | `/reports/passes?due=7\|14\|30\|60\|90` | Active and expiring passes, pass revenue |
| GET | `/reports/hardware` | Device uptime and failed commands |
| GET | `/reports/frequent-vehicles?min=2\|3\|5\|10\|20&q=&page=` | Vehicles that came back: visits, locations, stay, fees, free pass visits, lost tickets, their pass. `summary` has the repeat share of all visits. Up to 366 days |
| GET | `/reports/locations` | Every location side by side: capacity, inside now, entries, exits, stay, pass visits, lost tickets, collected, pass sales, net, net per entry. Up to 366 days |

Reports that list dates also accept `period=current` (the last `REPORT_CURRENT_DAYS` days, default 90) or `period=old` (before that; with no dates it shows the 30 days just before the live period). With no `period` there is no limit, as before.

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

Device endpoints (header `x-device-key`, not a user token):

| Method | Path | Notes |
|---|---|---|
| POST | `/device/heartbeat` | Device is alive; answer has the poll interval |
| GET | `/device/commands` | Takes up to 5 commands; each must be acknowledged |
| POST | `/device/commands/:id/ack` | `{ ok, error? }`; repeating is harmless |
| POST | `/device/events` | `{ type: DEVICE_ERROR or DEVICE_INFO, message, severity? }` |
| POST | `/device/anpr` | Cameras: `{ plate, confidence, eventId?, capturedAt?, imageUrl?, direction?, vehicleType? }` |
| POST | `/device/rfid` | UHF readers: `{ tag, eventId?, capturedAt?, direction? }`. Unknown tag: `{ known: false }` |
| POST | `/device/fastag` | FASTag readers: `{ plate, tagId?, confidence?, eventId?, capturedAt?, direction? }` (record only, no charge) |
| POST | `/device/snapshots?commandId=` | CCTV cameras: body is the picture (jpeg, png, webp); attaches it to the ticket |

| GET | `/device/stream` | Event stream for the gate agent: `ready`, then `wake` on connect and whenever a command is queued for that device. One stream per device (a newer one replaces the older). 503 when the server is full |

Suggestions from `/anpr` carry `vehicleType` and `vehicleTypeFrom` (CAMERA; HISTORY for a plate we know; LANE for the lane's own type) when the type is known, `source` (CAMERA, PHOTO, RFID, FASTAG) and, for tags, `passNumber` and `tagId`.

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
