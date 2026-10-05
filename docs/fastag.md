# FASTag fee collection

## What this is, and what it is not

At the exit the operator can charge the parking fee to the FASTag on the windscreen. The software
side is built and tested against a **simulated partner**. Charging a real tag also needs a bank or
NETC (NPCI) acquirer that has signed an agreement with you. They give you credentials and an API.
**Without that agreement nothing can be charged to a real tag**, and no code on our side changes that.

Until a partner is set up (`FASTAG_PROVIDER=none`, the default) FASTag is only a payment mode the
operator records, exactly as before: the money is collected some other way and marked FASTag.

## Switching it on

| Setting | Meaning |
|---|---|
| `FASTAG_PROVIDER` | `none` (default), `simulated` (try the screens; refused in production), or `http` |
| `FASTAG_API_URL` | The partner's address for the `http` provider |
| `FASTAG_API_KEY` | Sent as `Authorization: Bearer <key>` |
| `FASTAG_TIMEOUT_MS` | How long to wait for the partner (1000 to 30000, default 8000) |

A mistyped provider name, or `http` without a URL and key, stops the server at start.

While a provider is on, choosing **FASTag** at the exit **always charges the tag**: the operator
enters (or confirms) the tag number and presses *Charge FASTag and exit*. Recording a FASTag
payment without charging is no longer possible, so money cannot quietly go uncollected.
FASTag readers still suggest the vehicle, and the tag number they read fills the box.

## Trying it

Set `FASTAG_PROVIDER=simulated`, restart the server and open the exit screen. Tag numbers decide what
the pretend partner says: ending in **F** is declined, ending in **U** is "not confirmed yet" for about
5 seconds (`FASTAG_SIM_DELAY_MS`) and succeeds when you check again after that, anything else succeeds.

## What the operator sees

* **Charged:** the vehicle is released like any other payment. The receipt shows FASTag.
* **Declined:** nothing was taken and the vehicle stays. Try another tag or another mode (cash, UPI...).
* **Not confirmed yet** (the partner did not answer in time): the button changes to *Check FASTag
  charge again*. Press it after a moment. Nothing is charged twice, however often it is pressed.
  While the answer is unknown no other payment mode is accepted for that vehicle, because the tag
  may in fact have been charged.

## The partner contract (`http` provider)

All amounts are in rupees. `reference` is our id for the attempt and is the **idempotency key**: the
partner must never charge twice for the same reference.

```
POST {FASTAG_API_URL}/charges
  { "reference": "FT-...", "tagId": "34161FA820", "vehicleNumber": "KA01AB1234",
    "amount": 40, "description": "Parking T-000123" }
  -> 200 { "status": "SUCCESS", "providerReference": "BANK-123" }
  -> 200 { "status": "FAILED",  "reason": "Insufficient balance" }
  -> 200 { "status": "PENDING" }

GET {FASTAG_API_URL}/charges/{reference}
  -> 200 same body as above
  -> 404 when the partner never saw that reference
```

How answers are read, deliberately cautiously:

* `SUCCESS` counts only with a `providerReference` (needed to reconcile and reverse later). Without
  one it is treated as not confirmed.
* A 4xx on the charge (except 408 and 429) is a decline. Anything else that is not a clean answer (timeout, 5xx, `PENDING`) is "not confirmed", never a failure.
* `404` on the status call means the charge never happened, and is believed only 90 seconds after the
  attempt began, so a call that is still in flight is never mistaken for a failed one.

Most acquirers have their own API shape. Put a small adapter in front of theirs that speaks this
contract, or add a provider file next to `server/integrations/fastag/index.js`.

## Safety rules the code keeps

* **The fee is frozen while a charge is open.** Looking the vehicle up again (or "Recalculate fee")
  returns the same fee and the pending charge instead of working the fee out anew, and a charged
  tag is finished even after the usual 15-minute fee window. The screen reopens on FASTag with the
  tag filled in.
* **Nothing else is taken meanwhile.** While a charge is unconfirmed or charged-but-not-finished,
  cash, UPI, card, wallet and online payment are all refused for that vehicle, and another tag
  number is refused (the first tag may have been charged). FASTag is refused too while an online
  payment link is still open.
* **A background check every minute** asks the partner about charges that were never confirmed
  (older than 90 seconds). If one turns out charged and the vehicle has already left without it,
  it is flagged (`needsReview`) and an admin gets a critical alert.
* **An admin override or a cancelled entry** is still allowed (the partner may be down), but a charge
  that has no payment is flagged and the override answer carries a warning to reconcile it.

* The attempt (`FastagCharge`) is saved **before** the partner is called, so a crash can't leave
  money taken with no trace.
* One active attempt per vehicle (a database rule). A declined attempt frees the vehicle.
* A charge that succeeded always becomes exactly one payment (reference `FASTAG:<partner reference>`),
  even if the first request died half way: asking again finishes the exit.
* If the fee changed (a recalculation after a longer stay) after the tag was charged, no payment is
  made. The attempt is flagged for review, an audit entry `FASTAG_AMOUNT_MISMATCH` is written and the
  operator is told to call the admin with the partner reference.
* Audit entries: `FASTAG_CHARGED`, `FASTAG_DECLINED`, `FASTAG_AMOUNT_MISMATCH`, `FASTAG_CHARGE_ON_CLOSED_SESSION`, `FASTAG_CHARGED_BUT_PAID_ELSEWHERE`.
* A charged FASTag **cannot be refunded from this software**. Ask the partner to reverse it. (A FASTag
  that was only recorded can still be refunded as before.)

## Known limits

* A vehicle stuck on "not confirmed" because the partner is down can be released by an admin with the
  manual override exit; reconcile with the partner afterwards. There is no screen yet that lists
  unsettled or flagged charges (the `fastagcharges` collection has them: `status` UNKNOWN or `needsReview` true).
* Cancelling an entry or overriding an exit does not reverse a FASTag charge; it only flags it.
* Do not switch `FASTAG_PROVIDER` off while charges are open: those vehicles then refuse every payment mode until an admin overrides them.
* The tag-to-vehicle check is the partner's job. We send the vehicle number with the tag.
* No automatic toll-lane charging; this is the manual exit-counter flow only.
* The `http` provider was written from the contract above and tested against a local test server,
  never against a real acquirer. Run it against the partner's test environment first.
