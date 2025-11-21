const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user','admin'], default: 'user' },
  shippingAddresses: [
  {
    fullName: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    postalCode: { type: String, required: true },
    phone: { type: String, required: true }
  }
],

wishlist: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }
],
createdAt: { type: Date, default: Date.now }

});

module.exports = mongoose.model('User', userSchema);
