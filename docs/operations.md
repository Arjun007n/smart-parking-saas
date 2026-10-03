# Dashboard, collection, reports, audit and notifications

## Dashboard

`GET /api/dashboard` returns, for the locations the user may see:

| Area | Figures |
|---|---|
| Occupancy | Capacity, occupied, available, reserved slots, utilization % |
| Traffic | Entries and exits today, vehicles inside now, entries/exits per hour |
| Revenue | Today, last 7 days, this month, by payment method |
| Operations | Per operator: entries, exits, payments, amount collected |
| Exceptions | Exits without payment, cancelled entries, lost tickets, failed online payments, vehicles waiting over 30 minutes for payment |
| Alerts | Capacity at 90% or full, failed payments, long-pending payments, trial ending or subscription overdue |
| Locations | Occupancy, entries and collection per location |

The web dashboard reloads these figures every 20 seconds.

**Revenue** everywhere means: payments counted on the day they were paid,
minus refunds counted on the day they were refunded.

## Collection and shifts

1. The operator starts a shift and enters the cash already in the drawer.
2. Payments they take at that location are counted in the shift.
3. At the end they count the drawer and enter the amount.
4. The system compares it with what it expected:

```
expected cash = opening cash + cash collected - cash refunds + adjustments
difference    = counted cash - expected cash     (negative = short)
```

- UPI, card and online payments are listed in the shift but are not part of
  the drawer.
- A shift's totals are frozen when it closes.
- A difference raises a notification for the admins.
- **Refund** (admins): gives the full amount of a cash, UPI or card payment
  back, with a reason. A cash refund is taken from the shift that collected
  the payment if it is still open, otherwise from the refunding admin's open
  shift.
- **Adjustment** (admins): records cash added to or removed from an open
  shift's drawer, with a reason.
- Shifts are optional. Payments taken with no open shift are still recorded
  and appear in the day's collection, just not in any shift.

## Reports

Revenue, Collection, Vehicle history, Occupancy and Operators, each with date,
location and (where it applies) operator filters. Every report downloads as
CSV with the same filters. Text that a spreadsheet would treat as a formula is
neutralised in the file.

The occupancy report counts, for each hour, the vehicles that were inside at
any moment of that hour.

## Audit log

Recorded actions include: login, failed login, logout, password reset; user,
company, location, tariff, slot and vehicle changes; entry, exit, cancelled
entry, exit without payment; payment, refund; shift open, close, adjustment.

Entries are append-only: the model refuses updates and deletes, and the API
has no route to change them. Company admins can read and export them.

## Notifications

| Alert | When | Who sees it |
|---|---|---|
| Capacity | A vehicle type reaches 90% or 100% at a location (once per hour per level) | Admins of that location |
| Payment failed | The gateway reports a failed online payment | Admins of that location |
| Cash difference | A shift closes with counted cash different from expected | Admins of that location |
| Subscription | Trial ends within 7 days, or payment overdue (once per day) | All admins of the company |
| Hardware offline | Defined, but not raised until hardware is connected | - |

Notifications are kept for 90 days. Each admin has their own read/unread state.

## Real-time events

Controllers publish these events on an in-process bus
(`server/services/eventBus.js`): `parking:entry-created`,
`parking:exit-completed`, `parking:occupancy-updated`, `payment:received`,
`payment:failed`, `notification:new`. Each carries `companyId` and
`locationId`, and `rooms()` gives the tenant and location room names, so a
Socket.IO layer can forward them without leaking one site's events to
another. That layer is not built yet.
