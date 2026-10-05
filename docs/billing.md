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
