# Tariffs and fee calculation

The fee engine is `server/services/tariffService.js`. It has no database
access, so every rule is covered by `server/tests/tariff.test.js`.
The web and mobile apps never calculate fees; they ask the API.

## How a fee is calculated

1. **Duration** is exit minus entry, rounded up to whole minutes.
2. **Pass**: a valid pass pays nothing.
3. **Grace period**: a stay within the grace period is free. One minute past
   it, the whole stay is charged.
4. **Slabs**: each slab is the *total* fee for a stay up to that many minutes.
   Past the last slab, every started hour adds the hourly rate. Two special
   cases come first: a **flat fee** (events) is charged once for the whole
   stay, and a **long stay** (airports) charges a daily rate for every started
   24 hours once the stay is longer than the set number of minutes.
5. **Daily cap**: `maxDailyFee` limits the fee for each 24 hours of the stay.
6. **Minimum fee**: the least a chargeable stay pays.
7. **Overnight charge**: added once per midnight crossed (local time), on top
   of the daily cap.
8. **Lost ticket**: the penalty is added to the parking fee, and the grace
   period does not apply.
9. **Discount** is taken off, then **tax** is added, or extracted when the
   tariff's prices already include tax.

Amounts are rounded to 2 decimals.

## Example

Tariff: 10 min grace; up to 60 min ₹20; up to 180 min ₹50; then ₹20 per hour;
max ₹100 per 24 hours; 18% tax included.

| Stay | Fee |
|---|---|
| 8 minutes | ₹0 (grace) |
| 45 minutes | ₹20 |
| 2 hours | ₹50 (of which ₹7.63 tax) |
| 4 hours | ₹70 |
| 12 hours | ₹100 (capped) |
| 24 hours 30 minutes | ₹120 |

## Which tariff is used

For a location and vehicle type, among active tariffs valid at the entry time:
a tariff limited to certain weekdays or dates wins over a general one; between
equals, the newest wins. So a "weekend" tariff overrides the standard one on
Saturday and Sunday only.

## Event and airport tariffs

Each tariff has a **kind**: Everyday, Event or Airport. Create them in
Locations > Tariffs.

* **Event** (match, concert, festival): give it a name and the first and last
  day, and optionally a flat fee for the whole stay and an entry-time window
  (for example 17:00 to 23:00). The grace period, lost-ticket penalty, minimum
  fee and tax still apply. The first and last day are in the browser's local
  time of whoever saves the tariff.
* **Airport**: set "long stay starts after" (minutes) and a rate per 24 hours.
  A stay longer than that pays the daily rate for every started day instead of
  slabs and the hourly rate (for example up to 8 hours by the hour, then 500
  per day). A short pick-up and drop-off is free by using the grace period.
* **Entry-time window**: "HH:MM" start and end, checked against the entry time.
  It may cross midnight (22:00 to 06:00). Set both or neither.
* The tariff is chosen **when the vehicle enters**; a visit that starts during
  an event is charged by the event tariff for its whole stay.

The order of preference is: higher *priority* number (normally 0), then an
Event tariff, then a tariff limited to days, dates or a time window, then the
newest. So a match-day tariff beats the weekend tariff on the same Saturday.

## Local time

Midnights and weekdays use the offset in `APP_UTC_OFFSET_MINUTES`
(default 330, India). All sites share it for now; a per-location time zone
can be added when sites in other time zones are onboarded.

## Decisions worth confirming with the business

- Lost ticket is a penalty **added** to the fee (not a flat replacement).
- The overnight charge is **not** limited by the daily cap.
- A long-stay rate replaces the normal rates once the threshold is passed; it
  is not automatically the cheaper of the two, so set the threshold with care.
- A flat event fee ignores the daily cap (it is already one fee per stay).
- Monthly passes are not built yet (Phase 2). The engine already accepts
  `hasValidPass`.
