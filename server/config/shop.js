// Hardware shop settings that are not products: the delivery charge and the order limits.
// Set in server/.env (see docs/shop.md). Everything has a safe default.

const number = (name, fallback, { min = 0, max = 1e7 } = {}) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

// Flat delivery charge per order, in rupees before GST. 0 means delivery is included in the price.
const shipping = () => ({
  flat: number("SHOP_SHIPPING_FLAT", 0),
  // Orders whose goods come to at least this much (before GST) ship free. 0 turns the rule off.
  freeAbove: number("SHOP_FREE_SHIPPING_ABOVE", 0),
  gstPercent: [0, 5, 12, 18, 28].includes(Number(process.env.SHOP_SHIPPING_GST)) ? Number(process.env.SHOP_SHIPPING_GST) : 18,
});

// Different products in one order (they all have to fit on a one-page invoice).
const MAX_LINES = 15;
const SHOP_LINK_HOURS = () => Math.min(72, Math.max(1, Number(process.env.SHOP_LINK_HOURS) || 24));

module.exports = { shipping, MAX_LINES, SHOP_LINK_HOURS };
