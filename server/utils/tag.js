// RFID / UHF tag numbers. Readers print them in many styles ("e2 00 68 06", "E2:00:68:06",
// "0xE2006806"); we compare one form only: capitals, letters and digits.
const normalizeTag = (value) =>
  String(value || "").trim().replace(/^0x/i, "").replace(/[\s:.-]/g, "").toUpperCase();

const TAG = /^[A-Z0-9]{4,48}$/;
const isValidTag = (tag) => TAG.test(tag);

// Returns the cleaned tag, or "" when the text is not a usable tag number.
const cleanTag = (value) => {
  const tag = normalizeTag(value);
  return isValidTag(tag) ? tag : "";
};

module.exports = { normalizeTag, isValidTag, cleanTag };
