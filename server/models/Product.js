const mongoose = require("mongoose");

// One item in the hardware shop. The platform (Super Admin) keeps the list.
//
// A product with no price is shown as "ask for a price" and cannot be put in the cart: we never show
// a price nobody set. `price` is in rupees, before GST. `stock` null means "supplied to order"
// (no count kept); a number is counted down as orders are paid.
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, required: true, trim: true, maxlength: 60, index: true },
    brand: { type: String, trim: true, maxlength: 60 },
    modelNumber: { type: String, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 1500 },
    highlights: { type: [{ type: String, trim: true, maxlength: 120 }], default: [], validate: (v) => v.length <= 8 },
    imageUrl: { type: String, trim: true, maxlength: 500 },
    price: { type: Number, min: 0, default: null },
    gstPercent: { type: Number, enum: [0, 5, 12, 18, 28], default: 18 },
    hsn: { type: String, trim: true, maxlength: 10 },
    stock: { type: Number, min: 0, default: null },
    maxPerOrder: { type: Number, min: 1, max: 100, default: 20 },
    // True when the software already works with this item (the same flag the website shows as "Works today").
    worksWithSoftware: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productSchema.index({ isActive: 1, sortOrder: 1, name: 1 });

// Can this be bought online right now?
productSchema.methods.canBuy = function canBuy() {
  return this.isActive && typeof this.price === "number" && this.price > 0 && (this.stock === null || this.stock === undefined || this.stock > 0);
};

module.exports = mongoose.model("Product", productSchema);
