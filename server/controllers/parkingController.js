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
const ParkingSession = require("../models/ParkingSession");
const Vehicle = require("../models/Vehicle");
const Payment = require("../models/Payment");
const Company = require("../models/Company");
const Location = require("../models/Location");
const User = require("../models/User");

const PAGE_SIZE = 50;
const pageFrom = (req) => Math.min(1000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

// ---------------------------------------------------------------- entry ----

// POST /api/parking/entry
const createEntry = async (req, res) => {
  const { locationId, vehicleType, gate, idempotencyKey } = req.body;
  const vehicleNumber = parsePlate(req.body.vehicleNumber);
  const location = await getAccessibleLocation(req, locationId, { mustBeActive: true });
  const companyId = location.companyId;

  // A repeated request (double tap, network retry) returns the first ticket.
  const findRepeat = () => (idempotencyKey ? ParkingSession.findOne({ companyId, idempotencyKey }) : null);
  const repeat = await findRepeat();
  if (repeat) return res.json({ success: true, data: { session: repeat, repeated: true } });

  if (!location.vehicleTypes.includes(vehicleType)) {
    throw new AppError(`This location does not accept ${vehicleType.toLowerCase()} vehicles`, 400);
  }
  if (gate && location.gates.length) {
    const known = location.gates.find((g) => g.name === gate);
    if (!known || known.type === "EXIT") throw new AppError("That is not an entry gate of this location", 400);
  }

  const known = await Vehicle.findOne({ companyId, plateNumber: vehicleNumber });
  if (known && known.isBlocked) {
    await audit.record(req, "ENTRY_REFUSED_BLOCKED", {
      entity: "Vehicle", entityId: known._id, companyId, meta: { locationId: location._id },
    });
    throw new AppError(`Vehicle ${vehicleNumber} is blocked: ${known.blockedReason || "no reason given"}`, 403);
  }

  const inside = await ParkingSession.findOne({ companyId, vehicleNumber, isOpen: true });
  if (inside) {
    throw new AppError(`Vehicle ${vehicleNumber} is already inside (ticket ${inside.ticketNumber})`, 409);
  }

  if (!(await sessions.reserveSpace(location._id, vehicleType))) {
    throw new AppError(`Parking is full for ${vehicleType.toLowerCase()} vehicles`, 409);
  }

  let session;
  try {
    const vehicle = await Vehicle.findOneAndUpdate(
      { companyId, plateNumber: vehicleNumber },
      { $set: { lastLocationId: location._id }, $setOnInsert: { type: vehicleType } },
      { upsert: true, returnDocument: "after" }
    );
    session = await sessions.createSessionWithTicket({
      companyId,
      locationId: location._id,
      vehicleId: vehicle._id,
      vehicleNumber,
      vehicleType,
      entryTime: new Date(),
      entryGate: gate,
      entryOperatorId: req.user._id,
      idempotencyKey,
    });
  } catch (error) {
    // Give the space back, then explain what happened.
    await sessions.releaseSpace(location._id, vehicleType);
    if (error.code === 11000) {
      const again = await findRepeat();
      if (again) return res.json({ success: true, data: { session: again, repeated: true } });
      throw new AppError(`Vehicle ${vehicleNumber} is already inside`, 409);
    }
    throw error;
  }

  await audit.record(req, "PARKING_ENTRY", {
    entity: "ParkingSession", entityId: session._id, companyId,
    meta: { ticketNumber: session.ticketNumber, vehicleNumber },
  });

  const updated = await Location.findById(location._id).select("companyId name capacity occupied");
  publish(EVENTS.ENTRY_CREATED, { companyId, locationId: location._id, session });
  publish(EVENTS.OCCUPANCY_UPDATED, {
    companyId, locationId: location._id, capacity: updated.capacity, occupied: updated.occupied,
  });
  await notifyCapacity(updated, vehicleType);

  res.status(201).json({
    success: true,
    data: { session, repeated: false, availability: { capacity: updated.capacity, occupied: updated.occupied } },
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
    conditions.push(
      ticket ? { ticketNumber: ticket } : { vehicleNumber: { $regex: `^${escapeRegex(normalizePlate(q))}` } }
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
  const { locationId, ticketNumber, vehicleNumber, gate } = req.body;
  const lostTicket = Boolean(req.body.lostTicket);
  if (!ticketNumber && !vehicleNumber) throw new AppError("Enter a ticket number or a vehicle number", 400);
  if (lostTicket && !vehicleNumber) throw new AppError("For a lost ticket, enter the vehicle number", 400);

  const location = await getAccessibleLocation(req, locationId);
  const session = await findSessionForExit(location, { ticketNumber: lostTicket ? null : ticketNumber, vehicleNumber });

  if (gate && location.gates.length) {
    const known = location.gates.find((g) => g.name === gate);
    if (!known || known.type === "ENTRY") throw new AppError("That is not an exit gate of this location", 400);
  }

  const exitTime = new Date();
  const tariff = await findTariffFor({
    companyId: session.companyId, locationId: session.locationId,
    vehicleType: session.vehicleType, entryTime: session.entryTime,
  });
  const fee = calculateFee(tariff, { entryTime: session.entryTime, exitTime, lostTicket });

  const feeFields = {
    exitTime,
    exitGate: gate,
    tariffId: tariff._id,
    durationMinutes: fee.durationMinutes,
    lostTicket,
    fee: {
      subtotal: fee.subtotal, tax: fee.tax, total: fee.total,
      taxPercent: fee.taxPercent, taxInclusive: fee.taxInclusive,
      reason: fee.reason, breakdown: fee.breakdown,
    },
  };

  if (fee.total === 0) {
    const closed = await sessions.closeSession(session._id, "COMPLETED", {
      ...feeFields, exitOperatorId: req.user._id, closedBy: req.user._id,
    });
    if (!closed) throw new AppError("This vehicle has already exited", 409);
    await audit.record(req, "PARKING_EXIT", {
      entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
      meta: { ticketNumber: closed.ticketNumber, total: 0, reason: fee.reason },
    });
    publish(EVENTS.EXIT_COMPLETED, { companyId: closed.companyId, locationId: closed.locationId, session: closed });
    return res.json({ success: true, data: { session: closed, paymentRequired: false } });
  }

  // Still inside until paid. Guarded so a session closed a moment ago stays closed.
  const pending = await ParkingSession.findOneAndUpdate(
    { _id: session._id, isOpen: true },
    { $set: { ...feeFields, status: "PAYMENT_PENDING" } },
    { returnDocument: "after" }
  );
  if (!pending) throw new AppError("This vehicle has already exited", 409);

  res.json({ success: true, data: { session: pending, paymentRequired: true } });
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
  await audit.record(req, "PARKING_ENTRY_CANCELLED", {
    entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
    meta: { ticketNumber: closed.ticketNumber, reason: req.body.reason },
  });

  res.json({ success: true, data: closed });
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
  await audit.record(req, "PARKING_EXIT_OVERRIDE", {
    entity: "ParkingSession", entityId: closed._id, companyId: closed.companyId,
    meta: { ticketNumber: closed.ticketNumber, reason: req.body.reason, feeWaived: session.fee && session.fee.total },
  });

  res.json({ success: true, data: closed });
};

// -------------------------------------------------------------- receipt ----

// GET /api/parking/sessions/:id/receipt
// Everything a printed or digital receipt needs, in one answer.
const getReceipt = async (req, res) => {
  const session = await findInScope(req);
  if (session.isOpen) throw new AppError("A receipt is available after the vehicle has exited", 409);

  const [company, location, payment, entryOperator, exitOperator] = await Promise.all([
    Company.findById(session.companyId).select("name legalName gstNumber address logoUrl"),
    Location.findById(session.locationId).select("name address contact"),
    Payment.findOne({ sessionId: session._id, status: { $in: ["SUCCESS", "REFUNDED"] } }),
    session.entryOperatorId ? User.findById(session.entryOperatorId).select("name") : null,
    session.exitOperatorId ? User.findById(session.exitOperatorId).select("name") : null,
  ]);

  const fee = session.fee || {};
  res.json({
    success: true,
    data: {
      receiptNumber: `R-${session.ticketNumber.slice(2)}`,
      // What a QR code on the receipt should contain.
      reference: session.ticketNumber,
      status: session.status,
      company: {
        name: company.name, legalName: company.legalName, gstNumber: company.gstNumber, address: company.address,
      },
      location: { name: location.name, address: location.address, phone: location.contact && location.contact.phone },
      vehicle: { number: session.vehicleNumber, type: session.vehicleType },
      ticketNumber: session.ticketNumber,
      entryTime: session.entryTime,
      exitTime: session.exitTime,
      durationMinutes: session.durationMinutes,
      entryGate: session.entryGate,
      exitGate: session.exitGate,
      amount: {
        subtotal: fee.subtotal || 0,
        tax: fee.tax || 0,
        total: fee.total || 0,
        taxPercent: fee.taxPercent || 0,
        taxInclusive: fee.taxInclusive !== false,
        breakdown: fee.breakdown || {},
      },
      // Money actually received. Zero for free exits, cancellations and overrides.
      paid: payment ? payment.amount : 0,
      payment: payment
        ? { method: payment.method, status: payment.status, transactionId: payment.transactionId, paidAt: payment.paidAt }
        : null,
      note: session.overrideReason,
      operators: { entry: entryOperator && entryOperator.name, exit: exitOperator && exitOperator.name },
    },
  });
};

module.exports = {
  createEntry, listEntries, listExits, getSession, startExit, cancelSession, overrideSession, getReceipt,
};
