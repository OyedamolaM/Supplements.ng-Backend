"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { generateReceipt } = require('../utils/receiptGenerator');
const ActivityLog = require('../models/ActivityLog');
const TaxRate = require('../models/TaxRate');
const normalizeAddressValue = (value) => (value || '').toString().trim().toLowerCase();
const isSameAddress = (a, b) => {
    const fields = [
        'fullName',
        'addressLine1',
        'addressLine2',
        'city',
        'state',
        'country',
        'postalCode',
        'phone'
    ];
    return fields.every((field) => normalizeAddressValue(a[field]) === normalizeAddressValue(b[field]));
};
// =========================
// Create a new order
// =========================
exports.createOrder = async (req, res) => {
    try {
        if (req.user.role !== 'customer') {
            return res.status(403).json({ message: 'Only customers can place orders' });
        }
        const { products, shippingAddress, paymentMethod } = req.body;
        if (!products || products.length === 0)
            return res.status(400).json({ message: 'No products in order' });
        let totalPrice = 0;
        let subtotal = 0;
        let taxAmount = 0;
        let defaultTaxRate = await TaxRate.findOne({ isDefault: true }).sort({ effectiveFrom: -1 });
        if (!defaultTaxRate) {
            defaultTaxRate = await TaxRate.findOne({ effectiveFrom: { $lte: new Date() } }).sort({
                effectiveFrom: -1,
            });
        }
        const defaultRateValue = defaultTaxRate?.rate || 0;
        const taxRateCache = new Map();
        const orderProducts = [];
        for (const item of products) {
            const product = await Product.findById(item.product);
            if (!product)
                return res.status(404).json({ message: 'Product not found' });
            orderProducts.push({
                product: product._id,
                title: product.title,
                price: product.price,
                quantity: item.quantity || 1
            });
            const quantity = item.quantity || 1;
            const lineTotal = product.price * quantity;
            subtotal += lineTotal;
            if (product.taxCategory === "standard") {
                let rateValue = defaultRateValue;
                if (product.taxRate) {
                    const key = product.taxRate.toString();
                    if (taxRateCache.has(key)) {
                        rateValue = taxRateCache.get(key);
                    }
                    else {
                        const rateDoc = await TaxRate.findById(product.taxRate);
                        rateValue = rateDoc?.rate || defaultRateValue;
                        taxRateCache.set(key, rateValue);
                    }
                }
                taxAmount += (lineTotal * rateValue) / 100;
            }
        }
        totalPrice = subtotal + taxAmount;
        const onlineBranch = await Branch.findOne({ isOnline: true });
        const requiredFields = [
            "fullName",
            "addressLine1",
            "city",
            "state",
            "country",
            "postalCode",
            "phone",
        ];
        const hasShipping = requiredFields.every((field) => shippingAddress && shippingAddress[field]);
        if (!hasShipping) {
            return res.status(400).json({ message: "Shipping address is required" });
        }
        const order = await Order.create({
            user: req.user._id,
            branch: onlineBranch?._id,
            originBranch: onlineBranch?._id,
            products: orderProducts,
            shippingAddress,
            paymentMethod: paymentMethod || 'Cash on Delivery',
            subtotal,
            taxAmount,
            discountAmount: 0,
            totalPrice
        });
        if (shippingAddress) {
            const customer = await User.findById(req.user._id);
            if (customer) {
                const hasAddress = customer.shippingAddresses?.some((address) => isSameAddress(address, shippingAddress));
                if (!hasAddress) {
                    customer.shippingAddresses.push(shippingAddress);
                    await customer.save();
                }
            }
        }
        ActivityLog.create({
            user: req.user._id,
            action: "customer_order_created",
            entityType: "order",
            entityId: order._id,
            branch: onlineBranch?._id || null,
            message: "Customer placed online order"
        }).catch(() => null);
        res.status(201).json(order);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// =========================
// Get logged-in user's orders
// =========================
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id }).populate("products.product", "title price images");
        res.json(orders);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// =========================
// Get a single order by ID
// =========================
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate("products.product", "title price images");
        if (!order)
            return res.status(404).json({ message: 'Order not found' });
        // Ensure user can only access their own orders
        if (order.user.toString() !== req.user._id.toString())
            return res.status(403).json({ message: 'Access denied' });
        res.json(order);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// =========================
// Update order (admin or user can update certain fields)
// =========================
exports.updateOrder = async (req, res) => {
    try {
        const { shippingAddress, paymentMethod, orderStatus } = req.body;
        const order = await Order.findById(req.params.id);
        if (!order)
            return res.status(404).json({ message: 'Order not found' });
        // Only admin can update status
        if (orderStatus && req.user.isAdmin) {
            order.orderStatus = orderStatus;
        }
        // Users can update shipping address or payment method if not yet delivered
        if (order.orderStatus !== 'Delivered') {
            if (shippingAddress)
                order.shippingAddress = shippingAddress;
            if (paymentMethod)
                order.paymentMethod = paymentMethod;
        }
        await order.save();
        res.json(order);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find().populate('user', 'name email phone');
        res.json(orders);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
};
// =========================
// Get receipt (customer)
// =========================
exports.getReceipt = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate("user", "name email phone")
            .populate("branch", "name");
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        const orderUserId = order.user?._id
            ? order.user._id.toString()
            : order.user.toString();
        if (orderUserId !== req.user._id.toString()) {
            return res.status(403).json({ message: "Access denied" });
        }
        await generateReceipt({
            res,
            order,
            issuerName: "Online",
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
