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
   Past the last slab, every started hour adds the hourly rate.
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

## Local time

Midnights and weekdays use the offset in `APP_UTC_OFFSET_MINUTES`
(default 330, India). All sites share it for now; a per-location time zone
can be added when sites in other time zones are onboarded.

## Decisions worth confirming with the business

- Lost ticket is a penalty **added** to the fee (not a flat replacement).
- The overnight charge is **not** limited by the daily cap.
- Holiday/event pricing is done with a dated tariff (`validFrom`/`validTo`),
  which the API supports; the web form does not have date fields yet.
- Monthly passes are not built yet (Phase 2). The engine already accepts
  `hasValidPass`.
