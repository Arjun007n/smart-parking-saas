// How a location's tickets and receipts look. Stored on the location
// (`receiptSettings`); anything not set falls back to the defaults below, so
// existing locations print exactly as before.

const DEFAULTS = Object.freeze({
  headerNote: "",
  ticketFooter: "Keep this ticket safe. A lost ticket is charged extra.",
  receiptFooter: "Thank you. Drive safe!",
  showAddress: true,
  showGst: true,
  // DEVICE: follow the gate printer's own "print QR" setting. ON / OFF: always / never.
  showQr: "DEVICE",
});

const QR_MODES = ["DEVICE", "ON", "OFF"];

const resolveReceiptSettings = (raw) => {
  const source = (raw && typeof raw.toObject === "function" ? raw.toObject() : raw) || {};
  const text = (key) => (typeof source[key] === "string" && source[key].trim() ? source[key].trim() : DEFAULTS[key]);
  const flag = (key) => (typeof source[key] === "boolean" ? source[key] : DEFAULTS[key]);
  return {
    headerNote: typeof source.headerNote === "string" ? source.headerNote.trim() : DEFAULTS.headerNote,
    ticketFooter: text("ticketFooter"),
    receiptFooter: text("receiptFooter"),
    showAddress: flag("showAddress"),
    showGst: flag("showGst"),
    showQr: QR_MODES.includes(source.showQr) ? source.showQr : DEFAULTS.showQr,
  };
};

// Whether to print a QR code, given the setting and the gate printer's own switch.
const wantsQr = (settings, deviceSaysYes) =>
  settings.showQr === "ON" ? true : settings.showQr === "OFF" ? false : Boolean(deviceSaysYes);

module.exports = { DEFAULTS, QR_MODES, resolveReceiptSettings, wantsQr };
