# Plan checkout, GST invoices, OTP signup, maps and daily report emails

## Buying a plan (Dashboard > Billing)

* Price: `server/config/pricing.js` (`PRICING`; same numbers as the website calculator in
  `client/src/data/site.js`). Parking Management is Rs 499 per user per month, 18% GST, tenure
  discounts of 0/5/10/20/30/40/45/50% for 1/3/6/12/24/36/48/60 months. The server recomputes the
  price; the browser's number is never trusted.
* A Company Admin picks users (1 to 500) and months and presses Pay. The server creates a
  `PlanOrder` and a payment link at the gateway. Money arrives through the same webhook as parking
  payments (`POST /api/payments/webhook`); `payments.settle` then `onlineBookings.settle` then
  `billing.settle` look for the transaction.
* On success the company becomes `ACTIVE`, `plan.maxUsers` = users bought, `plan.maxLocations` is at
  least 1000, and `subscription.currentPeriodStart/End` are set. Renewing while still active starts
  at the current end date; otherwise now.
* "Money is truth": a late, failed or cancelled order that is later paid still counts. A wrong
  amount never activates the plan; admins are alerted.
* After the period ends the company is marked `PAST_DUE` and admins are warned. Gates keep working
  (only `SUSPENDED` and `CANCELLED` block). Trial expiry is still not enforced.
* Adding users mid-period is not pro-rated: buy again; the new user count applies immediately.

## Manage Subscriptions (Dashboard > Manage Subscriptions)

A subscription belongs to one **location**: users, a length (1 to 60 months) and add-ons. The screens follow
ismartparking.com: a list of locations, a location page (Renew Now with a countdown, Running Subscriptions,
Order History), the new-subscription builder, Renew, "View & Add More Addons", the order page with the
receipt / GST invoice, and Cancel.

* **Prices:** users Rs 499 per month (`config/pricing.js`). Add-ons are in `server/config/addons.js`: Vehicle
  Pass Management 250, Vehicle Photo Capture 500, ANPR Camera Service 500 per camera, Fastag Parking Service
  500 per lane, Payment Gateway Service 300, Parking Data Backup 200 per month kept beyond the free first month,
  Vehicle Photo Backup 800 per month kept; all per month, before 18% GST. The Super Admin can change an add-on
  price under Platform > Subscription Prices (`AddonPrice` rows); an order keeps the price it was made at.
  There is no AI add-on.
* **A new subscription** is (users x user price + add-ons) x months, less the plan-length discount (the same
  table as above, taken off every item), plus GST. It starts when the location's running subscription ends,
  or now. The location's user licence is set to the users bought.
* **Renew** repeats the subscription for 1 to 60 months, from its end date (or from today once it has ended).
* **View & Add More Addons** adds users, turns on pass, photo or gateway, adds cameras or lanes, or keeps
  backups longer, for the rest of the period: new part x days left / 30, no plan-length discount. Nothing can be
  taken away in the middle of a period; a subscription that has ended or not started cannot be added to.
* **Cancel** needs a reason and does not refund. The trial or earlier company plan appears as a subscription
  with every add-on (`legacy`); it cannot be renewed, added to or cancelled. A subscription that was bought
  replaces the trial at its location.
* **Payment and invoice** use the same gateway, webhook, "money is truth" rules and GST invoice as above; the
  invoice lists the items with their taxable values. A paid subscription order sets the company `ACTIVE`.
* **What each add-on unlocks** (checked on the server, `subscriptionService.assertAddon`): selling, renewing
  passes (Pass); vehicle photos (Photo); adding ANPR camera or FASTag reader devices up to the number bought
  (ANPR, Fastag); taking a gateway payment and online booking fees (Gateway), and FASTag payments (Fastag).
  Backup months are recorded and priced; nothing deletes data on that basis yet.
* **When it lapses:** a location with no running subscription loses those features (a clear message points
  to Manage Subscriptions), including after the free trial ends. Gates keep working: entry, exit, cash, UPI and
  card payments are never blocked.
* Locations with no subscription of their own follow the company (trial or earlier plan) until the company buys
  its first subscription; after that a location added later needs its own.

Not built: partner code, Add to Cart, choosing the gateway, the Valet plan, an AI camera add-on. The backup
prices and the day-count for part-month charges are our own choices (ismartparking does not publish them).
The old Dashboard > Billing page and company-wide checkout remain for the website's "Buy this plan" flow.

## My Orders (Dashboard > My Orders)

"Orders History List", like ismartparking.com: one table of every order of the company, newest first, with Show N
entries, search by order number, a Payment Status filter (we add a Type filter), Download Excel (a CSV that opens
in Excel; it holds every matching row) and Print (the rows on the page). Columns: SN, Date, Order Number, Type,
Invoice, Details, Items, Quantity, Amount, Payment Status. A paid order shows a **View** button (it opens the
order with the invoice); an order that is waiting for payment shows **Pending**.

* It lists subscription orders of all locations, hardware shop orders and the earlier company-wide plan orders
  (those open the old Billing page). Orders that were never paid are listed too (ismartparking hides them), so the
  Pending, Failed and Cancelled filters have something to show. There is no Refunded filter or credit note because
  there is no refund flow for subscription orders yet.
* The order page (`/dashboard/subscriptions/orders/:id`) follows theirs: order number, status, payment, date and
  source, invoice number and date, the subscription detail table (order id, item, quantity, months, price, discount,
  taxable amount, taxes, tax amount, total), the payment transaction and order ids, the Receipt / Invoice window
  (print or PDF), and the customer, billing and shipping blocks. Back returns to My Orders when you came from it.

## GST invoices

* One `Invoice` per paid order, numbered `SP/26-27/00001` (financial year April to March).
* Buyer in the seller's state: CGST + SGST (half each, SGST takes the odd paisa). Other state: IGST.
  State comes from the first two digits of the buyer GSTIN, else the buyer state name.
* PDF at `GET /api/billing/invoices/:id/pdf`; also emailed to the billing contact and admin when an
  email provider is set (`EMAIL_PROVIDER=resend`).
* Seller details come from `SELLER_*` in `server/.env`. Nothing is invented: with empty values the
  Billing page says it is not ready.

## Mobile-OTP signup

* `SIGNUP_OTP=on` makes `/register` require a phone proof. `GET /auth/signup-options` tells the page.
* `POST /auth/otp/send {phone}` sends a 6-digit code (Twilio, `MESSAGING_PROVIDER`); `POST /auth/otp/verify {phone, code}`
  returns a short-lived `phoneToken`, sent as `phoneToken` to `/auth/register`.
* Codes expire, are stored hashed in `Otp`, allow 5 wrong tries and a per-phone/IP rate limit.
* India: SMS needs DLT registration of sender and template (Twilio explains how).

## Location picker (Google Maps)

* Needs `VITE_GOOGLE_MAPS_KEY` in `client/.env` (enable Maps JavaScript API, Geocoding API and Maps
  Embed API; restrict the key by website address). Without a key the form falls back to typing
  latitude and longitude, and nothing breaks.
* Optional `VITE_GOOGLE_MAPS_MAP_ID` (a Map ID from Google Cloud; defaults to `DEMO_MAP_ID`).
* Coordinates are stored on the Location (`coordinates {lat,lng}`). `PUT /locations/:id` with
  `coordinates: {clear: true}` removes them. Public booking pages show a map and a directions link.

## End-of-day report email

* Dashboard > Company > Report email: on/off, up to 10 recipients, send time (default 22:00 local).
* A job runs every 5 minutes (`watchReports`) and sends each due company one email with the day's
  entries, exits, collection by mode, pass sales and open tickets; `lastSentFor` stops repeats.
* "Send test" sends today so far to the person who pressed it.
* Needs an email provider; otherwise the setting is kept and the page says nothing will be sent.

## Tests

* Unit: `node --test tests/billing.test.js` (pricing, GST split, numbers in words, invoice PDF).
* Integration (need MongoDB): `billing.integration.test.js`, `otp.integration.test.js`,
  `phase2.integration.test.js`; all are in `npm test`.
