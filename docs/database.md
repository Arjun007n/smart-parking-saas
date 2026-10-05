# Database design

MongoDB with Mongoose. Models are in `server/models/`.

## Relationship map

```
Company (tenant)
 ├── User            companyId, locationIds[]      (Super Admin has no company)
 │    └── Operator   userId                        (shift/activity profile)
 ├── Location        companyId
 │    ├── ParkingSlot     locationId
 │    ├── Tariff          locationId, vehicleType
 │    └── ParkingSession  locationId, vehicleId, tariffId, entry/exit operator
 │         └── Payment    sessionId, collectedBy
 ├── Vehicle         companyId, plateNumber
 └── AuditLog        companyId, actorId            (append-only)
```

Every tenant-owned collection carries `companyId`. Records that belong to a
parking site also carry `locationId`.

## Collections

| Model | Purpose | Key fields |
|---|---|---|
| Company | A tenant (also `subscription` {period start/end, users, months}, `reportEmail` {enabled, recipients, sendAtMinutes}) | name, GST/tax, billingContact, address, subscriptionStatus, plan limits, onboarding flags |
| User | Login account (`phoneVerified` after OTP signup) | email (unique), password (hashed), role, companyId, locationIds, isActive, emailAlerts (OFF, CRITICAL default, IMPORTANT, ALL), tokenVersion |
| PlanOrder | A plan purchase | companyId, users, months, price breakup, status (PENDING, PAID, FAILED, CANCELLED), transactionId, payUrl |
| Invoice | GST invoice for a paid plan order (`kind` PLAN) or shop order (`kind` SHOP) | number (SP/26-27/00001, one series for both), seller and buyer snapshot, `lines` and `shipTo` (shop), taxable value, CGST/SGST or IGST, total |
| Wallet | A prepaid parking card of a company's customer | companyId, number (W-XXXXXXXX), holderName, phone, vehicles (max 5, one wallet per vehicle), status (ACTIVE, BLOCKED), balancePaise (whole paise), lowBalanceAlert |
| WalletTxn | The ledger of a wallet, never edited | walletId, type (TOPUP, DEBIT, REFUND, REVERSAL, ADJUST), deltaPaise (+/-), balanceAfterPaise, method, reference, locationId, shiftId, sessionId, paymentId, by, idempotencyKey (unique) |
| FastagCharge | One attempt to charge a FASTag for a parking fee | sessionId, tagId, amount, status (PENDING, UNKNOWN, SUCCESS, FAILED), active, providerReference, paymentId, needsReview |
| Product | A hardware shop item | name, category, price (null = ask us), gstPercent, hsn, stock (null = made to order), maxPerOrder, isActive |
| ShopOrder | A hardware order | number (HW/26-27/0001), lines (prices copied), goods, shipping, gst, total, shipTo, payment status, fulfilment (NONE, PROCESSING, SHIPPED, DELIVERED, CANCELLED), courier, tracking, history |
| Otp | Signup code | phone, hashed code, attempts, expiresAt (auto-deleted) |
| Operator | Operator profile | userId, employeeCode, shift, lastActiveAt |
| Location | A parking site | name, address, coordinates, operatingHours, vehicleTypes, capacity, occupied, gates, zones |
| ParkingSlot | A single bay | code, zone, floor, type, status |
| Vehicle | A known vehicle | plateNumber (normalised), type, owner, phone, isBlocked |
| Tariff | Pricing rules | vehicleType, gracePeriodMinutes, slabs, minimum/max daily fee, tax |
| ParkingSession | One visit / ticket | ticketNumber, vehicleNumber, status, isOpen, entry/exit time, fee (incl. advanceApplied, due), advance (taken at entry), photos (up to 6; the picture files live on disk) |
| Payment | Money collected | amount, kind (FEE or ADVANCE), method, status, transactionId, refund; for online payments also provider, payUrl, expiresAt, gatewayPaymentId |
| Pass | A daily, weekly or monthly pass for one or more vehicles | passNumber, passType, vehicles[], maxVehicles, vehicleChanges[], vehicleNumber (mirrors the first vehicle), holderName, startDate/endDate, locationIds, status, isCurrent |
| Booking | A customer who booked ahead | vehicleNumber, vehicleType, expectedAt, status (AWAITING_PAYMENT, BOOKED, ARRIVED, CANCELLED, EXPIRED), customerName, phone, sessionId, source (STAFF or ONLINE), amount, payment (state, transactionId, provider, gateway ids, payUrl, expiresAt, paidAt, appliedToSessionId), accessHash (hash of the customer's secret link; never returned) |
| PassPayment | Money taken for a pass or its renewal | passId, amount, method (incl. COMPLIMENTARY), locationId, collectedBy |
| Role | A company's custom role | companyId, name, baseRole, permissions (users reference it with `customRoleId`) |
| AuditLog | Who did what | action, actor, entity, meta, ip |
| Shift | An operator's cash shift | operatorId, locationId, openingCash, adjustments, closingCash, expectedCash, difference |
| Lead | Enquiry from the website | name, email, phone, message, type, subject, status, notes |
| FAQ | Website question and answer | question, answer, category, order, isPublished |
| Testimonial | Customer quote shown on the home page | quote, name, role, company, order, isPublished |
| Blog | Website article | title, slug (unique), body (plain text), category, tags, isPublished, publishedAt, views |
| Notification | In-app alert for admins | type, severity, title, message, dedupeKey, readBy (removed after 90 days) |
| Hardware | A camera, barrier controller or printer at a location | type, gate, direction, keyHash (never returned), isOnline, lastSeenAt, config |
| HardwareCommand | An instruction for one device (open barrier, print) | type, payload, status, attempts, expiresAt, idempotencyKey (removed after 30 days) |
| HardwareEvent | Device came online/offline, command failed, device error | type, severity, message (removed after 60 days) |
| AnprDetection | A plate seen by a camera, waiting for an operator | plate, plateRaw, confidence, status, needsReview, hits, source (CAMERA or PHOTO), hardwareId (cameras only), readBy (photo reads) (removed after 60 days) |

Session statuses: `ACTIVE`, `PAYMENT_PENDING`, `COMPLETED`, `CANCELLED`,
`LOST_TICKET`, `PASS_EXIT`, `MANUAL_OVERRIDE`. `isOpen` is true for the first two.

## Indexes

| Collection | Index | Why |
|---|---|---|
| fastagcharges | `sessionId` unique where `active` | One live FASTag attempt per vehicle |
| wallets | `number` unique; `companyId, vehicles` unique (only when it has vehicles) | One wallet per vehicle |
| wallettxns | `idempotencyKey` unique (when set); `walletId, createdAt`; `shiftId, type` | A repeated request changes nothing; ledger and shift totals |
| users | `email` unique | Login |
| users | `companyId, role, isActive` | Team lists, plan limits |
| users | `companyId, locationIds` | Users of a location |
| companies | `subscriptionStatus, trialEndsAt` | Expiry checks |
| locations | `companyId, name` unique | No duplicate names in a company |
| locations | `companyId, isActive` | Lists, plan limits |
| parkingslots | `locationId, code` unique | One bay code per location |
| parkingslots | `companyId, locationId, status` | Free/occupied lookups |
| vehicles | `companyId, plateNumber` unique | Search by vehicle number |
| tariffs | `companyId, locationId, vehicleType, isActive` | Find the tariff at exit |
| parkingsessions | `ticketNumber` unique | Ticket lookup |
| parkingsessions | `locationId, vehicleNumber` unique where `isOpen` | One open session per vehicle |
| parkingsessions | `companyId, locationId, status` | Dashboard, current vehicles |
| parkingsessions | `companyId, entryTime` / `companyId, exitTime` | Reports |
| parkingsessions | `companyId, locationId, entryTime` / `companyId, locationId, exitTime` | Reports for one location or a few |
| parkingsessions | `companyId, idempotencyKey` unique when set | Duplicate request protection |
| payments | `transactionId` unique when set | Gateway reference lookup |
| payments | `sessionId, createdAt` | Payments of a session |
| bookings | `locationId, vehicleNumber` unique where status is BOOKED | One waiting booking per vehicle |
| bookings | `payment.transactionId` unique where set | A gateway payment belongs to one booking |
| payments | `sessionId, kind, status` unique where status is SUCCESS | A session has one paid fee and one advance (replaces `one_success_per_session`) |
| payments | `companyId, locationId, status, paidAt` | Collection and revenue reports |
| payments | `companyId, collectedBy, paidAt` | Operator/shift reports |
| passes | `passNumber` unique; `companyId, vehicleNumber` and `companyId, vehicles.number` unique where `isCurrent` | One current pass per vehicle (main or extra) |
| roles | `companyId, nameKey` unique | Role names are unique in a company, ignoring case |
| users | `customRoleId` sparse | Who holds a role |
| auditlogs | `companyId, createdAt` and `companyId, action, createdAt` | Audit views |

Mongoose builds these automatically when the server connects. For a large
production database, build indexes during deployment and set `autoIndex: false`.

Note for later days: `ParkingSession.isOpen` is updated automatically when a
session is saved with `.save()`. If you change `status` with an update query
instead, set `isOpen` in the same update.
