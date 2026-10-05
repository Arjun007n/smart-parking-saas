// Indian GST helpers: state codes, and which tax applies to a sale.
//
// A sale to a buyer in the seller's own state carries CGST + SGST (half each). A sale to another state
// carries IGST (the whole amount). The state comes from the first two digits of a GSTIN when there is one,
// else from the state name on the address.

const STATES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isGstin = (value) => typeof value === "string" && GSTIN.test(value.trim().toUpperCase()) && Boolean(STATES[value.trim().slice(0, 2)]);

const normalise = (name) =>
  String(name || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [normalise(name), code]));
// Names people commonly write.
const ALIASES = {
  "new delhi": "07", "nct of delhi": "07", orissa: "21", pondicherry: "34", uttaranchal: "05", "jammu kashmir": "01",
  "jammu and kashmir": "01", "andaman nicobar": "35", "dadra and nagar haveli": "26", "daman and diu": "26",
};

// The state (code and name) a GSTIN or a state name points to, or null.
const stateOf = ({ gstin, name } = {}) => {
  if (isGstin(gstin)) {
    const code = gstin.trim().slice(0, 2);
    return { code, name: STATES[code] };
  }
  const key = normalise(name);
  const code = key && (BY_NAME.get(key) || ALIASES[key]);
  return code ? { code, name: STATES[code] } : null;
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Splits GST for a sale. `gst` is the whole tax in rupees.
// intra-state: { cgst, sgst, igst: 0 }, inter-state: { cgst: 0, sgst: 0, igst }.
const splitTax = ({ gst, sellerState, buyerState }) => {
  if (sellerState && buyerState && sellerState.code === buyerState.code) {
    // The same split as the website's calculator, so the invoice shows what the customer was quoted.
    const cgst = round2(Math.round(gst / 2));
    return { taxType: "INTRA", cgst, sgst: round2(gst - cgst), igst: 0 };
  }
  return { taxType: "INTER", cgst: 0, sgst: 0, igst: round2(gst) };
};

// The same split for amounts that carry paise (goods invoices): halves to the paisa; CGST + SGST always add up to the whole tax.
const splitTaxExact = ({ gst, sellerState, buyerState }) => {
  if (sellerState && buyerState && sellerState.code === buyerState.code) {
    const cgst = round2(gst / 2);
    return { taxType: "INTRA", cgst, sgst: round2(gst - cgst), igst: 0 };
  }
  return { taxType: "INTER", cgst: 0, sgst: 0, igst: round2(gst) };
};

// "SP/26-27/00001" parts: the financial year (April to March) a local date text such as "2026-10-05" falls in.
const financialYear = (dateText) => {
  const [year, month] = dateText.split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
};

module.exports = { STATES, isGstin, stateOf, splitTax, splitTaxExact, financialYear, round2 };
