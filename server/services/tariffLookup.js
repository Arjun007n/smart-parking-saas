const Tariff = require("../models/Tariff");
const { selectTariff } = require("./tariffService");

// Finds the tariff that applies to a stay: active tariffs of the location and
// vehicle type, chosen by the rules in tariffService.selectTariff.
const findTariffFor = async ({ companyId, locationId, vehicleType, entryTime }) => {
  const candidates = await Tariff.find({ companyId, locationId, vehicleType, isActive: true });
  return selectTariff(candidates, entryTime);
};

module.exports = { findTariffFor };
