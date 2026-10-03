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
| Company | A tenant | name, GST/tax, billingContact, address, subscriptionStatus, plan limits, onboarding flags |
| User | Login account | email (unique), password (hashed), role, companyId, locationIds, isActive, tokenVersion |
| Operator | Operator profile | userId, employeeCode, shift, lastActiveAt |
| Location | A parking site | name, address, coordinates, operatingHours, vehicleTypes, capacity, occupied, gates, zones |
| ParkingSlot | A single bay | code, zone, floor, type, status |
| Vehicle | A known vehicle | plateNumber (normalised), type, owner, phone, isBlocked |
| Tariff | Pricing rules | vehicleType, gracePeriodMinutes, slabs, minimum/max daily fee, tax |
| ParkingSession | One visit / ticket | ticketNumber, vehicleNumber, status, isOpen, entry/exit time, fee |
| Payment | Money collected | amount, method, status, transactionId, refund |
| AuditLog | Who did what | action, actor, entity, meta, ip |
| Shift | An operator's cash shift | operatorId, locationId, openingCash, adjustments, closingCash, expectedCash, difference |
| Lead | Enquiry from the website | name, email, phone, message, type, subject, status, notes |
| FAQ | Website question and answer | question, answer, category, order, isPublished |
| Blog | Website article | title, slug (unique), body (plain text), category, tags, isPublished, publishedAt, views |
| Notification | In-app alert for admins | type, severity, title, message, dedupeKey, readBy (removed after 90 days) |

Session statuses: `ACTIVE`, `PAYMENT_PENDING`, `COMPLETED`, `CANCELLED`,
`LOST_TICKET`, `PASS_EXIT`, `MANUAL_OVERRIDE`. `isOpen` is true for the first two.

## Indexes

| Collection | Index | Why |
|---|---|---|
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
| parkingsessions | `companyId, idempotencyKey` unique when set | Duplicate request protection |
| payments | `transactionId` unique when set | Gateway reference lookup |
| payments | `sessionId, createdAt` | Payments of a session |
| payments | `sessionId, status` unique where status is SUCCESS | A session is paid only once |
| payments | `companyId, locationId, status, paidAt` | Collection and revenue reports |
| payments | `companyId, collectedBy, paidAt` | Operator/shift reports |
| auditlogs | `companyId, createdAt` and `companyId, action, createdAt` | Audit views |

Mongoose builds these automatically when the server connects. For a large
production database, build indexes during deployment and set `autoIndex: false`.

Note for later days: `ParkingSession.isOpen` is updated automatically when a
session is saved with `.save()`. If you change `status` with an update query
instead, set `isOpen` in the same update.
