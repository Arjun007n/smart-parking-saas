# Phase 2: passes, QR, online payments, reports, photos, custom roles

Everything here is built on the Phase 1 flow (entry, payment, exit). No new npm
packages were needed.

## Passes (daily, weekly, monthly)

A pass lets one vehicle in and out without paying a parking fee, for a number of
whole calendar days at chosen locations (or all of them).

* Sold, renewed, suspended, resumed and cancelled on **Passes** (`PASS_MANAGE`).
* Pass numbers look like `P-260302-AB3XYZ`. The vehicle number also finds the pass.
* The validity window is `[start, end)` at local midnights (`APP_UTC_OFFSET_MINUTES`, default 330).
  Renewing before the end extends from the old end date; renewing late starts today.
* On entry the gate screen shows the pass banner. At exit, a valid pass closes the session as
  `PASS_EXIT` with no fee. An expired, suspended or wrong-location pass is treated as no pass.
* Pass money (cash, UPI, card, online, or `COMPLIMENTARY` at 0) is kept in its own `PassPayment`
  records and is added to collection totals, shift cash and reports ("of which pass sales").
* A daily job warns admins about passes ending within 7 days (`PASS_EXPIRY` notification).
* **Terms.** A pass or renewal is bought for `count` days (1 to 366), weeks (1 to 156) or months
  (1 to 36), sent as `unit` + `count`. The older `months` field still works. The payment record
  keeps `periodUnit` and `periodCount`.
* **Pass types.** `REGULAR` (default), `EMPLOYEE`, `RESIDENT`, `VIP`, `CORPORATE`. A type is a label
  for filtering and reports; every type follows the same validity rules.
* **Several vehicles.** A pass has `vehicles` (the first is the main vehicle; `vehicleNumber` and
  `vehicleType` always mirror it) and `maxVehicles` (1 to 10, default 1). Any vehicle on the pass
  enters and exits free, and a vehicle belongs to at most one current pass of the company.
  Vehicles are added, removed or replaced on the pass page; remove and replace need a reason, and
  are refused while that vehicle is parked. A pass always keeps at least one vehicle. Each change
  is kept in `vehicleChanges` (who, when, why) and audited.
* Passes made before this change are found through `vehicleNumber` and get their `vehicles` list
  automatically when the server starts (`backfillVehicles`).

## QR codes

Tickets and receipts print a QR code holding the ticket number (or pass number). The encoder is
written in the project (`server/utils/qr.js`, identical copy in `client/src/utils/qr.js`); there is
no QR library. On the exit screen the **Scan** button uses the phone/laptop camera
(`BarcodeDetector`, Chrome/Edge/Android) and falls back to typing; USB scanners that act as a
keyboard work in the same box. The same QR is used for the payment link shown for online payments.

## Online payments

Set `PAYMENT_PROVIDER` in `server/.env`:

| Value | What it is | Notes |
|---|---|---|
| `generic` (default) | Your own gateway or bridge posts a signed webhook | Needs `PAYMENT_WEBHOOK_SECRET` (16+ characters). Header `x-signature` is HMAC-SHA256 of the raw body |
| `simulated` | Pretend gateway for testing | Refused when `NODE_ENV=production`. The exit screen shows "Simulate paid / failed" buttons |
| `razorpay` | Razorpay payment links | Needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. **Written from Razorpay's documentation and not yet tried against Razorpay. Test with test keys first.** Webhook URL: `https://<your-api>/api/payments/webhook`, event `payment_link.paid` |

Flow: the exit operator chooses **Online payment**; the server creates a pending payment (valid for
`GATEWAY_PAYMENT_MINUTES`, default 20, and never shorter than the fee quote), the screen shows a QR
of the pay link and polls every 2 seconds. When the gateway reports success the session is closed
exactly as for a cash payment; the barrier opens on its own only if the payment arrives within 15
minutes of the quote. Safety rules:

* The webhook is the only thing that can mark a payment successful. A sweep every minute also asks
  the gateway about payments whose webhook never arrived.
* The paid amount must equal the amount asked for; otherwise the payment is marked failed and a
  `PAYMENT_ISSUE` notification tells the admins (money was taken, nobody was let out).
* A second successful payment for an already-paid session is recorded as failed and flagged for refund.
* A late success after the payment expired is still accepted when the session is still open.
* A payment link is for the fee at the time it was made. If the fee is calculated again later
  (the vehicle stayed longer) and then the old link is paid, the payment is flagged for refund and
  the vehicle is not released at the old price.
* A refund whose gateway call timed out is *not* undone automatically (it may have gone through): the
  payment stays marked refund-pending and `PAYMENT_REFUND_UNCERTAIN` is logged; check it in the gateway.
* An operator can cancel a pending online payment and take cash instead.
* Online refunds go through the gateway (`LOCATION_MANAGE`): the payment is claimed first so two
  clicks cannot refund twice, and put back if the gateway refuses.

## Advanced reports

All under **Reports** (`REPORT_VIEW`, same location scoping and CSV download as before):
peak hours (by hour or weekday), occupancy trend, exceptions (cancelled entries, admin releases, lost tickets,
refunds, failed online payments, payment problems, vehicles inside over 24 hours; with a type filter), payments (by method, status, refunds, failures), stay durations,
passes (active, expiring in 7 to 90 days, revenue), hardware (device uptime, failed commands),
**repeat vehicles** (who comes back, how often, what they pay, whether they hold a pass) and a
**location comparison** (every location side by side).
The calculations are in `server/services/reportMath.js` and are unit tested.

**Downloads.** Every report can be downloaded as CSV, Excel (`.xlsx`) or PDF from the same
buttons. The Excel and PDF files are written by small built-in writers (`server/utils/xlsx.js`,
`pdf.js`, `zip.js`), so no package was added. Excel cells hold text as text (a name that starts
with `=` is never run as a formula). See `docs/api.md` for limits.

**Dashboard trends.** The dashboard has a Trends panel for 7, 14, 30 or 90 days (for all
locations or one): net revenue, busiest day and hour, pass visits, revenue, entries and exits and
most vehicles inside per day, entries by hour, payment mix and pass usage. It is built from the reports, so
the numbers match them.

## Photo capture

Operators attach up to 6 photos (taken at entry, at exit, or other) to a ticket from the entry, exit or
receipt screens; on a phone the camera opens directly. Photos are shrunk in the browser before upload.

* Stored on the server's disk under `PHOTO_STORAGE_DIR` (default `server/uploads/photos`, git-ignored).
  **In production point this at a persistent volume** or photos vanish at each deploy.
* Only real JPEG, PNG or WebP files are accepted: the type is read from the bytes, not from what the
  browser says. Maximum `PHOTO_MAX_BYTES` (default 1.5 MB) each.
* Photos are only served through the API to people who may see the ticket (never a public URL), with
  `nosniff` and a sandboxing content-security-policy. File names never appear in API answers.
* Deleting a photo needs `LOCATION_MANAGE`. A nightly job deletes photos of closed sessions older
  than `PHOTO_RETENTION_DAYS` (default 90).

## Custom roles (advanced RBAC)

The six standard roles still exist. A company admin (`ROLE_MANAGE`, new) can also create roles on
**Roles**: a name, a base role and a set of permissions.

* The **base role** (Location Admin or one of the operator roles; fixed at creation) decides *rank*
  (who the user can manage) and whether the user sees one location or all. Company-wide roles
  cannot be a base.
* The **permissions** list decides what the user can do. A custom role replaces the base role's
  list, so it can be smaller or just different (for example an entry operator who also sees reports).
  `COMPANY_MANAGE`, `PLATFORM_MANAGE` and `ROLE_MANAGE` can never be given to a custom role.
* Permissions are read on every request. Editing a role takes effect at once without anyone logging
  in again. A user whose role has disappeared can do nothing.
* Handing a role out (Users page) needs `USER_MANAGE`, a base role below your own rank, and every
  permission in the role must be one you hold yourself.
* Nobody can pass on access they do not hold: creating a user with a standard role, changing a
  role, clearing a custom role or resetting a password is refused when it would give (or take over)
  permissions the person acting does not have themselves. With the standard roles this never gets in
  the way, because each role holds everything the roles below it hold.
* A user on an operator base whose custom role adds anything beyond entry, exit and payment (for
  example reports) gets the dashboard instead of the gate screens, so they have somewhere to use it.
* A role that users still hold cannot be deleted. Choosing a standard role for a user replaces their
  custom role. Changing a user's role ends their sessions, like any role change.
* Up to 50 custom roles per company. Created, changed and deleted roles are in the audit log
  (`ROLE_CREATE`, `ROLE_UPDATE`, `ROLE_DELETE`).

## Plate reading (days 18-21)

The number plate comes from only two places: the gate's **ANPR camera** (it reads the plate itself and posts
it to `POST /api/device/anpr`, see `docs/hardware.md`) or the operator **typing the number** on the Entry or
Exit screen. The platform does not read plates from photos and has no AI or recognition service of its own.

* A camera reading is only a **suggestion**: plate cleaned and validated, low or missing confidence flagged
  (the camera's minimum, default 0.85), already-inside / blocked vehicles flagged on entry, the open ticket
  matched on exit, the same plate seen again within two minutes is one suggestion with more hits. Using a
  suggestion is audited as `ANPR_CONFIRM` (with `source` and whether the operator corrected the plate).
* Vehicle photos on a ticket (taken at the gate or uploaded) are still kept as evidence; they are not read.
* An earlier version could read plates from photos with a recognition provider (`RECOGNITION_*` settings,
  `POST /api/anpr/read`, the Python `ai-service/`). All of that was removed; old `PHOTO` suggestions in the
  database stay readable.

## Email (day 27)

Email goes out through one layer (`server/integrations/email`) chosen with `EMAIL_PROVIDER`:
`none` (default: nothing is sent, the app works as before), `simulated` (nothing is sent; messages are
printed in the server log; development and tests only, never in production) and `resend`
([Resend](https://resend.com), plain web API, no extra package; needs `RESEND_API_KEY` and `EMAIL_FROM`).
A wrong name or missing key stops the server at start.

What is emailed:

* **Password reset link** to the person who asked. It is sent in the background, so the answer is
  identical and equally fast for unknown addresses.
* **Alerts**: every in-app alert is also emailed to the company admins and the admins of the alert's
  location (all location admins for a company-level alert). Each person chooses under **My account >
  Email alerts**: *urgent only* (default), *warnings and urgent*, *every alert* or *never*
  (`PUT /api/auth/preferences`). Each recipient gets their own copy; the same alert is never emailed
  twice (it shares the in-app alert's de-duplication key).
* A company can cause at most `EMAIL_ALERT_HOURLY_CAP` (default 30) alert emails per hour.
* Sending never slows down or fails the request that caused it. A failed send is retried once
  (rate limit, server error, network trouble) and then logged; the log never contains the key or the message.

To switch on for real: create a Resend account, verify your domain, put the key and an `EMAIL_FROM`
address on that domain in `server/.env`, set `EMAIL_PROVIDER=resend` and restart. For a first test
without a domain use `EMAIL_FROM=onboarding@resend.dev`, which delivers only to your own Resend
account address.

**Pass holders.** A pass can carry an optional email address (set when selling a pass, or later under *Holder
contact* on the pass page; empty removes it). With email switched on, that address gets a confirmation when the
pass is sold, a notice when it is renewed, and one reminder when it is within 7 days of ending (sent together with
the admin alert, so never twice for the same end date). A pass without an address sends nothing. The email lists
the pass number, vehicles and the first and last valid day; the footer tells a wrong recipient to ask the parking
office to remove the address.

Not built: a delivery log screen, a way for a holder to unsubscribe by themselves, and push notifications
(that channel remains a placeholder). SMS and WhatsApp are described next.

## SMS and WhatsApp

Text messages go out through one layer (`server/integrations/messaging`) chosen with `MESSAGING_PROVIDER`:
`none` (default: nothing is sent), `simulated` (printed in the server log; development and tests only) and
`twilio` (needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and a sender per channel). `MESSAGING_CHANNELS` is
`sms` (default), `whatsapp` or `sms,whatsapp`. A wrong name or missing key stops the server at start.

Who gets what (all in the background; a failure is retried once, logged without keys or full numbers, and never
fails the request):

* **Admins**: each in-app alert, as a text to the mobile number on the profile of the company admins and the
  admins of the alert's location. Each person chooses under **My account > Email alerts > SMS / WhatsApp**
  (urgent only by default; `PUT /api/auth/preferences` with `phoneAlerts`). At most `MESSAGING_ALERT_HOURLY_CAP`
  (default 20) alert texts per company per hour.
* **Vehicle owners**: on entry a note with the ticket number, on exit the duration, the amount paid and the
  ticket. The number is taken from the vehicle record (Vehicles page), else from a current pass that lists the
  plate. No number, no message. `MESSAGING_VISIT_MESSAGES=off` stops these. Exits released by an admin override
  send nothing.
* **Pass holders**: a note when a pass is sold, when it is renewed and one reminder before it ends (needs the phone
  number on the pass).
* **Bookings**: a confirmation to the phone entered on the booking.

Numbers written without a country code get `MESSAGING_DEFAULT_COUNTRY_CODE` (default 91). Type `+` and the code
for foreign numbers.

To switch on: create a Twilio account, put the SID, token and sender in `server/.env`, set
`MESSAGING_PROVIDER=twilio` and restart. **Not verified live**: this was written from Twilio's documentation and
tested with a fake network only. Things outside the code that you must handle: SMS to Indian numbers needs DLT
registration of your sender and message templates, and WhatsApp messages sent outside a customer's 24-hour window
need a template approved by WhatsApp (the sandbox number only reaches numbers that joined it). The texts are plain
text in English; there are no templates yet. The owner notes are sent to the number held on the record, so tell
vehicle owners and pass holders that they will receive them (see your privacy policy).

## Entry screen and advance payments

The operator **Entry** screen is one screen: a live camera panel (start it once; it is remembered), the plate box,
large vehicle-type buttons that show how many spaces are free, **Create ticket**, the ticket beside the form, and
a table of vehicles inside below (search, reprint a ticket, advance column).

* **Camera.** The plate comes from the gate's ANPR camera (suggestions beside the form, with a live picture when
  the camera has a live picture address) or from typing. This computer's own camera is optional and only keeps a
  picture of the vehicle: *Capture photo* saves it as the vehicle's entry photo. It never reads the number.
* **No payment at entry.** The Entry screen no longer offers an advance payment: the fee is worked out and paid at the exit. The only money that arrives before the exit is a customer's own online booking fee (below). The server's advance support below is still there but nothing on the screen uses it.
* **Advance payment (no longer on the Entry screen).** Operators who can collect payments (`PAYMENT_COLLECT`) used to see *Advance payment*:
  amount and mode (cash, UPI, card, with an optional reference). Entry-only operators do not see it, and the server
  refuses an advance from them (403) before any ticket is made. The advance is a Payment row of kind `ADVANCE`, in the
  collecting operator's open shift, so shift cash, the day's collection, reports and the dashboard count it with no
  extra steps.
* **At exit** the fee is worked out as before and the advance pays it first:
  * advance **less** than the fee: the customer pays only the rest (`fee.due`; `POST /api/payments` must carry that
    amount, and an online payment link is for that amount);
  * advance **equal or more**: no payment step. The vehicle is released at once and any extra is given back:
    the screen says how much, the advance row is marked refunded for that amount (in the exit operator's shift
    for cash) and the session records `fee.advanceRefunded`;
  * a free exit (grace period, valid pass) gives the whole advance back.
* **Cancelling an entry** gives the whole advance back. An **admin override** keeps it (nothing is refunded).
  An advance cannot be refunded by hand while the vehicle is inside.
* **Receipt** shows the advance (and any part given back); *Paid* is the advance kept plus the payment at exit.

How the books show it: an advance is money collected on the day it was taken; the part given back appears under
*refunded* on the day it was returned, and the net is right. A REFUNDED advance whose refund is smaller than its
amount was partly refunded (the rest paid the fee). The tax of a fee covered entirely by an advance is booked on the
advance row.

Upgrade note: the unique index `one_success_per_session` on payments is replaced by
`one_success_per_session_kind` (a session may have one successful advance and one successful fee payment).
The server does this itself at start (`migrateIndexes`); it is safe to repeat.

## Operator screens: Home, lists, bookings, FASTag, automatic entry

Added so gate staff have the same everyday screens as a typical parking-operator site.

* **Home** (`/operator/dashboard`, `GET /api/operator/summary`): the plan and the date it is valid till, the
  day's money (entry amount = advances, exit amount, cash, online, UPI, card, FASTag, total), and entries /
  exits / available / parked for all vehicles and for each vehicle type, with quick buttons and Print.
  Staff who cannot handle money (the default Entry operator) see the counts only. Pass sales are not in
  these money numbers (they are in Reports and the shift totals).
* **Entry List / Exit List** (`GET /api/operator/entries`, `/exits`): one day at a time, search by plate or
  ticket, page size 10/25/50/100/200, **Download Excel** (CSV and PDF too with `?format=`) and Print. Exit List
  columns: payment mode, type, token (ticket), in/out time, total time, advance, paid at the counter, payable (the fee).
* **Collection by vehicle type** (`GET /api/operator/collection`, also a card on the Collection page): per vehicle
  type, entry amount, exit amount and each payment mode, refunds on the day they were given back, Excel and Print.
* **FASTag** is a payment mode next to cash, UPI and card, for the advance at entry and for the payment at exit.
  It is only recorded by the operator: there is no connection to the toll-tag network (NETC) or a bank, so
  nothing is charged by itself and it is not part of the cash drawer. FASTag lanes, plaza IDs and the
  "FASTag health" check are not built.
* **Customer bookings** (`/api/bookings`, "View customer bookings" on the Entry screen): staff add a booking
  (vehicle, type, optional name, phone and note, expected arrival). Typing a booked plate shows who booked;
  *Use for entry* fills the form; creating the ticket marks the booking ARRIVED. A booking does **not** hold a
  space and takes no money. Unused bookings expire `BOOKING_GRACE_HOURS` (default 12) after the expected
  time; one waiting booking per vehicle per location; at most 30 days ahead. Anyone with entry permission can
  add or cancel; everyone who can see sessions can read.
* **Auto entry** (switch in the camera panel, off every time the page opens): a plate read **85% sure or more**
  with nothing to double-check creates the ticket by itself. Safeguards: the car just ticketed (or just
  refused) is ignored for a minute; nothing happens while a number is typed, a ticket is being made or the chosen
  type is full; the server still refuses blocked vehicles, vehicles already inside and a full parking. It never
  takes an advance and uses the vehicle type selected on screen (the camera cannot tell cars from bikes), so
  a wrong reading becomes a real ticket that an admin must cancel. Needs an ANPR camera registered for the gate.
  Auto *exit* below does the same for leaving, but never takes money.

## Exit screen

The operator Exit screen follows the reference site:

* **Type to search**: a big box takes a vehicle number, any part of it (3 characters or more), or a ticket / pass
  code (`GET /api/parking/entries?q=` with `match=contains` matches anywhere in the number; the default still
  matches the start). Results list vehicle, ticket and entry time; click one to open its bill. A scanned QR or a
  typed full ticket number opens the bill straight away.
* **Camera panel** with an **Auto exit** switch (off every time the page opens): a plate read 85% sure or more
  with nothing to double-check opens that vehicle's bill by itself. The car just looked up is ignored for a
  minute and nothing happens while a number is typed or a bill is open. It only looks the vehicle up, so the
  operator still takes the payment; a vehicle that owes nothing (grace period, valid pass, fully covered by its
  advance) is released by the server as before.
* **Payment**: cash, UPI, card, FASTag or online. For cash the operator types the cash given and the screen shows
  the amount to return.
* **After exit**: success message and **Print bill**, which sends the receipt to the gate's thermal printer (`POST /api/parking/sessions/:id/print`).
* **Today's exits** table under the screen (number, vehicle, mode, type, out time, bill), refreshed after each exit.

## Operator header: bookings, theme and profile

Taken from the reference site's operator header:

* **Bookings (n)** opens a list of every customer who booked ahead and has not arrived, at all of the user's
  locations, soonest first, with a search box (customer, phone or vehicle). The number is the count of waiting
  bookings. Adding, using and cancelling a booking is still done on the Entry screen. The reference site also
  shows amount and payment columns for *paid* online bookings; ours are free reservations, so those are not shown.
* **Theme** (this device only): header colour, light or dark pages, and a compact menu.
* **My profile**: the user edits their own name and mobile number (`PUT /api/auth/profile`) and changes their
  password. The email is the login, so it cannot be edited there.

## Receipt designer

Each location has **Receipt** settings (location page, *Receipt* tab, needs `LOCATION_MANAGE`):

* an extra **header line** under the address, a **ticket footer** and a **receipt footer** (empty = the standard wording);
* switches for the **address** and the **GST number**;
* **QR code**: follow the gate printer's own "print QR" switch (default), always, or never.

They apply to the ticket on screen (Entry), the receipt on screen and the thermal printer, and the tab shows a
live preview of both slips. They are stored on the location as `receiptSettings`; a location without them prints
exactly as before. `GET /api/parking/sessions/:id/receipt` returns the resolved `settings`. Not built: logo
printing, free layout / drag-and-drop design, several languages, a different design per vehicle type.

## Live updates, lanes and instant gate commands

* `GET /api/live/stream` pushes "something changed" (ids only) to open screens; they reload through the
  normal API, so permissions are unchanged. Screens keep a slower timer as a safety net and show a Live dot.
* `GET /api/device/stream` wakes a gate agent the moment a command is queued (barrier, printer, CCTV), so
  barriers react at once instead of at the next poll. The agent still polls as a fallback.
* Gates have optional lane code, plaza ID and FASTag lane ID; entry and exit screens remember each
  computer's location and gate and show them in a lane bar.
* Limits: one server instance (connections live in memory); proxies must not buffer streams. See
  `docs/hardware.md`. Tests: `server/tests/live.test.js`, `gate-agent/tests/wake.test.js`.

## ANPR camera on the Entry and Exit screens

* A camera's `config.previewUrl` (editable on the Hardware page, "Live picture address") makes the Entry and Exit
  screens show its live picture (`GET /api/anpr/preview`). It is optional; readings work without it.
* New plates fill the Vehicle number box (entry) or the search box (exit) by themselves, and the AUTO ENTRY / AUTO EXIT
  switch at the top of each screen works with the gate camera (camera plates only, never tags).
* Automatic by default: with a gate camera, AUTO ENTRY and AUTO EXIT start on (pause switch); entry makes, prints and opens;
  exit finds the vehicle and shows the fee, and the barrier opens when the payment is recorded.
* A camera reading that is not the usual shape of an Indian plate (for example `KA53IND02497`) is marked "Check this plate", so
  AUTO ENTRY and AUTO EXIT never act on it; it can still be used by hand.
* One two-way camera: register it with direction "Entry and exit" (no gate) and send `"direction": "AUTO"`;
  the server sends a plate with an open ticket of 5+ minutes to Exit and any other plate to Entry.
* One camera per gate: when an ANPR camera is registered for the gate and direction, the Entry and Exit screens show
  that camera's readings. Without one, the screen says no ANPR camera is set and the operator types the number.
  Tests: `server/tests/preview.integration.test.js`.

## Gate controls, re-entry, five vehicle classes, online booking

Built after comparing the product with ismartparking.com's operator panel (features and flow only).

**Open barrier by hand.** *Open barrier* on the Entry and Exit screens lifts the lane's barrier without a ticket
(`POST /api/parking/barrier { locationId, direction, gate?, reason? }`; needs `ENTRY_CREATE` for entry, `EXIT_CREATE` for exit).
It goes through the same command queue as a normal lift, so the agent, retries and the "did not respond" status all work as before.
Limits: 6 a minute per person, one command per person and lane every 5 seconds (a double click lifts once), and every use is
audited as `BARRIER_MANUAL_OPEN`. It answers 404 when the lane has no single barrier, so a wrong barrier is never guessed.

**Re-entry.** *Re-Entry* in the vehicles-inside table (`POST /api/parking/sessions/:id/re-entry`, needs `ENTRY_CREATE`) cancels a
ticket and issues a fresh one for the same vehicle, for a driver who turned back or a ticket that was misprinted.
Rules: only an open ticket; any age, any number of times per day (an advance on the old ticket is given back); only the
location's *Allow re-entry* switch can turn it off; blocked vehicles are refused;
repeating the same call returns the same new ticket. The old ticket is `CANCELLED` ("Re-entry: a new ticket was issued") and the
space is not counted twice.

**Payment mode at entry:** not used any more. Payment is taken at the exit.

**Five vehicle classes.** Car, Bike, Coach / Bus / Truck (`HEAVY`), Taxi (`TAXI`) and Tempo / SUV / Mini bus (`TEMPO`). Each has its own
capacity, occupied count, tariff, availability card, report row and collection row. The first three keep their old values so stored data
keeps its meaning; an old location simply has 0 spaces for the two new classes until you set them. A class is accepted by a
location when it has capacity.

**Online booking with payment.** A location can take bookings on the public page.

* Setup: Location > Details > *Online booking*: tick *Take online bookings*, set a booking fee per class (0 = that class books free)
  and an optional note. Fees are charged only when an online gateway is set up (`PAYMENT_PROVIDER=razorpay`, or `simulated` for trying it).
* Customer: `/book` lists parkings, `/book/:locationId` takes vehicle number, class, name, mobile and arrival time, then sends the customer
  to the payment page (Razorpay link, returning to `/booking/return`). `/booking/:id?token=...` shows the booking and refreshes while payment is pending.
  The token is a secret shown once in the link; only its hash is stored; a wrong id or token both answer "not found".
* Money: a paid booking is `BOOKED` and the fee is held. When the vehicle gets its ticket the fee becomes the ticket's **advance**
  (an `ADVANCE` payment, method `GATEWAY`), so it is taken off the exit fee and counted in collection reports. If the advance is more
  than the fee, the extra is returned as for any advance, but because it was paid online the refund is marked *pending in the gateway*
  and a critical alert asks an admin to refund it in the gateway.
* Not confirmed unless paid: an unpaid booking is `AWAITING_PAYMENT` and closes as `EXPIRED` after `GATEWAY_PAYMENT_MINUTES`.
  A payment that arrives late still confirms the booking when the arrival time has not passed; one that cannot be used (wrong amount,
  booking cancelled or expired for good, an advance already taken at the gate, plate booked twice) becomes `REFUND_DUE` with a critical
  alert, never silent. A booking cancelled by staff with a paid fee is flagged `REFUND_DUE` and an admin is alerted. Refunds of
  online booking fees are made by an admin in the gateway; there is no refund button for them yet.
* A booking does not hold a space (as for staff bookings). The same plate can have only one waiting booking at a location.
* Limits: 10 new bookings per 15 minutes per address; the public routes expose only name, address, hours, note and fees.
* Messages: the customer gets the booking text (see *SMS and WhatsApp*) once it is confirmed.

**Gate agent download.** Hardware page > *Download gate agent (.zip)* (`GET /api/hardware/agent-package`, needs `LOCATION_MANAGE`).
The server packs the `gate-agent` folder next to it with a ready `config.json` (this server's address filled in, placeholder device keys,
never a real key), `start-agent.bat` / `start-agent.sh` (restart if it stops) and `INSTALL.txt`. Tests, printed slips, `node_modules`
and any local `config.json` are left out. If the server is deployed without the `gate-agent` folder (or `GATE_AGENT_DIR` points nowhere)
the page says so. This is a zip that needs Node.js 20 on the gate PC, not a Windows installer program (.exe / .msi); making one is a separate job.

## Settings added

See `server/.env.example`: `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `GATEWAY_PAYMENT_MINUTES`, `PHOTO_STORAGE_DIR`,
`PHOTO_RETENTION_DAYS`, `PHOTO_MAX_BYTES`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
`EMAIL_TIMEOUT_MS`, `EMAIL_ALERT_HOURLY_CAP`, `MESSAGING_PROVIDER`, `MESSAGING_CHANNELS`, `MESSAGING_DEFAULT_COUNTRY_CODE`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WHATSAPP_FROM`, `MESSAGING_TIMEOUT_MS`, `MESSAGING_ALERT_HOURLY_CAP`, `MESSAGING_VISIT_MESSAGES`, `BOOKING_GRACE_HOURS`, `LIVE_MAX_STREAMS`, `PUBLIC_API_URL`, `GATE_AGENT_DIR`.

## Known limits

* A bank/UPI reference (`transactionId`) must be unique across the whole platform, not per company, so
  two companies cannot record the same reference (an existing Phase 1 rule).
* Partial refunds by hand and push/e-mail alerts for payment problems are not built (admins see
  `PAYMENT_ISSUE` notifications in the app). The only partial refund is the extra of an advance at exit.
* Advances taken at the gate are cash, UPI, card or FASTag only (not an online link), one per ticket, and cannot be added later. The one online advance is a paid online booking fee, and a ticket cannot have both: if a booked customer is also given an advance at the gate, the online fee is flagged for refund.
* Online booking fees are refunded by an admin in the gateway (the app flags and alerts, it does not call the gateway to refund).
* The default **Entry operator** role cannot take an advance (it has no `PAYMENT_COLLECT`); give that permission to a custom role if the entry gate should take advances.

## Not yet verified

The database-backed tests for this phase (`*.integration.test.js` for passes, gateway, reports,
photos, roles, plate reading, email and advances) were written without a database to run them on: run `npm test` in `server` and
report any failure (this also covers the newest ones: messaging, vehicle classes, hardware controls and online booking). Also untried: the Razorpay adapter against Razorpay, camera QR scanning, photo capture
in real phones, a real ANPR camera, real email delivery through Resend, the live camera panel in a browser, and `npm run build` for the client.
