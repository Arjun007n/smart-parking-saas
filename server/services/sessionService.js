// Parking session lifecycle (plan, Day 17).
//
//   ACTIVE ──► PAYMENT_PENDING ──► COMPLETED      normal paid exit
//     │              │        └──► LOST_TICKET    paid exit without a ticket
//     │              └──► ACTIVE                  (not used yet; reserved for "customer went back in")
//     ├──► COMPLETED        nothing to pay (grace period, free tariff)
//     ├──► PASS_EXIT        exit on a valid pass
//     ├──► CANCELLED        entry made by mistake (admin)
//     └──► MANUAL_OVERRIDE  closed by an admin with a reason (also from PAYMENT_PENDING)
//
// ACTIVE and PAYMENT_PENDING mean the vehicle is still inside ("open").
// Every other status is final and can never change again.

const crypto = require("crypto");
const AppError = require("../utils/AppError");
const { localDateStamp } = require("../utils/time");
const ParkingSession = require("../models/ParkingSession");
const Location = require("../models/Location");

const TRANSITIONS = Object.freeze({
  ACTIVE: ["PAYMENT_PENDING", "COMPLETED", "PASS_EXIT", "CANCELLED", "MANUAL_OVERRIDE"],
  PAYMENT_PENDING: ["PAYMENT_PENDING", "COMPLETED", "LOST_TICKET", "ACTIVE", "MANUAL_OVERRIDE"],
  COMPLETED: [],
  CANCELLED: [],
  LOST_TICKET: [],
  PASS_EXIT: [],
  MANUAL_OVERRIDE: [],
});

const OPEN_STATUSES = ["ACTIVE", "PAYMENT_PENDING"];
const isOpenStatus = (status) => OPEN_STATUSES.includes(status);
const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

const assertTransition = (from, to) => {
  if (!canTransition(from, to)) {
    throw new AppError(`A session that is ${from} cannot become ${to}`, 409);
  }
};

// Statuses a session may be in to move to `to`.
const allowedFrom = (to) => Object.keys(TRANSITIONS).filter((from) => canTransition(from, to));

// Ticket numbers look like T-260302-K7QXMP: date of entry plus 6 random
// characters. Letters and digits that are easy to confuse (0/O, 1/I) are not
// used. The same text is what a QR code on the ticket would contain.
const TICKET_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TICKET_PATTERN = /^T-\d{6}-[2-9A-HJ-NP-Z]{6}$/;

const generateTicketNumber = (date = new Date()) => {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += TICKET_ALPHABET[crypto.randomInt(TICKET_ALPHABET.length)];
  return `T-${localDateStamp(date)}-${code}`;
};

// Accepts what an operator types or scans: any case, with or without dashes.
const normalizeTicket = (value) => {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = /^T(\d{6})([A-Z0-9]{6})$/.exec(compact);
  return match ? `T-${match[1]}-${match[2]}` : null;
};

// Creates a session, retrying in the very unlikely case of a ticket clash.
const createSessionWithTicket = async (data) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await ParkingSession.create({ ...data, ticketNumber: generateTicketNumber(data.entryTime) });
    } catch (error) {
      const ticketClash = error.code === 11000 && error.keyPattern && error.keyPattern.ticketNumber;
      if (!ticketClash) throw error;
    }
  }
  throw new AppError("Could not create a ticket. Please try again.", 503);
};

const capacityKey = (vehicleType) => vehicleType.toLowerCase();

// Takes one space at a location. Returns false when it is full.
// Done as a single database update so two gates cannot take the last space.
const reserveSpace = async (locationId, vehicleType) => {
  const key = capacityKey(vehicleType);
  const result = await Location.updateOne(
    { _id: locationId, isActive: true, $expr: { $lt: [`$occupied.${key}`, `$capacity.${key}`] } },
    { $inc: { [`occupied.${key}`]: 1 } }
  );
  return result.modifiedCount === 1;
};

const releaseSpace = async (locationId, vehicleType) => {
  const key = capacityKey(vehicleType);
  await Location.updateOne(
    { _id: locationId, [`occupied.${key}`]: { $gt: 0 } },
    { $inc: { [`occupied.${key}`]: -1 } }
  );
};

// Closes an open session and frees its space. Safe against double exits:
// only the first caller gets the session back; later callers get null.
const closeSession = async (sessionId, status, fields = {}) => {
  if (isOpenStatus(status)) throw new Error(`${status} is not a final status`);

  const session = await ParkingSession.findOneAndUpdate(
    { _id: sessionId, isOpen: true, status: { $in: allowedFrom(status) } },
    { $set: { ...fields, status, isOpen: false } },
    { returnDocument: "after" }
  );
  if (session) await releaseSpace(session.locationId, session.vehicleType);
  return session;
};

module.exports = {
  TRANSITIONS, OPEN_STATUSES, TICKET_PATTERN,
  isOpenStatus, canTransition, assertTransition, allowedFrom,
  generateTicketNumber, normalizeTicket, createSessionWithTicket,
  reserveSpace, releaseSpace, closeSession,
};
