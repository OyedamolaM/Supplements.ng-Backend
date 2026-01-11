const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  costPrice: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 },
  expiryDate: { type: Date },
  stock: { type: Number, default: 0 },
  quantityAvailable: { type: Number, default: 0 },
  sku: { type: String, default: '' },
  batchNumber: { type: String, default: '' },
  barcode: { type: String, default: '' },
  supplier: { type: String, default: '' },
  reorderLevel: { type: Number, default: 0 },
  taxCategory: { type: String, enum: ['standard', 'exempt', 'zero'], default: 'standard' },
  taxRate: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxRate', default: null },
  dosageForm: { type: String, default: '' },
  strength: { type: String, default: '' },
  packSize: { type: String, default: '' },
  manufacturer: { type: String, default: '' },
  images: { type: [String], default: [] },
  category: { type: String, default: 'General' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
