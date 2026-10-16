const AppError = require("../utils/AppError");
const audit = require("../services/auditService");
const { parsePlate, normalizePlate, escapeRegex } = require("../utils/plate");
const { dayRange } = require("../utils/time");
const { locationScopedFilter, getAccessibleLocation, locationIdFromQuery } = require("../utils/scope");
const { calculateFee } = require("../services/tariffService");
const { findTariffFor } = require("../services/tariffLookup");
const sessions = require("../services/sessionService");
const { publish, EVENTS } = require("../services/eventBus");
const { notifyCapacity } = require("../services/notificationService");
const { buildReceipt } = require("../services/receiptService");
const hardware = require("../services/hardwareService");
const lanes = require("../services/laneService");
const anpr = require("../services/anprService");
const passes = require("../services/passService");
const advances = require("../services/advanceService");
const fastagService = require("../services/fastagService");
const wallets = require("../services/walletService");
const bookingService = require("../services/bookingService");
const onlineBookings = require("../services/onlineBookingService");
const { PERMISSIONS: P } = require("../config/permissions");
const { can } = require("../middleware/permission");
const ParkingSession = require("../models/ParkingSession");
const Vehicle = require("../models/Vehicle");
const messageService = require("../services/messageService");
const { resolveOperations, editedFee } = require("../utils/operations");
const { lowersFee, reEntryNeedsSupervisor, reEntryGraceMinutes } = require("../utils/feeRules");
const Location = require("../models/Location");

const PAGE_SIZE = 50;
const pageFrom = (req) => Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

// ---------------------------------------------------------------- entry ----

// Finds the vehicle or adds it on its first visit, and notes where it was
// last seen. Two requests adding the same new vehicle at the same moment can
// collide; the one that loses simply reads the record the other one made.
const rememberVehicle = async (companyId, plateNumber, type, locationId) => {
  const filter = { companyId, plateNumber };
  const update = { $set: { lastLocationId: locationId }, $setOnInsert: { type } };
  try {
    return await Vehicle.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after" });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Vehicle.findOneAndUpdate(filter, { $set: update.$set }, { returnDocument: "after" });
  }
};

// The 409 for a vehicle that already has an open ticket. It carries that ticket so the entry screen can offer
// Re-Print, Re-Entry or Exit ("Vehicle Already Entered"), like ismartparking.com.
const alreadyInside = (vehicleNumber, session) => {
  const error = new AppError(`Vehicle ${vehicleNumber} is already inside (ticket ${session.ticketNumber})`, 409);
  error.data = {
    code: "ALREADY_INSIDE",
    session: {
      _id: session._id, ticketNumber: session.ticketNumber, vehicleNumber: session.vehicleNumber, vehicleType: session.vehicleType,
      entryTime: session.entryTime, entryGate: session.entryGate, locationId: session.locationId, status: session.status,
      advance: session.advance && session.advance.amount ? { amount: session.advance.amount, method: session.advance.method } : undefined,
    },
  };
  return error;
};

// POST /api/parking/entry
// (see also reEntry below, which cancels a ticket and issues a new one in one step)
const createEntry = async (req, res) => {
  const { locationId, vehicleType, idempotencyKey, detectionId } = req.body;
  const vehicleNumber = parsePlate(req.body.vehicleNumber);
  // Checked first: a bad advance must not leave a ticket behind.
  const advance = advances.checkAdvance(req.body.advance, can(req, P.PAYMENT_COLLECT));
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });
  const companyId = location.companyId;
  // Someone tied to particular lanes can only use those.
  const gate = lanes.resolveGate(req, location, "ENTRY", req.body.gate, { soft: Boolean(req.laneSoft) });

  // A repeated request (double tap, network retry) returns the first ticket.
  const findRepeat = () => (idempotencyKey ? ParkingSession.findOne({ companyId, idempotencyKey }) : null);
  const repeat = await findRepeat();
  if (repeat) {
    // The key is only a "same request again" marker. It must belong to this location and this vehicle, otherwise
    // it is another entry (or a guess) and must not hand back that ticket.
    if (String(repeat.locationId) !== String(location._id) || repeat.vehicleNumber !== vehicleNumber) {
      throw new AppError("This request key was already used for a different entry. Try again.", 409);
    }
    return res.json({ success: true, data: { session: repeat, repeated: true } });
  }

  if (!location.vehicleTypes.includes(vehicleType)) {
    throw new AppError(`This location does not accept ${vehicleType.toLowerCase()} vehicles`, 400);
  }
  if (gate && location.gates.length) {
    const known = location.gates.find((g) => g.name === gate);
    if (!known || known.type === "EXIT") throw new AppError("That is not an entry gate of this location", 400);
  }
  lanes.assertLaneActive(location, gate);
  lanes.assertVehicleFits(location, gate, vehicleType);

  if (advance) await advances.assertReferenceFree(advance.transactionId);

  const known = await Vehicle.findOne({ companyId, plateNumber: vehicleNumber });
  if (known && known.isBlocked) {
    await audit.record(req, "ENTRY_REFUSED_BLOCKED", {
      entity: "Vehicle", entityId: known._id, companyId, meta: { locationId: location._id },
    });
    throw new AppError(`Vehicle ${vehicleNumber} is blocked: ${known.blockedReason || "no reason given"}`, 403);
  }

  const inside = await ParkingSession.findOne({ companyId, vehicleNumber, isOpen: true });
  if (inside) {
    // The same request arriving again while the first one is being finished (a retry that raced it): the
    // ticket the first one made is the answer, not an "already inside" refusal.
    if (idempotencyKey && inside.idempotencyKey === idempotencyKey) return res.json({ success: true, data: { session: inside, repeated: true } });
    throw alreadyInside(vehicleNumber, inside);
  }

  // A pass holder still gets a ticket (the barrier and the records work the
  // same); the pass decides the fee at exit.
  const pass = await passes.findCurrentPass(companyId, vehicleNumber);
  const passHere = passes.isValidAt(pass, location._id);

  if (!(await sessions.reserveSpace(location._id, vehicleType))) {
    throw new AppError(`Parking is full for ${vehicleType.toLowerCase()} vehicles`, 409);
  }

  let session;
  try {
    const vehicle = await rememberVehicle(companyId, vehicleNumber, vehicleType, location._id);
    session = await sessions.createSessionWithTicket({
      companyId,
      locationId: location._id,
      vehicleId: vehicle._id,
      vehicleNumber,
      vehicleType,
      entryTime: new Date(),
      entryGate: gate,
      entryOperatorId: req.user._id,
      ...(req.reEntry ? { reEntry: true } : {}),
      ...(passHere ? { passId: pass._id } : {}),
      idempotencyKey,
    });
  } catch (error) {
    // Give the space back, then explain what happened.
    await sessions.releaseSpace(location._id, vehicleType);
    if (error.code === 11000) {
      const again = await findRepeat();
      if (again) return res.json({ success: true, data: { session: again, repeated: true } });
      const now = await ParkingSession.findOne({ companyId, vehicleNumber, isOpen: true });
      throw now ? alreadyInside(vehicleNumber, now) : new AppError(`Vehicle ${vehicleNumber} is already inside`, 409);
    }
    throw error;
  }

  // Take the advance now that the ticket exists. If it cannot be recorded, the
  // entry is cancelled so a ticket never exists without the money it was meant to carry.
  let advanceRecorded = null;
  if (advance) {
    try {
      advanceRecorded = await advances.recordAdvance(req, session, advance);
      session = advanceRecorded.session;
    } catch (error) {
      await sessions.closeSession(session._id, "CANCELLED", {
        exitTime: new Date(), overrideReason: "The advance payment could not be recorded", closedBy: req.user._id,
      });
      if (error.code === 11000) throw new AppError("This payment reference was already used", 409);
      throw error;
    }
  }

  await audit.record(req, "PARKING_ENTRY", {
    entity: "ParkingSession", entityId: session._id, companyId,
    meta: { ticketNumber: session.ticketNumber, vehicleNumber, ...(advance ? { advance: advance.amount } : {}) },
  });

  // A customer who booked ahead has now arrived.
  const booking = await bookingService.markArrived({ companyId, locationId: location._id, vehicleNumber, session });
  // A booking fee paid online becomes this ticket's advance.
  let onlineFee = null;
  if (booking) {
    onlineFee = await onlineBookings.applyToSession(req, booking, session);
    if (onlineFee) session = await ParkingSession.findById(session._id);
  }

  // A plate suggestion from a camera is settled by this entry.
  if (detectionId) await anpr.linkDetection(req, detectionId, { session, plate: vehicleNumber, direction: "ENTRY" });

  const updated = await Location.findById(location._id).select("companyId name capacity occupied");
  publish(EVENTS.ENTRY_CREATED, { companyId, locationId: location._id, session });
  publish(EVENTS.OCCUPANCY_UPDATED, {
    companyId, locationId: location._id, capacity: updated.capacity, occupied: updated.occupied,
  });
  await notifyCapacity(updated, vehicleType);

  // Raise the entry barrier and print the ticket, if this gate has them.
  // Never fails the entry: the ticket exists whatever the devices do.
  const devices = await hardware.afterEntry({ session, requestedBy: req.user._id });
  messageService.sendVisitNotice({ session, kind: "ENTRY" });

  res.status(201).json({
    success: true,
    data: {
      session, repeated: false, availability: { capacity: updated.capacity, occupied: updated.occupied }, hardware: devices,
      pass: passes.summarize(pass, location._id),
      ...(booking ? { booking: { customerName: booking.customerName, phone: booking.phone, note: booking.note, ...(onlineFee ? { feePaidOnline: onlineFee.amount } : {}) } } : {}),
    },
  });
};

// Shared by the entries and exits lists.
const listSessions = async (req, res, { open, timeField }) => {
  const conditions = [locationScopedFilter(req), { isOpen: open }];

  const locationId = locationIdFromQuery(req);
  if (locationId) conditions.push({ locationId });

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 30) : "";
  if (q) {
    const ticket = sessions.normalizeTicket(q);
    // ?match=contains finds a plate by any part of it (staff often remember the last digits).
    const anchor = req.query.match === "contains" ? "" : "^";
    conditions.push(
      ticket ? { ticketNumber: ticket } : { vehicleNumber: { $regex: `${anchor}${escapeRegex(normalizePlate(q))}` } }
    );
  }
  // Closed sessions are listed one day at a time; vehicles inside are all listed
  // unless a date is asked for.
  if (!open || req.query.date) {
    const { start, end } = dayRange(req.query.date);
    conditions.push({ [timeField]: { $gte: start, $lt: end } });
  }

  const filter = { $and: conditions };
  const page = pageFrom(req);
  const [items, total] = await Promise.all([
    ParkingSession.find(filter).sort({ [timeField]: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    ParkingSession.countDocuments(filter),
  ]);

  res.json({ success: true, data: { sessions: items, total, page, pageSize: PAGE_SIZE } });
};

// GET /api/parking/entries?locationId=&q=&date=&page=   (vehicles inside now)
const listEntries = (req, res) => listSessions(req, res, { open: true, timeField: "entryTime" });

// GET /api/parking/exits?locationId=&q=&date=&page=     (closed sessions of a day)
const listExits = (req, res) => listSessions(req, res, { open: false, timeField: "exitTime" });

const findInScope = async (req) => {
  const session = await ParkingSession.findOne({ $and: [{ _id: req.params.id }, locationScopedFilter(req)] });
  if (!session) throw new AppError("Parking session not found", 404);
  return session;
};

// GET /api/parking/sessions/:id
const getSession = async (req, res) => {
  res.json({ success: true, data: await findInScope(req) });
};

// ----------------------------------------------------------------- exit ----

// Finds the open session an exit request is about, with a clear reason when
// it cannot be used.
const findSessionForExit = async (location, { ticketNumber, vehicleNumber }) => {
  const plate = vehicleNumber ? parsePlate(vehicleNumber) : null;
  const companyId = location.companyId;

  if (ticketNumber) {
    const ticket = sessions.normalizeTicket(ticketNumber);
    const session = ticket ? await ParkingSession.findOne({ companyId, ticketNumber: ticket }) : null;
    if (!session) throw new AppError("No ticket found with this number", 404);
    if (String(session.locationId) !== String(location._id)) {
      throw new AppError("This ticket belongs to a different parking location", 409);
    }
    if (!session.isOpen) throw new AppError("This vehicle has already exited", 409);
    if (plate && plate !== session.vehicleNumber) {
      throw new AppError("The vehicle number does not match this ticket", 409);
    }
    return session;
  }

  const session = await ParkingSession.findOne({
    companyId, locationId: location._id, vehicleNumber: plate, isOpen: true,
  });
  if (!session) throw new AppError(`No vehicle ${plate} is inside this location`, 404);
  return session;
};

// POST /api/parking/exit
// Step 1 of leaving: find the session and work out the fee.
// - Nothing to pay (grace period, free tariff): the session is closed here.
// - Otherwise it becomes PAYMENT_PENDING and is closed by POST /api/payments.
// Calling this again recalculates the fee for the current time.
const startExit = async (req, res) => {
  const { locationId, ticketNumber, vehicleNumber, detectionId, editedAmount, editReason } = req.body;
  const lostTicket = Boolean(req.body.lostTicket);
  if (!ticketNumber && !vehicleNumber) throw new AppError("Enter a ticket number or a vehicle number", 400);
  if (lostTicket && !vehicleNumber) throw new AppError("For a lost ticket, enter the vehicle number", 400);

  const location = await getAccessibleLocation(req, locationId);
  const gate = lanes.resolveGate(req, location, "EXIT", req.body.gate);
  const session = await findSessionForExit(location, { ticketNumber: lostTicket ? null : ticketNumber, vehicleNumber });

  if (gate && location.gates.length) {
    const known = location.gates.find((g) => g.name === gate);
    if (!known || known.type === "ENTRY") throw new AppError("That is not an exit gate of this location", 400);
  }
  lanes.assertLaneActive(location, gate);
  lanes.assertVehicleFits(location, gate, session.vehicleType);

  // A FASTag charge that is waiting to be confirmed (or was taken and not yet turned into a payment) fixes
  // the fee: working it out again could leave the customer charged one amount against another fee.
  // The same screen comes back so the operator can finish it.
  if (session.status === "PAYMENT_PENDING") {
    const live = await fastagService.unsettled(session._id);
    if (live && live.status !== "FAILED") {
      return res.json({
        success: true,
        data: { session, paymentRequired: true, fastagCharge: { status: live.status, tagId: live.tagId, amount: live.amount } },
      });
    }
  }

  const exitTime = new Date();
  const tariff = await findTariffFor({
    companyId: session.companyId, locationId: session.locationId,
    vehicleType: session.vehicleType, entryTime: session.entryTime,
  });
  // A valid pass at the moment of leaving means nothing to pay (also when it
  // was bought after entering, and also when the ticket is lost).
  const pass = await passes.findCurrentPass(session.companyId, session.vehicleNumber);
  const passHere = passes.isValidAt(pass, session.locationId, exitTime);
  const passInfo = passes.summarize(pass, session.locationId, exitTime);
  const calculated = calculateFee(tariff, { entryTime: session.entryTime, exitTime, lostTicket, hasValidPass: passHere });
  // The person at the exit may change the amount when the location allows it. The reason is
  // required and the change is kept on the ticket and in the audit log.
  let fee = calculated;
  let feeEdit = null;
  if (editedAmount !== undefined && editedAmount !== null) {
    if (!resolveOperations(location.operations).exitAmountEdit) {
      throw new AppError("Changing the amount is switched off for this location", 403);
    }
    if (!editReason || String(editReason).trim().length < 5) throw new AppError("Give a reason (at least 5 letters) for changing the amount", 400);
    if (passHere) throw new AppError("A pass holder leaves without paying, so there is no amount to change", 409);
    // Raising the amount is allowed for the exit operator; charging LESS than the calculated fee needs a supervisor or admin.
    if (lowersFee(editedAmount, calculated.total) && !can(req, P.SESSION_OVERRIDE)) {
      throw new AppError("Only a supervisor or admin can charge less than the calculated fee", 403);
    }
    if (Math.abs(editedAmount - calculated.total) > 0.004) {
      fee = editedFee(calculated, editedAmount);
      feeEdit = { calculated: calculated.total, reason: String(editReason).trim().slice(0, 200), by: req.user._id, at: new Date() };
    }
  }
  const recordFeeEdit = (closedOrPending) => feeEdit && audit.record(req, "PARKING_FEE_EDITED", {
    entity: "ParkingSession", entityId: closedOrPending._id, companyId: closedOrPending.companyId,
    meta: { ticketNumber: closedOrPending.ticketNumber, calculated: feeEdit.calculated, charged: fee.total, reason: feeEdit.reason },
  });

  if (detectionId) await anpr.linkDetection(req, detectionId, { session, plate: session.vehicleNumber, direction: "EXIT" });

  // An advance taken at entry pays the fee first; only the rest is charged now.
  const advanceTaken = (session.advance && session.advance.amount) || 0;
  const share = advances.split(fee.total, advanceTaken);

  const feeFields = {
    exitTime,
    exitGate: gate,
    tariffId: tariff._id,
    ...(passHere ? { passId: pass._id } : {}),
    durationMinutes: fee.durationMinutes,
    lostTicket,
    // Always written, so a fee worked out again without a change clears an earlier one.
    "feeEdit.calculated": feeEdit ? feeEdit.calculated : null,
    "feeEdit.reason": feeEdit ? feeEdit.reason : null,
    "feeEdit.by": feeEdit ? feeEdit.by : null,
    "feeEdit.at": feeEdit ? feeEdit.at : null,
    fee: {
      subtotal: fee.subtotal, tax: fee.tax, total: fee.total,
      taxPercent: fee.taxPercent, taxInclusive: fee.taxInclusive,
      reason: fee.reason, breakdown: fee.breakdown,
      advanceApplied: share.applied, due: share.due,
    },
  };

  // Nothing left to pay: no fee, or the advance covered it.
  if (share.due === 0) {
    let closed = await sessions.closeSession(session._id, passHere ? "PASS_EXIT" : "COMPLETED", {
      ...feeFields,
      ...(share.applied > 0 ? { paymentId: session.advance.paymentId } : {}),
      exitOperatorId: req.user._id, closedBy: req.user._id,
    });
    if (!closed) throw new AppError("This vehicle has already exited", 409);

    // The part of the advance above the fee goes back to the customer.
    let refunded = 0;
    if (advanceTaken > 0) {
      refunded = await advances.finishAtExit(req, session, { applied: share.applied, excess: share.excess, tax: fee.tax });
      if (refunded > 0) {
        closed = (await ParkingSession.findByIdAndUpdate(closed._id, { $set: { "fee.advanceRefunded": refunded } }, { returnDocument: "after" })) || closed;
      }
    }
    await recordFeeEdit(closed);
    await audit.record(req, "PARKING_EXIT", {
      entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
      meta: {
        ticketNumber: closed.ticketNumber, total: fee.total, reason: fee.reason,
        ...(advanceTaken > 0 ? { advance: advanceTaken, advanceApplied: share.applied, advanceRefunded: refunded } : {}),
      },
    });
    publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });
    const devices = await hardware.afterExit({ session: closed, requestedBy: req.user._id });
    messageService.sendVisitNotice({ session: closed, kind: "EXIT" });
    return res.json({
      success: true,
      data: {
        session: closed, paymentRequired: false, hardware: devices, pass: passInfo,
        ...(advanceTaken > 0 ? { advance: { taken: advanceTaken, applied: share.applied, refund: refunded, method: session.advance.method } } : {}),
      },
    });
  }

  // Still inside until paid. Guarded so a session closed a moment ago stays closed.
  const pending = await ParkingSession.findOneAndUpdate(
    { _id: session._id, isOpen: true },
    { $set: { ...feeFields, status: "PAYMENT_PENDING" } },
    { returnDocument: "after" }
  );
  if (!pending) throw new AppError("This vehicle has already exited", 409);
  await recordFeeEdit(pending);

  // A wallet linked to this vehicle can pay the fee: offered at the exit screen.
  const linkedWallet = await wallets.findForVehicle(session.companyId, session.vehicleNumber).catch(() => null);

  res.json({
    success: true,
    data: {
      session: pending, paymentRequired: true, pass: passInfo,
      ...(linkedWallet ? { wallet: wallets.brief(linkedWallet, advances.amountDue(pending)) } : {}),
      ...(advanceTaken > 0 ? { advance: { taken: advanceTaken, applied: share.applied, refund: 0, method: session.advance.method } } : {}),
    },
  });
};

// ------------------------------------------------- admin corrections ----

// POST /api/parking/sessions/:id/cancel   (entry made by mistake)
const cancelSession = async (req, res) => {
  const session = await findInScope(req);
  sessions.assertTransition(session.status, "CANCELLED");

  const closed = await sessions.closeSession(session._id, "CANCELLED", {
    exitTime: new Date(), overrideReason: req.body.reason, closedBy: req.user._id,
  });
  if (!closed) throw new AppError("This session can no longer be cancelled", 409);
  await fastagService.flagIfCharged(session, req, "Entry cancelled");
  // An entry made by mistake: any advance taken for it is given back in full.
  const advanceBack = await advances.giveBack(req, session, { reason: `Entry cancelled: ${req.body.reason}`.slice(0, 200) });
  await audit.record(req, "PARKING_ENTRY_CANCELLED", {
    entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
    meta: { ticketNumber: closed.ticketNumber, reason: req.body.reason, ...(advanceBack ? { advanceRefunded: advanceBack.refund.amount } : {}) },
  });

  res.json({ success: true, data: closed, ...(advanceBack ? { advanceRefunded: advanceBack.refund.amount } : {}) });
};

// POST /api/parking/sessions/:id/re-entry   { gate?, vehicleType? }
// "Re-entry": the vehicle is on the books as inside but is entering again (a misread plate that was
// corrected, a wrong vehicle type, a car that was turned back at the gate). The old ticket is
// cancelled and a new one issued in one step. There is no daily limit and no advance rule; the location's on/off switch
// applies, and a ticket older than the grace time (REENTRY_GRACE_MINUTES, default 30) needs SESSION_OVERRIDE. Every one is recorded against the operator (entryOperatorId, reEntry: true) and shows in the
// admin's Re-entries report. An advance taken on the old ticket is given back, as for any cancelled entry.
const reEntry = async (req, res) => {
  const session = await findInScope(req);
  // The location's "Allow re-entry" switch is the one rule that stays: an admin can switch it off.
  const reEntryLocation = await getAccessibleLocation(req, session.locationId);
  if (!resolveOperations(reEntryLocation.operations).allowReEntry) {
    throw new AppError("Re-entry is switched off for this location. Ask an admin to cancel the ticket and make a new entry.", 403);
  }
  // A ticket made a moment ago can be re-entered by the entry operator (a driver who turned around). An older
  // one needs a supervisor or admin, who hold the "Correct tickets" permission.
  if (reEntryNeedsSupervisor(session.entryTime) && !can(req, P.SESSION_OVERRIDE)) {
    throw new AppError(`This ticket is older than ${reEntryGraceMinutes()} minutes. Ask a supervisor or admin to re-enter it.`, 403);
  }
  const key = `reentry-${session._id}`;
  // A double tap returns the ticket the first tap made.
  const repeat = await ParkingSession.findOne({ companyId: session.companyId, idempotencyKey: key });
  if (repeat) return res.json({ success: true, data: { session: repeat, repeated: true } });

  if (!session.isOpen || session.status !== "ACTIVE") throw new AppError("Only a vehicle that is still inside can be entered again", 409);

  const location = await getAccessibleLocation(req, session.locationId, { mustBeActive: true });
  const vehicleType = req.body.vehicleType || session.vehicleType;
  if (!location.vehicleTypes.includes(vehicleType)) {
    throw new AppError(`This location does not accept ${vehicleType.toLowerCase()} vehicles`, 400);
  }
  const known = await Vehicle.findOne({ companyId: session.companyId, plateNumber: session.vehicleNumber });
  if (known && known.isBlocked) throw new AppError(`Vehicle ${session.vehicleNumber} is blocked: ${known.blockedReason || "no reason given"}`, 403);

  const closed = await sessions.closeSession(session._id, "CANCELLED", {
    exitTime: new Date(), overrideReason: "Re-entry: a new ticket was issued", closedBy: req.user._id,
  });
  if (!closed) throw new AppError("This ticket is no longer open", 409);
  await audit.record(req, "PARKING_ENTRY_CANCELLED", {
    entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
    meta: { ticketNumber: closed.ticketNumber, reason: "Re-entry", reEntry: true },
  });
  // An advance taken on the old ticket goes back to the customer; the new ticket starts clean.
  await advances.giveBack(req, session, { reason: "Re-entry: a new ticket was issued" });

  req.reEntry = true;
  req.laneSoft = true; // the old ticket's lane may not be the re-entering user's lane
  req.body = {
    locationId: String(location._id), vehicleNumber: session.vehicleNumber, vehicleType,
    ...(req.body.gate || session.entryGate ? { gate: req.body.gate || session.entryGate } : {}), idempotencyKey: key,
  };
  try {
    return await createEntry(req, res);
  } catch (error) {
    await audit.record(req, "PARKING_RE_ENTRY_FAILED", {
      entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId, meta: { ticketNumber: closed.ticketNumber, reason: error.message },
    });
    throw new AppError(
      `The old ticket ${closed.ticketNumber} was cancelled, but the new one could not be made (${error.message}). Make the entry again.`,
      error.statusCode || 409
    );
  }
};

// POST /api/parking/sessions/:id/override   (let a vehicle out without the normal payment)
const overrideSession = async (req, res) => {
  const session = await findInScope(req);
  sessions.assertTransition(session.status, "MANUAL_OVERRIDE");

  const exitTime = new Date();
  const closed = await sessions.closeSession(session._id, "MANUAL_OVERRIDE", {
    exitTime,
    durationMinutes: Math.ceil((exitTime - session.entryTime) / 60000),
    overrideReason: req.body.reason,
    exitOperatorId: req.user._id,
    closedBy: req.user._id,
  });
  if (!closed) throw new AppError("This vehicle has already exited", 409);
  // A FASTag may have been charged for this vehicle: the release is allowed, the money is flagged for reconciliation.
  const charged = await fastagService.flagIfCharged(session, req, "Exit override");
  await audit.record(req, "PARKING_EXIT_OVERRIDE", {
    entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
    meta: { ticketNumber: closed.ticketNumber, reason: req.body.reason, feeWaived: session.fee && session.fee.total },
  });

  // An admin released the vehicle: raise the barrier (no receipt, nothing was paid).
  const devices = await hardware.afterExit({ session: closed, requestedBy: req.user._id, print: false });
  res.json({
    success: true, data: closed, hardware: devices,
    ...(charged ? { warning: `A FASTag (${charged.tagId}) was charged ${charged.amount} for this vehicle (status ${charged.status}). It has been flagged: reconcile it with your FASTag partner.` } : {}),
  });
};

// -------------------------------------------------------------- receipt ----

// GET /api/parking/sessions/:id/receipt
// Everything a printed or digital receipt needs, in one answer.
const getReceipt = async (req, res) => {
  const session = await findInScope(req);
  if (session.isOpen) throw new AppError("A receipt is available after the vehicle has exited", 409);
  res.json({ success: true, data: await buildReceipt(session) });
};


// ---------------------------------------------------- barrier and printer ----

const RECENT_MINUTES = 10;
const isRecent = (date) => Boolean(date) && Date.now() - date.getTime() <= RECENT_MINUTES * 60000;

// POST /api/parking/sessions/:id/barrier
// "The barrier did not lift": asks again. Only for a vehicle that was cleared
// in the last few minutes (a new entry, or an exit that is paid, free or
// released by an admin), so this can never be used to let anyone else through.
const requestBarrier = async (req, res) => {
  const session = await findInScope(req);

  let direction = null;
  // "Just cleared" is measured from when the entry was made / the session was
  // closed (updatedAt), not from the exit time, which is set when the fee is
  // calculated and so can be well before the vehicle was actually released.
  if (session.isOpen && session.status === "ACTIVE" && isRecent(session.createdAt)) direction = "ENTRY";
  const exited = ["COMPLETED", "LOST_TICKET", "PASS_EXIT", "MANUAL_OVERRIDE"].includes(session.status);
  if (!session.isOpen && exited && isRecent(session.updatedAt)) direction = "EXIT";
  if (!direction) {
    throw new AppError("The barrier can only be opened for a vehicle that has just been cleared", 409);
  }
  if (!can(req, direction === "ENTRY" ? P.ENTRY_CREATE : P.EXIT_CREATE)) {
    throw new AppError("You do not have permission to do this", 403);
  }

  const result = await hardware.requestBarrierOpen({
    session, direction, requestedBy: req.user._id, reason: "Operator asked again",
    gate: req.body.gate || (direction === "ENTRY" ? session.entryGate : session.exitGate),
  });
  if (!result) throw new AppError("No single barrier is set up for this gate. Lift it by hand.", 404);

  await audit.record(req, "BARRIER_REQUEST", {
    entity: "ParkingSession", entityId: session._id, companyId: session.companyId,
    meta: { ticketNumber: session.ticketNumber, direction, commandId: result.command._id, status: result.command.status },
  });
  res.status(201).json({
    success: true,
    data: { deviceName: result.device.name, commandId: result.command._id, status: result.command.status },
  });
};

// POST /api/parking/barrier   { locationId, direction, gate?, reason? }
// "Open barrier": lifts the barrier of a gate by hand. Needs the permission of that direction
// (entry or exit), is limited to a few lifts a minute per person and is always recorded.
const MANUAL_LIFTS_PER_MINUTE = 6;
const manualLifts = new Map(); // userId -> [timestamps]
const manualLiftAllowed = (userId, now = Date.now()) => {
  const recent = (manualLifts.get(String(userId)) || []).filter((t) => now - t < 60000);
  if (recent.length >= MANUAL_LIFTS_PER_MINUTE) return false;
  recent.push(now);
  manualLifts.set(String(userId), recent);
  return true;
};

const openBarrierByHand = async (req, res) => {
  const { locationId, direction, reason } = req.body;
  if (!can(req, direction === "ENTRY" ? P.ENTRY_CREATE : P.EXIT_CREATE)) {
    throw new AppError("You do not have permission to do this", 403);
  }
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });
  const gate = lanes.resolveGate(req, location, direction, req.body.gate);
  lanes.assertLaneActive(location, gate);
  if (!manualLiftAllowed(req.user._id)) throw new AppError("Too many barrier lifts in a minute. Wait a little.", 429);

  const result = await hardware.requestManualBarrier({
    locationId: location._id, direction, gate, requestedBy: req.user._id, reason: reason ? `Opened by hand: ${reason}` : undefined,
  });
  if (!result) throw new AppError("No single barrier is set up for this gate. Lift it by hand.", 404);

  await audit.record(req, "BARRIER_MANUAL_OPEN", {
    entity: "Hardware", entityId: result.device._id, companyId: location.companyId,
    meta: { locationId: location._id, direction, gate: gate || null, commandId: result.command._id, ...(reason ? { reason } : {}) },
  });
  res.status(201).json({
    success: true,
    data: { deviceName: result.device.name, commandId: result.command._id, status: result.command.status },
  });
};

// POST /api/parking/sessions/:id/reprint
// The ticket (or receipt) was printed again from the browser: counts it, so the collection
// report can show how many reprints each operator made.
// The only rule left: a person the admin switched "Reprint" off for cannot print a ticket or receipt again.
// There is no limit on how many times. Each one is counted on the ticket and recorded against the person who
// made it (audit PARKING_REPRINT), which is what the admin's Reprints report adds up.
const recordReprint = (req, session, kind) =>
  audit.record(req, "PARKING_REPRINT", {
    entity: "ParkingSession", entityId: session._id, companyId: session.companyId,
    meta: { ticketNumber: session.ticketNumber, vehicleNumber: session.vehicleNumber, locationId: session.locationId, kind },
  });

const assertMayReprint = (req) => {
  if (req.user.access && req.user.access.reprint === false) {
    throw new AppError("You are not allowed to print a ticket or receipt again. Ask your admin.", 403);
  }
};

const countReprint = async (req, res) => {
  assertMayReprint(req);
  const session = await findInScope(req);
  const updated = await ParkingSession.findByIdAndUpdate(session._id, { $inc: { reprints: 1 } }, { returnDocument: "after", timestamps: false });
  await recordReprint(req, session, session.isOpen ? "ticket" : "receipt");
  res.json({ success: true, data: { reprints: updated.reprints } });
};

// POST /api/parking/sessions/:id/print
// Prints the ticket (vehicle still inside) or the receipt (vehicle has left)
// on the thermal printer of that gate.
const printSlip = async (req, res) => {
  assertMayReprint(req);
  const session = await findInScope(req);
  const gate = req.body.gate;
  const result = session.isOpen
    ? await hardware.requestTicketPrint({ session, requestedBy: req.user._id, ...(gate ? { gate } : {}) })
    : await hardware.requestReceiptPrint({
        session, receipt: () => buildReceipt(session), requestedBy: req.user._id, ...(gate ? { gate } : {}),
      });
  if (!result) throw new AppError("No single printer is set up for this gate", 404);
  await ParkingSession.updateOne({ _id: session._id }, { $inc: { reprints: 1 } }, { timestamps: false });
  await recordReprint(req, session, session.isOpen ? "ticket" : "receipt");

  res.status(201).json({
    success: true,
    data: { deviceName: result.device.name, commandId: result.command._id, status: result.command.status },
  });
};

module.exports = {
  requestBarrier, openBarrierByHand, reEntry, manualLiftAllowed, printSlip, countReprint, createEntry, listEntries, listExits, getSession, startExit, cancelSession, overrideSession, getReceipt,
};
