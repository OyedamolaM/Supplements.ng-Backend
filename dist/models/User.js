"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, default: '' },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: [
            'customer',
            'super_admin',
            'admin',
            'branch_manager',
            'accountant',
            'inventory_manager',
            'cashier',
            'staff'
        ],
        default: 'customer'
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    region: { type: String, default: '' },
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
    cart: [
        {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
            quantity: { type: Number, default: 1 },
            price: { type: Number, required: true }
        }
    ]
}, { timestamps: true });
// Virtual field: isAdmin
userSchema.virtual('isAdmin').get(function () {
    return this.role === 'admin' || this.role === 'super_admin';
});
// Pre-save: hash password if modified
userSchema.pre('save', async function (next) {
    if (!this.isModified('password'))
        return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    }
    catch (err) {
        next(err);
    }
});
// Compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};
// Ensure virtuals included in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });
module.exports = mongoose.model('User', userSchema);
