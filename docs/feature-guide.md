# Feature guide: what the website does

A plain-language tour of every part of the Smart Parking SaaS site: who uses it, what each screen is for, how a vehicle moves through the system, how money is handled, and what is not built yet. Technical details live in the other documents in this folder (`api.md`, `hardware.md`, `phase2.md`, `tariffs.md`, `security.md`).

## 1. The big picture

Smart Parking is a **multi-company (SaaS) system**. Each company has its own locations, staff, tariffs, vehicles, passes and money; companies never see each other's data. A platform owner (the Super Admin) sits above all companies.

The site has three areas:

| Area | Address | Who it is for |
|---|---|---|
| Public website | `/`, `/product`, `/faq`, `/blog`, `/contact`, `/aboutus`, `/ResellerLogin` | Visitors who want to know about the product or ask for a demo |
| Online booking | `/book`, `/book/:locationId`, `/booking/:id` | Customers who book a space and pay the booking fee online |
| Dashboard (back office) | `/dashboard/...` | Owners and managers: set things up, watch the numbers, manage people |
| Operator area (gate screens) | `/operator/...` | Staff at the gate: enter and exit vehicles, take money |

The server (Node/Express with MongoDB) enforces every rule. The screens only hide what you may not use. A small program, the **gate agent**, runs at the parking site and connects physical devices (barrier, printer, cameras, readers) to the cloud.

## 2. Who can do what (roles)

| Role | Typical person | Can do |
|---|---|---|
| Super Admin | Platform owner | Everything, across all companies; edits the public website |
| Company Admin | Owner of one parking business | Everything inside the company: locations, users, roles, passes, reports, company plan, audit log |
| Location Admin | Site manager | Same as above for their own locations only (no company settings, no roles) |
| Entry Operator | Gate staff at entry | Register entries |
| Exit Operator | Gate staff at exit | Process exits and collect payments; open and close shifts |
| Collection Operator | Cashier / supervisor | Collect payments and view reports |

A company admin can also create **custom roles** (Roles page): pick a base role (which decides rank and whether the person sees one location or all) and a list of permissions. Changes apply immediately. Nobody can hand out permissions they do not hold themselves. Operators whose role has only gate permissions are sent to the operator area; anyone with more gets the dashboard.

## 3. Getting in

* **Register** creates a company and its first admin. **Login**, **Forgot password** and **Reset password** work by email link (when email is switched on).
* Login attempts are rate-limited and a user who is locked out must wait. Changing your password or role ends your other sessions.
* **My profile**: edit name and mobile number, change password, and choose which alerts reach your email (urgent only, warnings and urgent, every alert, never).

## 4. The dashboard (back office)

**Overview.** A getting-started checklist for new companies, then live cards: occupancy, alerts, traffic today by hour, revenue for the last 7 days, payments today, exceptions today, activity per operator, and a comparison of all locations. A **Trends** panel shows 7, 14, 30 or 90 days. Everything can be filtered to one location.

**Parking Locations.** Add and edit locations. Each location opens with tabs:
* *Details*: name, address, timing, capacity per vehicle type.
* *Slots*: the individual spaces and how many are free.
* *Tariffs*: the price rules (see section 7).
* *Receipt*: header line, ticket and receipt footers, address and GST switches, QR on or off, with a live preview of the ticket and the receipt.

**Vehicles.** A register of vehicles (plate, type, owner, phone). Search by plate, see visit history, block a vehicle (blocked vehicles are flagged or refused at entry).

**Monthly Passes.** Sell a pass for days, weeks or months; renew, suspend, resume, cancel. See section 8.

**Hardware.** Register devices, copy their keys, watch online/offline status, send test commands. See section 9.

**Reports.** Fourteen reports, each downloadable as CSV, Excel or PDF: revenue, collection, vehicle history, occupancy, operators, peak hours, occupancy trend, length of stay, payment methods, exceptions (cancelled entries, admin releases, lost tickets, refunds, failed online payments, vehicles inside over 24 hours), passes, hardware, repeat vehicles, and a location comparison. Location admins only see their own locations.

**Users.** Add staff, assign a role and the locations they work at, switch accounts off, reset passwords. You can only manage people ranked below you.

**Roles.** Create and edit custom roles (see section 2).

**Company.** Plan and subscription, and company details.

**Audit Log.** A record of important actions (who, what, when): passes sold, entries cancelled, barriers opened, roles changed, tags set and so on.

**Notifications.** In-app alerts for admins: pass expiry, payment problems, devices going offline, vehicles inside too long. Each is also emailed according to each person's preference.

**Website** (Super Admin only). Manage the public site's enquiries (leads), FAQ, blog posts and testimonials.

**Gate Operations** (link) opens the operator area for admins who also work a gate.

## 5. The operator area (gate screens)

Menu: Home, Vehicle Entry, Vehicle Exit, Entry List, Exit List, Vehicles Inside, Collection, Vehicle Search.

The header has **Bookings (n)** (every customer who booked ahead and has not arrived), **Theme** (colour, light or dark, compact menu; saved on this device), **My profile** and the current shift.

**Home.** The plan and its valid-till date, the day's money (advances taken, exits, cash, online, UPI, card, FASTag, total) and counts of entries, exits, available and parked, for all vehicles and per vehicle type. Staff who cannot handle money see counts only.

**Vehicle Entry.** One screen:
* a live camera panel (start it once; it is remembered) and a plate box;
* large vehicle-type buttons that show how many spaces are free (Car, Bike, Taxi, Coach / Bus / Truck, Tempo / SUV / Mini bus);
* *Capture & read plate* or *Auto-read* fill in the plate for you (the operator always checks it);
* *Auto entry* (off every time the page opens) creates the ticket by itself when a plate is read at 85% certainty or more with nothing to double-check;
* *Read from photo* for a picture from a phone;
* **Create ticket** prints a ticket with a QR code;
* optional **advance payment** (cash, UPI, card or FASTag) for staff who may collect money;
* **customer bookings**: a booked plate shows who booked; *Use for entry* fills the form and marks the booking arrived;
* a pass banner when the vehicle holds a valid pass;
* suggestions from gate cameras and readers (plate, UHF pass tag, FASTag) with a tap to use or dismiss;
* **Open barrier** in the lane bar, to lift the barrier by hand (audited, limited per minute);
* a table of vehicles inside: search, reprint a ticket, **Re-Entry** (cancel and issue a new ticket), see the advance.

**Vehicle Exit.**
* type any part of a vehicle number (3 characters or more) or a ticket or pass code, or scan the QR with the camera or a USB scanner, or tick *Ticket is lost*;
* the bill shows the fee, any advance already paid and what is still due;
* payment by cash (with change to give back), UPI, card, FASTag (recorded, or really charged when a FASTag partner is set up: `docs/fastag.md`), or **online** (a QR payment link that confirms by itself);
* a pass closes the visit free; a grace period closes it free; an advance that covers the fee releases the vehicle and shows the change to return;
* *Auto exit* only looks the vehicle up, never takes money;
* after payment: **Print bill** to the gate printer, and the barrier lifts through the gate agent;
* *Today's exits* table below.

**Entry List / Exit List.** One day at a time, search, page size, download Excel, CSV or PDF, print.

**Vehicles Inside.** Everyone currently parked, with search, entry photos and cancel (admins).

**Collection.** Shifts and money: open a shift with opening cash, close it with counted cash and see the difference. A card breaks the day's collection down by vehicle type and payment mode.

**Vehicle Search.** Find a vehicle and its history.

**Receipt page.** Printable receipt with QR and the location's receipt settings. Up to 6 photos can be attached to any ticket (taken at entry, exit or other).

## 6. Life of a vehicle, step by step

1. **Entry.** The operator (or auto entry) registers the plate and type. The server checks: not blocked, not already inside, space available, optional booking and pass. It creates a ticket, takes any advance, may fire the entry barrier, prints a ticket, and may ask a CCTV camera for an entry photo.
2. **Parked.** The vehicle shows under Vehicles Inside and counts in occupancy. Alerts fire if it stays over 24 hours.
3. **Exit.** The operator finds the vehicle, the server calculates the fee, the advance is applied, and payment is taken (or skipped for a pass, grace period or covering advance).
4. **Release.** The session closes, the receipt is available, the barrier lifts, the bill prints, and an exit photo may be taken.
5. **Afterwards.** The payment is in the shift, the day's collection, the reports and the dashboard. Everything is in the audit log.

Admins can also **cancel an entry** (a refund of any advance goes back) and do an **admin release** with a recorded reason (the advance is kept).

## 7. Tariffs and fees

Set per location and vehicle type (Locations > Tariffs). A tariff can combine:

* grace period (free minutes);
* duration slabs (for example up to 60 minutes = 20, up to 180 minutes = 50);
* an hourly rate after the last slab;
* minimum fee and daily maximum;
* overnight fee;
* lost-ticket fee;
* tax percent, inclusive or added on top;
* days of the week and a valid-from and valid-to date.

Without an active tariff for a vehicle's type, the exit screen says "No tariff is set up for this vehicle type at this location". See `tariffs.md` for the exact order of the calculation.

## 8. Passes

A pass lets a vehicle in and out free for whole calendar days at chosen locations (or all of them).

* Sold for days, weeks or months; types are Regular, Employee, Resident, VIP and Corporate (labels for filtering and reports).
* One pass can cover several vehicles (up to 10) that you add, replace or remove, with reasons recorded. Each vehicle can also carry a UHF/RFID tag.
* Payment (cash, UPI, card, online or complimentary) is recorded and counts in collections and reports.
* An optional holder email receives a confirmation, a renewal notice and one reminder in the last 7 days. Admins are alerted too.
* A pass can be suspended (the vehicle pays normally), resumed, or cancelled.
* The pass page prints a card with a QR code.

## 9. Hardware

Every device has its own key (`hwk_...`, shown once). A gate agent at the site connects outward over HTTPS; no router ports are opened.

| Device | What the software does | Honest limits |
|---|---|---|
| Boom barrier | Opens after a legitimate entry, paid or free exit, or admin release; retries safely; never twice for the same event | Needs a relay the agent can drive |
| Thermal printer | Prints tickets and bills; reprint button; test print | ESC/POS printers via shared name, network or command |
| ANPR camera | Posts a plate; it becomes a suggestion with a confidence score. The Python AI service can read a webcam or IP camera and show a live picture with the plate box | A suggestion only (or AUTO ENTRY / EXIT when the operator switches it on and the reading is confident); accuracy with real models and cameras is not proven yet |
| UHF / RFID reader | A pass tag read becomes a "Pass tag" suggestion | Suggestion only; unknown tags are logged |
| FASTag reader | The vehicle number becomes a "FASTag" suggestion | Charging needs a FASTag partner (`docs/fastag.md`); otherwise record only |
| CCTV camera | Takes an entry and exit photo that is filed on the ticket; test button | Camera address stays on the gate PC |

**Live updates.** Open screens are told at once when a plate is seen, a ticket is made or a payment arrives (the green *Live* dot above the entry and exit screens), and gate agents are woken the instant a barrier or printer command is queued. Both fall back to normal refreshing if the connection drops. **Lanes:** each gate can carry a lane code, plaza ID and FASTag lane ID, and each computer remembers its location and gate.

Devices that go quiet are marked Offline with one alert per outage. A failing device never blocks entry, exit or payment: the operator is told to act by hand. Only the built-in simulator and automated tests have exercised the reader and CCTV support so far.

## 10. Money and payments

* **Modes:** cash, UPI, card, FASTag (recorded, or charged with a partner), prepaid wallet, online gateway, and advance.
* **Wallets:** a company's regular customers can hold a prepaid wallet (Dashboard > Wallets). Gate staff top it up with cash, UPI or card (Operator > Wallets); at exit the fee is taken from it. See `docs/wallets.md`.
* **Online payments:** `generic` webhook, `simulated` (testing) or Razorpay (not yet tried live). The webhook is the only thing that can mark a payment successful; amounts must match exactly; late or duplicate payments are flagged for refund and admins are alerted.
* **Shifts:** each cashier opens and closes a shift; counted cash is compared with expected cash.
* **Refunds:** online refunds go through the gateway (location admins); an advance's extra is given back at exit.
* **Collection by type and mode** and the reports always agree with each other.

## 11. Background work

* every minute: close or confirm plan purchases and hardware orders; every 5 minutes: send due end-of-day report emails;
* every minute: ask the gateway about payments whose webhook never arrived; mark silent devices offline;
* daily: warn about passes ending within 7 days (and email the holder);
* nightly: delete photos of closed tickets older than 90 days;
* unused customer bookings expire 12 hours after the expected time;
* unused camera suggestions disappear after 15 minutes.

## 12. Safety rules worth knowing

* The server enforces permissions, company separation and rate limits on every request.
* Cameras and readers only suggest; staff confirm. Auto entry and auto exit are optional switches that are off every time the page opens.
* Device calls are safe to repeat; each command has a deadline and a retry limit.
* Photos are never public: they are served only to people who may see the ticket, and only real JPEG, PNG or WebP files are accepted.
* Email, SMS-style channels and sending never slow down or break the action that caused them.

## 12a. The public website (what a visitor sees)

* **Plans and price calculator** on the home page: prices come from `PRICING` in `client/src/data/site.js` (Parking Management ₹499 per user per month, Valet ₹699 marked "Coming later", 18% GST split into CGST and SGST, plan-length discounts). The calculator only works out a price and sends the visitor to the contact form with the numbers filled in; the visitor continues to **Dashboard > Billing** to pay online (see `docs/billing.md`).
* **Legal pages** `/privacy-policy`, `/terms-conditions` and a visitor sitemap `/sitemap`. The text is a **draft** written from what the software does and needs a lawyer's review. Company details come from `client/src/config/site.js` (`legalName`, `jurisdiction`, `refundPolicy`, `email`, `phone`, `address`); empty values are hidden.
* **Proof band** shows only real data: location and vehicle counts from `/api/public/stats` (hidden when zero), published testimonials (added in Dashboard > Website > Testimonials) and the optional `clients` list in `config/site.js`. Nothing is invented.
* **Demo video and phone buttons** appear only when `demoVideoUrl` / `phone` are set in `config/site.js`.
* **FAQ** shows a built-in set of 11 answers until the Super Admin publishes their own.
* **Installable app (PWA):** manifest, icons and a pass-through service worker; the browser's install prompt works on a production build only.
* **Search engines:** `npm run build` runs `scripts/make-seo.mjs`, which writes `public/robots.txt` and, when `VITE_SITE_URL` is set (environment or `client/.env`), `public/sitemap.xml`.

## 13. Not built yet

* Automatic toll-lane FASTag charging and FASTag health checks (lane IDs are stored as labels only). Counter charging is built; it needs a bank/NETC partner (`docs/fastag.md`).
* Live updates across several server instances (needs Redis or similar).
* LED display boards, handheld terminals and the mobile app.
* Valet management (the Valet plan is shown as "Coming later"). Event and airport tariffs are built (`docs/tariffs.md`).
* Prepaid wallets are built for counter top-ups (`docs/wallets.md`). Not built: customers topping up online by themselves, a customer login, low-balance texts.
* Hardware shop is built (`docs/shop.md`), untested with real Razorpay. FASTag charging is built against a simulator (`docs/fastag.md`), no real partner yet. Still planned: valet, reseller portal, mobile app (phase 4).
* Plan checkout, GST invoices, OTP signup, map picker and report emails are built (`docs/billing.md`) but untested with real Razorpay, Twilio, email and Google Maps keys.
* A Windows installer program (.exe) for the gate agent: today the Hardware page downloads a zip that needs Node.js.
* Refund buttons for online booking fees (the app flags them and alerts an admin; the refund is made in the gateway). Customer cancelling their own booking online.
* Push alerts; a delivery log for emails and texts; holder self-unsubscribe; WhatsApp message templates (SMS and WhatsApp are built through Twilio but untested live).
* Logo printing and free-layout receipt design.
* Tested against real hardware, real Razorpay, a real recognition provider and real email delivery: so far only simulators and automated tests.
