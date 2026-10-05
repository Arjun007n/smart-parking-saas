// FASTag charging: taking a parking fee from the toll tag on a windscreen.
//
// The platform cannot do this alone. Charging a tag goes through a bank or a NETC
// (NPCI) acquirer that has signed an agreement with you and gives you credentials.
// This file is the one place that talks to such a partner; the rest of the app only
// asks "charge this tag this amount" and gets back SUCCESS, FAILED or UNKNOWN.
//
// FASTAG_PROVIDER chooses what happens:
//   none       (default) nothing is charged. FASTag stays a payment method the operator
//              records, exactly like before.
//   simulated  a pretend partner for trying the screens, no real money; never in production.
//              Tag ids ending in F are declined, ending in U are "unknown" for a few seconds, then succeed.
//   http       a partner that offers the small JSON contract below (your acquirer, or a thin
//              adapter you put in front of its own API). Needs FASTAG_API_URL.
//
// The contract (all amounts in rupees; "reference" is OUR id for the attempt and is the
// idempotency key: asking twice with the same reference must never charge twice):
//   POST {FASTAG_API_URL}/charges
//        { reference, tagId, vehicleNumber, amount, description }
//     -> 200 { status: "SUCCESS"|"FAILED"|"PENDING", providerReference?, reason? }
//   GET  {FASTAG_API_URL}/charges/{reference}
//     -> 200 { status: "SUCCESS"|"FAILED"|"PENDING", providerReference?, reason? }
//     -> 404 when the partner never saw that reference (the charge did not happen)
// A reply of PENDING, a timeout, or a 5xx is "UNKNOWN": the app asks again by reference
// and never charges a second time until the first attempt is settled.
// Header: Authorization: Bearer {FASTAG_API_KEY}

const crypto = require("crypto");

const providerName = () => (process.env.FASTAG_PROVIDER || "none").trim().toLowerCase();
const timeoutMs = () => Math.min(Math.max(Number(process.env.FASTAG_TIMEOUT_MS) || 8000, 1000), 30000);

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);

const fromPartner = (json) => {
  const status = String(json?.status || "").toUpperCase();
  if (status === "SUCCESS" && typeof json.providerReference === "string" && json.providerReference.trim()) {
    return { status: "SUCCESS", providerReference: json.providerReference.trim().slice(0, 80) };
  }
  // A success without the partner's own reference cannot be reconciled later: treat it as not settled.
  if (status === "SUCCESS") return { status: "UNKNOWN", reason: "The FASTag partner did not return a reference" };
  if (status === "FAILED") return { status: "FAILED", reason: clean(json.reason) || "The FASTag was declined" };
  return { status: "UNKNOWN", reason: "The FASTag partner has not confirmed yet" };
};

const none = {
  name: "none",
  isConfigured: () => false,
  problems: () => [],
};

const simulated = {
  name: "simulated",
  simulated: true,
  isConfigured: () => process.env.NODE_ENV !== "production",
  problems: () => [],
  // Tag ids that end in U answer "unknown" at first and are confirmed a few seconds later
  // (FASTAG_SIM_DELAY_MS, default 5000), however often the app asks in between.
  asked: new Map(),
  delayMs: () => (process.env.FASTAG_SIM_DELAY_MS === undefined ? 5000 : Math.max(0, Number(process.env.FASTAG_SIM_DELAY_MS) || 0)),
  async charge({ reference, tagId }) {
    const last = String(tagId).trim().slice(-1).toUpperCase();
    if (last === "F") return { status: "FAILED", reason: "Insufficient FASTag balance (simulated)" };
    if (last === "U") {
      this.asked.set(reference, Date.now());
      return { status: "UNKNOWN", reason: "The simulated partner did not answer" };
    }
    return { status: "SUCCESS", providerReference: `SIM-${crypto.randomBytes(6).toString("hex").toUpperCase()}` };
  },
  async status({ reference }) {
    if (!this.asked.has(reference)) return { status: "NOT_FOUND" };
    if (Date.now() - this.asked.get(reference) < this.delayMs()) return { status: "UNKNOWN", reason: "The simulated partner has not confirmed yet" };
    this.asked.delete(reference);
    return { status: "SUCCESS", providerReference: `SIM-${crypto.randomBytes(6).toString("hex").toUpperCase()}` };
  },
};

const baseUrl = () => (process.env.FASTAG_API_URL || "").trim().replace(/\/+$/, "");

const http = {
  name: "http",
  isConfigured: () => /^https?:\/\//i.test(baseUrl()) && Boolean(process.env.FASTAG_API_KEY),
  problems() {
    const out = [];
    if (!/^https?:\/\//i.test(baseUrl())) out.push("FASTAG_API_URL must be an http(s) address");
    if (!process.env.FASTAG_API_KEY) out.push("FASTAG_API_KEY is missing");
    if (process.env.NODE_ENV === "production" && baseUrl().startsWith("http://")) out.push("FASTAG_API_URL must be https in production");
    return out;
  },
  async call(method, path, body) {
    let response;
    try {
      response = await fetch(`${baseUrl()}${path}`, {
        method,
        headers: { Authorization: `Bearer ${process.env.FASTAG_API_KEY}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs()),
      });
    } catch {
      return { unknown: true, reason: "The FASTag partner did not answer" };
    }
    const json = await response.json().catch(() => ({}));
    return { response, json };
  },
  async charge({ reference, tagId, vehicleNumber, amount, description }) {
    const { unknown, reason, response, json } = await this.call("POST", "/charges", { reference, tagId, vehicleNumber, amount, description });
    if (unknown) return { status: "UNKNOWN", reason };
    // A 4xx was refused outright (bad tag, no balance); anything else may have been applied.
    if (!response.ok) {
      return response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
        ? { status: "FAILED", reason: clean(json?.reason) || "The FASTag partner refused the charge" }
        : { status: "UNKNOWN", reason: "The FASTag partner had a problem" };
    }
    return fromPartner(json);
  },
  async status({ reference }) {
    const { unknown, reason, response, json } = await this.call("GET", `/charges/${encodeURIComponent(reference)}`);
    if (unknown) return { status: "UNKNOWN", reason };
    if (response.status === 404) return { status: "NOT_FOUND" };
    if (!response.ok) return { status: "UNKNOWN", reason: "The FASTag partner had a problem" };
    return fromPartner(json);
  },
};

const PROVIDERS = { none, simulated, http };
const isKnownProvider = (name = providerName()) => Object.prototype.hasOwnProperty.call(PROVIDERS, name);
const provider = () => PROVIDERS[providerName()] || none;
const isConfigured = () => provider().isConfigured();

module.exports = { PROVIDERS, providerName, isKnownProvider, provider, isConfigured, fromPartner };
