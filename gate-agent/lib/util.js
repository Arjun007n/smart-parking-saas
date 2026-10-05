const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rejects when `work` takes longer than `ms`.
const withTimeout = (work, ms, label = "Operation") =>
  Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms).unref()),
  ]);

const hexToBuffer = (hex, label = "hex") => {
  const clean = String(hex || "").replace(/[\s:,-]|0x/gi, "");
  if (!clean || clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error(`${label} is not valid hex`);
  return Buffer.from(clean, "hex");
};

// Splits a command line into words. Double quotes keep a path with spaces together, which
// Windows needs ("C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe" -i ...). Backslashes stay as they are.
const splitCommand = (text) => {
  const words = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) words.push(match[1] !== undefined ? match[1] : match[2]);
  return words;
};

module.exports = { sleep, withTimeout, hexToBuffer, splitCommand };
