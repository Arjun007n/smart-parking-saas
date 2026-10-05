// What a plan costs. Prices are in rupees, before GST.
//
// KEEP IN STEP WITH THE WEBSITE: the plan cards and the price calculator on the public site read the same
// numbers from client/src/data/site.js (PRICING). tests/billing.test.js fails when the two differ.
//
// One plan is for sale today: "Parking Management", priced per user per month. Paying for more months at
// once gives a discount. Valet management is not built, so it cannot be bought.

const PRICING = Object.freeze({
  parkingPerUserMonth: 499,
  gstPercent: 18,
  tenures: Object.freeze([
    { months: 1, discount: 0 },
    { months: 3, discount: 5 },
    { months: 6, discount: 10 },
    { months: 12, discount: 20 },
    { months: 24, discount: 30 },
    { months: 36, discount: 40 },
    { months: 48, discount: 45 },
    { months: 60, discount: 50 },
  ]),
});

const PLAN_NAME = "Parking Management";
const MIN_USERS = 1;
const MAX_USERS = 500;
// The plan is priced by users, not by locations, so a paid plan allows a generous number of them.
const PAID_MAX_LOCATIONS = 1000;

// users x months x price per user, less the discount for the chosen number of months, plus GST.
// Whole rupees, rounded the same way as the website's calculator (client/src/utils/planPrice.js).
const planPrice = ({ users, months }) => {
  const tenure = PRICING.tenures.find((t) => t.months === months);
  if (!tenure) throw new RangeError(`Plan length of ${months} months is not offered`);
  const subtotal = PRICING.parkingPerUserMonth * users * months;
  const discount = Math.round((subtotal * tenure.discount) / 100);
  const gross = subtotal - discount;
  const gst = Math.round((gross * PRICING.gstPercent) / 100);
  const cgst = Math.round(gst / 2);
  return {
    subtotal, discount, gross, gst, cgst, sgst: gst - cgst, total: gross + gst,
    perMonth: Math.round(gross / months), discountPercent: tenure.discount,
  };
};

module.exports = { PRICING, PLAN_NAME, MIN_USERS, MAX_USERS, PAID_MAX_LOCATIONS, planPrice };
