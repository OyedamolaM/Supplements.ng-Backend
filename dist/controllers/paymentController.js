"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Paystack = require('paystack-node');
const paystack = new Paystack(process.env.PAYSTACK_SECRET_KEY);
const Order = require('../models/Order');
// Initialize payment
exports.initiatePayment = async (req, res) => {
    const { email, orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order)
        return res.status(404).json({ message: 'Order not found' });
    try {
        const response = await paystack.transaction.initialize({
            email,
            amount: order.totalPrice * 100, // in kobo
            metadata: { orderId: order._id }
        });
        res.json({ authorization_url: response.data.authorization_url });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
};
// Verify payment
exports.verifyPayment = async (req, res) => {
    const { reference } = req.body;
    try {
        const response = await paystack.transaction.verify({ reference });
        const orderId = response.data.metadata.orderId;
        const order = await Order.findById(orderId);
        order.paymentStatus = 'Paid';
        await order.save();
        res.json({ message: 'Payment successful', order });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
};
