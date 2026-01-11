const mongoose = require("mongoose");

const taxRateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    rate: { type: Number, required: true }, // percent
    effectiveFrom: { type: Date, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaxRate", taxRateSchema);
