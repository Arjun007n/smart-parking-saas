const mongoose = require("mongoose");

// A price the Super Admin changed on the add-on list (rupees per month, before GST). Add-ons without a row use config/addons.js.
const addonPriceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    price: { type: Number, required: true, min: 0, max: 1000000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AddonPrice", addonPriceSchema);
