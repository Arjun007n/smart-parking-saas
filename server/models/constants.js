// Shared enum values used by several models.
// HEAVY is "Coach / Bus / Truck"; TAXI is a cab; TEMPO is "Tempo / SUV / Mini bus".
const VEHICLE_TYPES = ["CAR", "BIKE", "HEAVY", "TAXI", "TEMPO"];
// The same types as they are written in a location's capacity and occupied counts ("car", "bike" ...).
// A lane takes either two-wheelers (BIKE) or four-wheelers (every other type).
const VEHICLE_CLASSES = ["TWO_WHEELER", "FOUR_WHEELER"];
const vehicleClassOf = (type) => (type === "BIKE" ? "TWO_WHEELER" : "FOUR_WHEELER");
const VEHICLE_KEYS = VEHICLE_TYPES.map((type) => type.toLowerCase());
// Adds up a capacity or occupied object over every vehicle type (a count missing in an old record is 0).
const sumCounts = (counts) => VEHICLE_KEYS.reduce((total, key) => total + ((counts && counts[key]) || 0), 0);
const SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"];
const SLOT_TYPES = ["NORMAL", "RESERVED", "EV", "ACCESSIBLE", "VIP"];
const SLOT_STATUSES = ["FREE", "OCCUPIED", "MAINTENANCE"];
const SESSION_STATUSES = [
  "ACTIVE", "PAYMENT_PENDING", "COMPLETED", "CANCELLED",
  "LOST_TICKET", "PASS_EXIT", "MANUAL_OVERRIDE",
];
// FASTAG is recorded by the operator like cash, UPI and card: there is no link to the toll-tag network.
// WALLET is the company's own prepaid wallet (see services/walletService.js).
const PAYMENT_METHODS = ["CASH", "UPI", "CARD", "GATEWAY", "FASTAG", "WALLET"];
const PAYMENT_STATUSES = ["PENDING", "SUCCESS", "FAILED", "REFUNDED"];
const PAYMENT_KINDS = ["FEE", "ADVANCE"];
const TARIFF_KINDS = ["STANDARD", "EVENT", "AIRPORT"];
// 24-hour local time, "HH:MM".
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

module.exports = {
  VEHICLE_CLASSES, vehicleClassOf, VEHICLE_TYPES, VEHICLE_KEYS, sumCounts, SUBSCRIPTION_STATUSES, SLOT_TYPES, SLOT_STATUSES,
  SESSION_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_KINDS, TARIFF_KINDS, TIME_PATTERN,
};
