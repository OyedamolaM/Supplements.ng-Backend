const mongoose = require("mongoose");

const supplierInvoiceSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    invoiceNumber: { type: String, default: "" },
    reference: { type: String, default: "" },
    dateSupplied: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        description: { type: String, default: "" },
        quantity: { type: Number, required: true },
        unitCost: { type: Number, required: true },
        total: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["unpaid", "partial", "paid", "overdue"],
      default: "unpaid",
    },
    payments: [
      {
        amount: { type: Number, required: true },
        method: { type: String, default: "" },
        reference: { type: String, default: "" },
        note: { type: String, default: "" },
        date: { type: Date, default: Date.now },
      },
    ],
    attachments: [
      {
        url: { type: String, required: true },
        publicId: { type: String, default: "" },
        fileName: { type: String, default: "" },
        mimeType: { type: String, default: "" },
      },
    ],
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupplierInvoice", supplierInvoiceSchema);
