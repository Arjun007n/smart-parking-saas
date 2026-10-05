import { PRICING } from '../data/site'

// Works out the price of a plan: users x months x price per user, less the discount for the
// chosen number of months, plus GST. The prices come from PRICING in data/site.js.
export function planPrice({ users, months, perUserMonth = PRICING.parkingPerUserMonth }) {
  const tenure = PRICING.tenures.find((t) => t.months === months) || PRICING.tenures[0]
  const subtotal = perUserMonth * users * months
  const discount = Math.round((subtotal * tenure.discount) / 100)
  const gross = subtotal - discount
  const gst = Math.round((gross * PRICING.gstPercent) / 100)
  return { subtotal, discount, gross, cgst: Math.round(gst / 2), sgst: gst - Math.round(gst / 2), gst, total: gross + gst, perMonth: Math.round(gross / months), discountPercent: tenure.discount }
}


// "1 month", "6 months", "1 year", "2 years": how a plan length is written on the site.
export const planLabel = (months) => (months === 1 ? '1 month' : months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`)
