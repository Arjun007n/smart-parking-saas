// What a location subscription is made of, and what each part costs per month (rupees, before GST).
//
// A subscription (one per location) has users, a length (tenure) and add-ons. These are the add-ons and their
// starting prices, taken from the price list of ismartparking.com. The Super Admin can change a price under
// Manage Subscriptions (stored as AddonPrice rows); this file is what applies until a price is changed.
//
// The user price is not here: it is PRICING.parkingPerUserMonth in config/pricing.js (kept in step with the website).
//
// Backup add-ons are priced by how many months the data is kept: parking data backup is free for the first
// month and charged per extra month; photo backup is charged per month kept.

const ADDONS = Object.freeze([
  { key: "pass", label: "Vehicle Pass Management", kind: "FLAG", price: 250, unit: "month", description: "Sell and manage monthly vehicle passes, pass users, companies and GST pass invoices." },
  { key: "photo", label: "Vehicle Photo Capture", kind: "FLAG", price: 500, unit: "month", description: "Take vehicle photos at entry and exit and keep them with the ticket." },
  { key: "anpr", label: "ANPR Camera Service", kind: "COUNT", price: 500, unit: "camera / month", noun: "ANPR cameras", description: "Number plate cameras that fill the vehicle number at the gate." },
  { key: "fastag", label: "Fastag Parking Service", kind: "COUNT", price: 500, unit: "lane / month", noun: "FASTag lanes", description: "Take the parking fee from the vehicle's FASTag (MDR charges apply)." },
  { key: "gateway", label: "Payment Gateway Service", kind: "FLAG", price: 300, unit: "month", description: "Online payments by UPI, card and wallets (MDR charges apply)." },
  { key: "dataBackup", label: "Parking Data Backup", kind: "RETENTION", price: 200, unit: "extra month kept / month", freeMonths: 1, options: [1, 3, 6, 12], description: "Keep parking records for the chosen number of months." },
  { key: "photoBackup", label: "Vehicle Photo Backup", kind: "RETENTION", price: 800, unit: "month kept / month", freeMonths: 0, options: [0, 1, 3, 6, 12], description: "Keep vehicle photos for the chosen number of months." },
]);

const KEYS = ADDONS.map((a) => a.key);
const byKey = (key) => ADDONS.find((a) => a.key === key);

// How many days of a month the part-month charge uses when add-ons are added in the middle of a period.
const DAYS_PER_MONTH = 30;

// The add-ons a new subscription starts with in the form (the same two ismartparking ticks first).
const DEFAULT_SELECTION = Object.freeze({ pass: true, photo: true, anpr: 0, fastag: 0, gateway: false, dataBackup: 1, photoBackup: 0 });

module.exports = { ADDONS, KEYS, byKey, DAYS_PER_MONTH, DEFAULT_SELECTION };
