// The price a vehicle pays for a short stay, per vehicle type, from the location's tariffs. The gate screen on a
// phone shows it on the vehicle type buttons ("Car ₹20"). It is only a guide: the real fee is always worked out
// when the vehicle leaves.
const { selectTariff, calculateFee } = require("../services/tariffService");

// A stay one minute longer than the grace period is the shortest stay that costs anything.
const startingFees = (tariffs, at = new Date()) => {
  const byType = {};
  for (const tariff of tariffs || []) {
    if (!tariff.isActive) continue;
    (byType[tariff.vehicleType] ||= []).push(tariff);
  }
  const fees = {};
  for (const [type, list] of Object.entries(byType)) {
    try {
      const chosen = selectTariff(list, at);
      if (!chosen) continue;
      const minutes = (chosen.gracePeriodMinutes || 0) + 1;
      const result = calculateFee(chosen, { entryTime: at, exitTime: new Date(at.getTime() + minutes * 60000) });
      if (Number.isFinite(result.total)) fees[type] = Math.round(result.total * 100) / 100;
    } catch {
      // A tariff that cannot be worked out simply shows no price.
    }
  }
  return fees;
};

module.exports = { startingFees };
