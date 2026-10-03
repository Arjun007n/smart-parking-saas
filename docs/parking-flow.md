# Parking flow: entry to receipt

```
Entry  ->  Ticket / session (ACTIVE)  ->  Exit lookup + fee  ->  Payment  ->  Receipt
                                              |                     |
                                   nothing to pay: closed     session closed,
                                                              space freed
```

## Entry (`POST /api/parking/entry`)

Checked, in this order:

1. The location is open and the operator is assigned to it.
2. A repeated request (same `idempotencyKey`) returns the first ticket.
3. The location accepts this vehicle type; the gate, if given, is an entry gate.
4. The vehicle number is valid and the vehicle is not blocked.
5. The vehicle is not already inside any location of the company.
6. A space is free. The space is taken in one database update, so two gates
   cannot both take the last space.

Then the session and ticket are created. If that fails, the space is given back.
A vehicle seen for the first time is added to Vehicles automatically.

## Ticket numbers

`T-260302-K7QXMP`: the entry date (local time) and 6 random characters,
without look-alikes such as 0/O and 1/I. Operators can type it in any case,
with or without dashes. The same text is what a QR code should contain.

## Session statuses

| Status | Meaning | Vehicle inside? |
|---|---|---|
| ACTIVE | Parked | yes |
| PAYMENT_PENDING | Fee calculated, waiting for payment | yes |
| COMPLETED | Exited (paid, or nothing to pay) | no |
| LOST_TICKET | Exited and paid, ticket was lost | no |
| PASS_EXIT | Exited on a pass (passes are Phase 2) | no |
| CANCELLED | Entry made by mistake, cancelled by an admin | no |
| MANUAL_OVERRIDE | Let out by an admin without the normal payment | no |

The last five are final and never change. Allowed moves are defined in
`server/services/sessionService.js`.

## Exit (`POST /api/parking/exit`)

1. Find the session by ticket number, or by vehicle number. Refused when: no
   such ticket, ticket from another location, vehicle already exited, or the
   vehicle number does not match the ticket.
2. Pick the tariff that applied at entry time and calculate the fee
   (see [tariffs.md](tariffs.md)).
3. If the total is zero (grace period, free tariff), the session is closed.
4. Otherwise it becomes PAYMENT_PENDING and the fee is returned.

Calling exit again recalculates the fee for the current time. A calculated fee
is accepted for payment for 15 minutes.

Lost ticket: send `lostTicket: true` with the vehicle number. The tariff's
lost-ticket penalty is added and the session closes as LOST_TICKET.

## Payment (`POST /api/payments`)

- The amount is the server's calculated fee. The client sends the amount it
  showed; if they differ, the payment is refused.
- **Cash, UPI, card:** the operator confirms the money was received, so the
  payment is SUCCESS immediately, the session closes and the space is freed.
- **Online gateway:** the payment starts as PENDING. The session closes only
  when the gateway's webhook arrives with a valid signature.
- A session can have only one successful payment (enforced by the database).
- Closing a session is a single guarded update, so a double exit or double
  payment cannot free a space twice.

## Corrections (admins only, always audited, reason required)

- **Cancel entry:** for a ticket created by mistake. Only while ACTIVE.
- **Exit without payment:** closes the session as MANUAL_OVERRIDE.

## Not done by a database transaction

Entry and payment each change two documents (location occupancy and session).
They use guarded single-document updates with a compensating step rather than
a multi-document transaction, so the app also runs on a standalone MongoDB.
Occupancy can be recomputed from open sessions if it ever drifts; a
reconciliation job is a sensible addition for Day 29.
