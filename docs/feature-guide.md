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
| Supervisor | Shift in-charge | Entry, exit and payments, plus reports, re-entry, and cancelling or releasing a ticket with a reason. Cannot manage users, tariffs, locations or settings |
| Operator | One person on a gate | Entry, exit and payments with one login (the gate screens only: no reports, passes, wallets, corrections or settings). This is the role offered when adding gate staff; internally `GATE_OPERATOR` |
| Entry Operator (older) | Gate staff at entry | Register entries. No longer offered when adding a user; existing users keep it |
| Exit Operator (older) | Gate staff at exit | Process exits and collect payments; open and close shifts |
| Collection Operator (older) | Cashier | Collect payments and view reports |
| Viewer | Owner's representative, auditor | Read-only: reports and the live picture; changes nothing |
| Government Officer | Officer of a government body | Signs in on their own page, `/government/login`, and sees only the **totals and lists of vehicles that entered and left** for the locations the admin chose. Vehicle numbers, times, type, ticket and gate, but no money, and nothing else in the product |

A company admin can also create **custom roles** (Roles page): pick a base role (which decides rank and whether the person sees one location or all) and a list of permissions. Changes apply immediately. Nobody can hand out permissions they do not hold themselves. Operators whose role has only gate permissions are sent to the operator area; anyone with more gets the dashboard.

### Government officers

A company admin (or a location admin, for their own locations) adds an officer on the Users page: pick the role **Government Officer** and choose at least one location. The officer **does not use a seat** of the plan. Officers sign in at **/government/login** (company code, Login ID or email, password); the normal login page refuses them, and the Government page refuses everyone else. After signing in they see one page: the number of vehicles that entered, exited and are inside now; entries and exits by day, by vehicle type and by location; and the list of vehicles with their numbers and times, which can be searched and downloaded as Excel, CSV or PDF. Whatever address they type, they cannot open anything else, and the server enforces this on every request, not only the screen.

### Signing in: company code first

Every company has a **company code** (the company admin chooses it when registering: 4 to 12 letters or digits, checked as they type, and it cannot be changed later; shown on the dashboard, the Users page and My profile). **Everyone signs in with it**, admins included: the login page asks for the company code, a **Login ID or email**, and the password. The code is remembered on that computer. Because several companies use the platform, the same email or Login ID is never tried across companies: it is looked up inside the company whose code was typed. Without a code nobody can sign in, except the platform's own administrator, who has no company and uses an email alone.

A company admin or location admin gives staff a **Login ID** (Users page) so they do not need an email. A Login ID is unique inside the company; the same ID can exist in another company. A user can have both an email and a Login ID. A user with no email cannot use "Forgot password": the admin sets a new password (Edit user, "Reset password"). Wrong passwords lock the account for 15 minutes after ten tries.

### Lanes

## The Locations table

**Dashboard > Parking Locations** lists every location in one table: parking type, user licence (seats in use / allowed), valid upto with a Renew link to Billing, six gate switches you can tick right there (photo auto capture, print photo, exit amount edit, allow re-entry, print ticket number, print receipt for pass vehicles), auto exit, tariffs, capacity with an Update window, lanes, and Edit and Close. It has search, a records-per-page choice, **Download Excel** and **Print**. Each link opens that location on the right tab: Tariffs, Auto exit, Lanes. **Auto exit** sets, for each vehicle type, how many days a ticket may stay open before the system closes it and what the vehicle still owes; **Run now** applies it at once. No payment is recorded, so follow the amount up yourself. **Lanes:** the **Lanes** tab works like the Parking Lane page of ismartparking.com. On the left, **Create Parking Lane**: choose the vehicle (Lane Name: Bike, Car, Taxi ...), the Lane Type (Entry or Exit), FASTag (NO or YES; YES adds the FASTag Lane Code, Gate No., Floor No., Direction, Lane Type and Lane Mode) and the camera serial number. Each lane is one vehicle going one way, shown as `Car-Entry` or `Bike-Exit`, and gets its own Door/Lane No. and Reader number (the Edit button lets you change them). The list on the right shows, for every lane: Name/Type, Door/Lane No., FASTag, FASTag Lane Code, Reader, Operator, Camera Serial No. (ANPR), and a green **Active** / red **De-Active** button that switches the lane on or off (a lane that is off takes no entries, exits or manual barrier lifts and keeps its set-up). It can be searched, shown 10, 25, 50 or 100 at a time, and paged. A new location starts with a Bike-Entry, Bike-Exit, Car-Entry and Car-Exit lane; a location always needs an entry and an exit lane for 2-wheelers and for 4-wheelers (the tab tells you when one is missing). A lane takes only its own class of vehicle: a bike lane takes 2-wheelers, every other lane 4-wheelers, and the system refuses the other class at entry and at exit. A gate operator is tied to lanes on the **Users** page (tick the entry lane and the exit lane to work both); a lane has one operator, and a lane with none shows "No operator" and cannot be worked. The operator's entry and exit screens open on their own lane and offer only its vehicles. Editing a lane's vehicle or direction renames it, and its operator and devices follow. Locations set up before lanes existed keep their old gates until a lane is added on the Lanes tab.

On the Users page, after choosing the locations someone works at, you can tick the **lanes** (gates) they may use. Nothing ticked at a location means every lane there. A user with lanes only sees those lanes on the Entry and Exit screens, and the server refuses any other lane (entry, exit, open barrier). A lane that does not suit the direction (an exit lane on the entry screen) does not count.

### The Users page

**Dashboard > Users** is a table like the Users List of ismartparking: serial number, name, role, login ID, mobile, email, locations and lanes, and a status switch (Active or Inactive; a person is never deleted, so their tickets keep their name). It has search, filters by role and status, sorting, a records-per-page choice, **Download Excel** and **Print**. **Add user** and **Edit** open a form with the role, the locations, the lanes and four yes or no choices for the gate:
* *Reprint allowed*: No stops the person printing a ticket or receipt again (the print buttons disappear on the gate screens and the server refuses).
* *Show entry collection*, *Show exit collection*, *Show total collection*: No hides those figures from the person's Collection page and summary (the entry amount; the exit amount; and the cash, online, UPI, card, FASTag, wallet and total figures). This covers the operator Collection page and summary only; admin reports still show everything.

A new user starts with all four set to Yes. Not built: a separate "Create pass allowed" or "Pass approval" switch (operators have no pass-sale screen).

### User licences per location

The plan includes a number of users. On the Users page a company admin shares them out between locations ("User licences"): a location with a limit takes no more staff than that (company admins use no location's seat), the limits together cannot exceed the plan, and a limit cannot go below the staff already there. The card shows used and left seats and the date the licences run to (the end of the paid period, or of the trial); "Buy or renew users" goes to Billing. Deactivating a user frees a seat; switching them back on needs one. A location without a limit has no limit of its own.

## 3. Getting in

* **Register** is plan first: step 1 chooses the 14 day free trial or a paid plan (users and length, with the price worked out, like the calculator on the home page); step 2 takes the company, the **company code**, admin, mobile number, optional billing details (GSTIN, city, state) and password. A paid plan goes straight to the payment screen with the choice filled in. The price calculator's "Register and buy this plan" opens step 2 with the plan already chosen. Registering creates a company and its first admin. **Login**, **Forgot password** and **Reset password** work by email link (when email is switched on).
* Login attempts are rate-limited and a user who is locked out must wait. Changing your password or role ends your other sessions.
* **My profile**: edit name and mobile number, change password, and choose which alerts reach your email (urgent only, warnings and urgent, every alert, never).

## 4. The dashboard (back office)

**Overview.** Laid out like the ismartparking dashboard. A getting-started checklist for new companies and a **Renew** banner when the subscription is close to ending. A **date range** (From, To; starts on today, up to 92 days) next to the location picker sets the period of the day figures. Six cards: Total Parked (Current), Today's Total Revenue (Total Revenue for another period), **Locations Near Expiry** (locations whose plan ends within 30 days or has ended), Total Passes, **Current Active Passes Revenue** (what was paid for passes valid now) and Reprint Tickets Count. The **Vehicle Type Summary** (entries, exits, parked, cash, online, UPI QR, FASTag and total per vehicle type, with an **Action** link that opens that type's vehicles in Reports for the same dates; a Card column appears only when someone paid by card). **Over All (One Month)** tiles, with a red **Exit Parked Vehicle** tile for people who can correct tickets (admins and supervisors): it lists the vehicles inside, and Exit lets one out without payment after a reason of at least 5 characters (audited, same as "Exit without payment" on Vehicles Inside; it takes no money). Two full-day charts across 24 hourly slots, **Vehicle Momentum (Full Day Traffic Flow)** (entries and exits) and **Revenue Overview – Full Day**, then revenue for the last 7 days and vehicles inside through the day (today only). The **Individual Location Summary** lists each location with its type, plan status (Running, Expiring Soon with days left, Expired), expiry date, package and validity, and a **Renew** button for company admins. Also: alerts, payments, exceptions and activity per operator for the chosen period, and occupancy and collection per location. A **Trends** panel shows 7, 14, 30 or 90 days. Everything can be filtered to one location.

**Parking Locations.** Add and edit locations. Each location opens with tabs:
* *Details*: name, address, timing, capacity per vehicle type.
* *Slots*: the individual spaces and how many are free.
* *Tariffs*: the price rules (see section 7).
* *Gate rules*: switches for this location: allow re-entry, let the exit person change the amount (always with a reason, recorded and audited), close forgotten tickets after N hours (no payment is taken and admins are told), print the ticket number, print the photo, take the entry photo by itself, give a receipt to pass holders, and the email addresses that get this location's end-of-day report.
* *Re-entries and reprints* have no limits: no daily limit, no age window, no advance rule (an advance on the old ticket is given back). The only switches are the location's *Allow re-entry* and, per user, *Reprint allowed* (Yes / No). Every re-entry and reprint is counted for the operator who made it. The admin dashboard has a **Re-entry Count** tile and a **Reprint Tickets Count** tile (admins only; the tile also names the operator with the most). Click a tile to open the **Re-entries** or **Reprints** report for the same dates and location: a count per operator, then every one with the time, operator, vehicle and tickets, downloadable as CSV, Excel or PDF. Operators and supervisors never see these counts.
* *Online booking* (inside Details): fee per vehicle class, a **waiting time** (how long a booking is kept after the arrival time) and **customer can cancel until** N minutes before arrival (0 = no online cancelling).
* *Receipt*: header line, ticket and receipt footers, address and GST switches, QR on or off, with a live preview of the ticket and the receipt.

**Vehicles.** A register of vehicles (plate, type, owner, phone). Search by plate, see visit history, block a vehicle (blocked vehicles are flagged or refused at entry).

**Monthly Passes.** Tiles (active, ending soon, expired, suspended, sold this month) and tabs: *Passes* (filters, select many and extend, set dates, suspend, resume or cancel in one go), *Pass users* (everyone who holds a pass, grouped by mobile number), *Companies* (a company master you can attach passes to), *Vehicles* (every vehicle on a pass, with Excel/PDF) and *Receipts* (one per sale or renewal) and *Bulk upload* (sell up to 200 passes from a CSV file: download the template, fill it, upload; each row is a normal sale and fails alone with a reason). See section 8.

**Hardware.** Register devices, copy their keys, watch online/offline status, send test commands. See section 9.

**Reports.** Seventeen reports, each downloadable as CSV, Excel or PDF: revenue, collection, vehicle history, occupancy, operators, peak hours, occupancy trend, length of stay, payment methods, exceptions (cancelled entries, admin releases, lost tickets, failed online payments, vehicles inside over 24 hours), passes, hardware, repeat vehicles, a location comparison, and the **Operator collection** report (per operator: entries, reprints, exits, cash/UPI/card/online/FASTag, pass sales, the **system collection** and the **actual collection**, which adds the cash differences found when the operator's shifts were closed) plus a **Day summary**. The **FASTag & online** report lists every FASTag charge or online payment, including declined and pending ones, with accepted / in progress / declined tiles, a status filter and a day-by-day view. Collection by operator can be limited to one vehicle type. Reports can be filtered by entry or exit operator, and switched between **Current** (the last 90 days, set by `REPORT_CURRENT_DAYS`) and **Old** (before that). Location admins only see their own locations.

**Users.** Add staff, assign a role and the locations they work at, switch accounts off, reset passwords. You can only manage people ranked below you.

**Roles.** Create and edit custom roles (see section 2).

**Company.** Plan and subscription, and company details.

**Audit Log.** A record of important actions (who, what, when): passes sold, entries cancelled, barriers opened, roles changed, tags set and so on.

**Notifications.** In-app alerts for admins: pass expiry, payment problems, devices going offline, vehicles inside too long. Each is also emailed according to each person's preference.

**Website** (Super Admin only). Manage the public site's enquiries (leads), FAQ, blog posts and testimonials.

**Gate Operations** (menu link) opens the operator area. Admins do not see it: the gates are run by the operators an admin assigns on the Users page. Supervisors and custom roles that work a gate keep the link.

## 5. The operator area (gate screens)

Menu: Home, Vehicle Entry, Vehicle Exit, Entry List, Exit List, Vehicles Inside, Collection, Vehicle Search.

The header has **Bookings (n)** (every customer who booked ahead and has not arrived), **Theme** (colour, light or dark, compact menu; saved on this device), **My profile** and the current shift.

**Home.** A **From** and a **To** box (date and time) choose the period the figures cover; it opens on today, 00:00 to 23:59, and a *Today* button comes back to it. The plan and its valid-till date, the period's money (advances taken, exits, cash, online, UPI, card, FASTag, total) and counts of entries, exits, available and parked, for all vehicles and per vehicle type. Staff who cannot handle money see counts only.

**Vehicle Entry.** One screen in three panels: in the middle the camera, the plate box and the vehicle-type buttons (tapping a type creates the ticket); on the left the camera suggestions, the ticket that was just made and customer bookings; on the right **Entry History** with search, Print and Re-Entry. The lane strip on top shows LN, location, plaza, FASTag lane, the parking type, **Open barrier** and the **AUTO ENTRY** switch (hover it for what it does). There is no location or gate picker on the Entry and Exit screens: the operator works at the lane the company admin assigned (Users > lanes), and the strip shows which one. A person with no assigned lane starts on the location last used on that computer, or the first one. The camera panel says "Connecting to the camera… Attempt n of 5" and tries again by itself before offering **Try again**. The vehicle type chooses itself when the vehicle arrives: from the plate's earlier visits, else from the camera, else from the vehicle type set for that lane (Locations > Details > gates > "Vehicle type of this lane"). The line above the type buttons says where it came from, or asks the operator to check when the camera could not tell. After every ticket the buttons go back to the lane's type, so one vehicle's type never carries over to the next. On the screen:
* a live camera panel (start it once; it is remembered) and a plate box;
* large vehicle-type buttons that show how many spaces are free (Car, Bike, Taxi, Coach / Bus / Truck, Tempo / SUV / Mini bus). **Tapping a type creates the ticket** for the number in the box, as on ismartparking.com; the Enter key uses the highlighted type (the one the camera, the plate's history or the lane chose);
* *Capture & read plate* or *Auto-read* fill in the plate for you (the operator always checks it);
* *Auto entry* (off every time the page opens) creates the ticket by itself when a plate is read at 85% certainty or more with nothing to double-check and the ticket prints by itself: on the gate's thermal printer when the gate has one, otherwise the browser's print window opens for the new ticket (set the browser to print silently for a fully hands-free gate);
* *Read from photo* for a picture from a phone;
* the ticket (with a QR code) appears beside the form, ready to print;
* a plate that already has an open ticket opens **Vehicle Already Entered**: Re-Print (the ticket opens again), Re-Entry (cancel it and issue a new one), Exit (the Exit screen opens with that ticket looked up) and Close;
* a plate that holds a monthly pass shows the pass banner as soon as it is typed (not only after the ticket);
* the AUTO ENTRY and AUTO EXIT switches ask "Sure to enable / disable ...?" first;
* no payment at entry: the fee is worked out and paid at the exit (a customer's online booking fee paid in advance is still set against it);
* **customer bookings**: a booked plate shows who booked; *Use for entry* fills the form and marks the booking arrived;
* a pass banner when the vehicle holds a valid pass;
* suggestions from gate cameras and readers (plate, UHF pass tag, FASTag) with a tap to use or dismiss;
* **Open barrier** in the lane bar, to lift the barrier by hand (audited, limited per minute);
* a table of vehicles inside: search, reprint a ticket, **Re-Entry** (cancel and issue a new ticket), see the advance.

**Vehicle Exit.** The search box is on the left ("Type min 3 characters to search…"; clicking it lists the vehicles inside) and the camera panel sits above **Today's Exit** on the right. (If the location allows it, an *Edit amount* box lets the person change what is collected, with a reason; the change is recorded.)
* type any part of a vehicle number (3 characters or more) or a ticket or pass code, or scan the QR with the camera or a USB scanner, or tick *Ticket is lost*;
* the bill shows the vehicle, in time, out time, total time, the fee, any advance already paid and what is still due. For cash the *Amount received* box is selected at once: type what the customer paid (never less than the fee) and press **Enter** to exit. There is no change to give back: the amount received is what is recorded for the exit, on the payment and on the ticket, and the tariff amount is kept in the record as the original fee;
* payment by cash (with change to give back), UPI, card, FASTag (recorded, or really charged when a FASTag partner is set up: `docs/fastag.md`), or **online** (a QR payment link that confirms by itself);
* a pass closes the visit free; a grace period closes it free; an advance that covers the fee releases the vehicle and shows the change to return;
* *Auto exit* only looks the vehicle up, never takes money;
* while an online QR or a FASTag charge is waiting for the customer or the partner, **Cancel** is switched off: finish or release that payment first (the vehicle cannot be swapped for another one meanwhile);
* gate scanner commands: the QR beside **Exit** reads `{OK}` (confirms the exit when the amount is right) and the QR beside **Print bill** reads `{PRINT}`. A USB scanner types them like a keyboard, so no mouse is needed;
* after the exit the message names the payment mode (for example "Cash exit successful") and **Next vehicle** is already selected, so Enter moves to the next one;
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
4. **Release.** The session closes, the receipt is available, the barrier lifts, and an exit photo may be taken. The bill is not printed by itself: the operator presses *Print bill* when the customer wants it.
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
* **Company → GST on passes (%)** sets the GST share of a pass price; pass sales and receipts use it (a rate sent with a sale wins).
* Passes can belong to a **company** (a master list you keep under Passes → Companies); filter and report by company.
* Several passes can be extended, re-dated, suspended, resumed or cancelled together (up to 200). No money is taken that way: use Renew for a paid extension.
* "Receipts" are worked out from the pass payments (taxable value and tax split out; number `passNumber/n`). They are not a separate GST invoice series.

### Pass Management (the ismartparking-style desk)

Pass Management in the menu has five screens, all for people with the pass permission (admins and location admins; a location admin only sees users and passes of their own locations).

* **Pass Users**: number tiles, then the **Create Pass** form (new user with name, mobile, address, email, GST and company, or an existing user; one or more vehicle rows with type, location, valid from/to and charges; cash, UPI or card). Each vehicle becomes its own pass. The list has Vehicles, Passes, Edit and Delete buttons; Delete works only for a user with no passes. A user's **Passes** page re-dates a vehicle's pass (Create / Renew) and **Vehicles** adds or edits plates.
* **Company Master**: add, edit, switch off and delete companies (delete only when empty), with user and pass counts.
* **Pass Charges**: the price table for passes. For each location and vehicle type you set a **monthly** and a **daily** price. On the Create Pass form, as soon as the location, vehicle type and the validity dates are chosen, the charges fill in by themselves: every full calendar month at the monthly price plus each day left over at the daily price (1-10-2026 to 31-10-2026 = 1 month; 1-10-2026 to 10-12-2026 = 2 months + 10 days). A start on the last day of a month counts to the end of the month (31 Jan to 28 Feb = 1 month). The amount can still be typed over by hand (a discount, a free pass with 0); *Use table charges* puts the calculated amount back. With no price in the table for that location and vehicle, the form says so and links to the table. Renewals and re-dating of existing passes are not changed by the table.
* **Passes List**: filters (location, company, user, vehicle, type, status), tick boxes, **Update Pass** (new last day and charge; it does not take money), **Print Pass** (cards with QR codes), **Bulk upload** (CSV), Delete, and the **Approved / Pending** button on each row.
* **Vehicle List**: every vehicle of every pass user with its user, company and mobile.
* **Manage Invoice**: pick location, company (or no company and a user) and tick passes; a preview with an editable GST % and **Save Invoice**. Pass charges include GST, so the invoice splits the tax out of the total. Numbers start at 100001. An invoice can be printed.

Rules to know: a **Pending** pass gets no free exit (the vehicle pays like anyone else) and cannot be invoiced. **Delete** works only on an unused pass: never used at a gate, no money taken, not on an invoice; otherwise cancel it. Old passes are linked to pass users by their 10-digit mobile number (or name) the first time the screens open. Not built: a pass-user login/password (needs the mobile app), Excel (.xlsx) upload (CSV only), and partner/reseller views.

## 9. Hardware

Every device has its own key (`hwk_...`, shown once). A gate agent at the site connects outward over HTTPS; no router ports are opened.

| Device | What the software does | Honest limits |
|---|---|---|
| Boom barrier | Opens after a legitimate entry, paid or free exit, or admin release; retries safely; never twice for the same event | Needs a relay the agent can drive |
| Thermal printer | Prints tickets and bills; reprint button; test print | ESC/POS printers via shared name, network or command |
| ANPR camera | Posts a plate (and, if it can, the kind of vehicle); it becomes a suggestion with a confidence score, the plate fills the vehicle number box and the vehicle type chooses itself. An optional live picture address shows the camera's picture on the Entry and Exit screens; the operator can always type the number | A suggestion only (or AUTO ENTRY / EXIT when the operator switches it on and the reading is confident); accuracy with a real ANPR camera is not proven yet |
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
* **Refunds:** the screens have no refund button and the reports show no refund figures. The server still has a refund endpoint for location admins that no screen calls; an advance's extra is still given back at exit.
* **Collection by type and mode** and the reports always agree with each other.
* **Manage Subscriptions:** each location has its own subscription (users, length, add-ons) bought online with GST invoices, renewed, added to part-way, or cancelled. Add-ons (Pass, Photo, ANPR, FASTag, Payment Gateway, backups) unlock the matching features at that location; the Super Admin sets add-on prices. Gates keep working when a subscription lapses. See `docs/billing.md`.
* **My Orders:** one list of every order of the company (subscriptions, hardware shop, earlier plan orders) with filters, Excel and Print; each order opens its invoice or delivery page. See `docs/billing.md`.

## 11. Background work

* every 15 minutes: for locations with *close forgotten tickets after N hours* on, close tickets open longer than that (no payment; a notification tells admins);
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
* **Legal pages** `/privacy-policy`, `/terms-conditions` and a visitor sitemap `/sitemap`. The text is a **draft** written from what the software does and needs a lawyer's review. Company details come from `client/src/config/site.js` (`legalName`, `jurisdiction`, `email`, `phone`, `address`); empty values are hidden.
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
* Refund buttons for online booking fees (the app flags them and alerts an admin; the refund is made in the gateway). A customer can cancel their own booking online (when the location allows it) only while it is unpaid; a booking whose fee has been paid is final, and the public pages and the Terms say fees are not refundable.
* Bank settlement statements for FASTag and online payments. The *FASTag & online* report shows what our system recorded, with a day-by-day view of accepted money; it is not the bank's settlement report.
* Push alerts; a delivery log for emails and texts; holder self-unsubscribe; WhatsApp message templates (SMS and WhatsApp are built through Twilio but untested live).
* Logo printing and free-layout receipt design. The entry photo on a ticket shows on the screen/browser ticket, not on the thermal printer.
* "Old" reports are just older dates in the same database, not a separate archive.
* Tested against real hardware, real Razorpay, a real ANPR camera and real email delivery: so far only simulators and automated tests.
