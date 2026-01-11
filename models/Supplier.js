const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    contactName: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    paymentTerms: { type: String, default: "" },
    bankName: { type: String, default: "" },
    accountName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    notes: { type: String, default: "" },
    balance: { type: Number, default: 0 },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);
