// Rupee amounts in words, Indian style (lakh, crore): 1234.5 -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only".
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below1000 = (n) => {
  const parts = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
};

const wholeNumber = (n) => {
  if (n === 0) return "Zero";
  const units = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]];
  const parts = [];
  for (const [size, label] of units) {
    if (n >= size) { parts.push(`${below1000(Math.floor(n / size))} ${label}`); n %= size; }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
};

const rupeesInWords = (amount) => {
  const paise = Math.round(Math.abs(Number(amount) || 0) * 100);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${wholeNumber(rupees)}${rest ? ` and ${wholeNumber(rest)} Paise` : ""} Only`;
};

module.exports = { rupeesInWords };
