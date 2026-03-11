"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, newId, toLegacyOrder, legacyOrderStatusToDb, } = require("../utils/prismaLegacy");
const { generateReceipt } = require("../utils/receiptGenerator");
const isProductAvailableForOnlinePurchase = (product) => {
    if (!product || !product.isActiveOnline)
        return false;
    if (Number(product.quantityAvailable || 0) > 0)
        return true;
    return (product.branchInventories || []).some((entry) => entry?.branch?.isOnline && Number(entry.quantity || 0) > 0);
};
const normalizeAddressValue = (value) => (value || "").toString().trim().toLowerCase();
const isSameAddress = (a, b) => {
    const fields = [
        "fullName",
        "addressLine1",
        "addressLine2",
        "city",
        "state",
        "country",
        "postalCode",
        "phone",
    ];
    return fields.every((field) => normalizeAddressValue(a[field]) === normalizeAddressValue(b[field]));
};
const requiredShippingFields = [
    "fullName",
    "addressLine1",
    "city",
    "state",
    "country",
    "postalCode",
    "phone",
];
const formatShipping = (shippingAddress = {}) => ({
    shippingFullName: shippingAddress.fullName || null,
    shippingAddressLine1: shippingAddress.addressLine1 || null,
    shippingAddressLine2: shippingAddress.addressLine2 || null,
    shippingCity: shippingAddress.city || null,
    shippingState: shippingAddress.state || null,
    shippingCountry: shippingAddress.country || null,
    shippingPostalCode: shippingAddress.postalCode || null,
    shippingPhone: shippingAddress.phone || null,
});
const saveAddressIfNew = async (userId, shippingAddress) => {
    if (!shippingAddress)
        return;
    const addresses = await prisma.shippingAddress.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const hasAddress = addresses.some((address) => isSameAddress(address, shippingAddress));
    if (!hasAddress) {
        await prisma.shippingAddress.create({
            data: {
                id: newId(),
                userId,
                fullName: shippingAddress.fullName || "",
                addressLine1: shippingAddress.addressLine1 || "",
                addressLine2: shippingAddress.addressLine2 || "",
                city: shippingAddress.city || "",
                state: shippingAddress.state || "",
                country: shippingAddress.country || "",
                postalCode: shippingAddress.postalCode || "",
                phone: shippingAddress.phone || "",
                sortOrder: addresses.length,
            },
        });
    }
};
// =========================
// Create a new order
// =========================
exports.createOrder = async (req, res) => {
    try {
        if (req.user.role !== "customer") {
            return res.status(403).json({ message: "Only customers can place orders" });
        }
        const { products, shippingAddress, paymentMethod } = req.body;
        if (!products || products.length === 0) {
            return res.status(400).json({ message: "No products in order" });
        }
        const hasShipping = requiredShippingFields.every((field) => shippingAddress && shippingAddress[field]);
        if (!hasShipping) {
            return res.status(400).json({ message: "Shipping address is required" });
        }
        let subtotal = 0;
        let taxAmount = 0;
        const orderProducts = [];
        let defaultTaxRate = await prisma.taxRate.findFirst({
            where: { isDefault: true },
            orderBy: { effectiveFrom: "desc" },
        });
        if (!defaultTaxRate) {
            defaultTaxRate = await prisma.taxRate.findFirst({
                where: { effectiveFrom: { lte: new Date() } },
                orderBy: { effectiveFrom: "desc" },
            });
        }
        const defaultRateValue = defaultTaxRate?.rate || 0;
        const taxRateCache = new Map();
        for (const item of products) {
            const productId = item.product || item.productId;
            const product = await prisma.product.findUnique({
                where: { id: productId },
                include: {
                    branchInventories: {
                        where: { quantity: { gt: 0 } },
                        select: {
                            quantity: true,
                            branch: { select: { isOnline: true } },
                        },
                    },
                },
            });
            if (!product)
                return res.status(404).json({ message: "Product not found" });
            if (!isProductAvailableForOnlinePurchase(product)) {
                return res
                    .status(400)
                    .json({ message: `${product.title} is not available for online purchase` });
            }
            const quantity = Number(item.quantity) || 1;
            const lineTotal = product.price * quantity;
            orderProducts.push({
                id: newId(),
                productId: product.id,
                title: product.title,
                price: product.price,
                quantity,
            });
            subtotal += lineTotal;
            if ((product.taxCategory || "STANDARD").toUpperCase() === "STANDARD") {
                let rateValue = defaultRateValue;
                if (product.taxRateId) {
                    const key = product.taxRateId;
                    if (taxRateCache.has(key)) {
                        rateValue = taxRateCache.get(key);
                    }
                    else {
                        const rateDoc = await prisma.taxRate.findUnique({
                            where: { id: key },
                            select: { rate: true },
                        });
                        rateValue = rateDoc?.rate || defaultRateValue;
                        taxRateCache.set(key, rateValue);
                    }
                }
                taxAmount += (lineTotal * rateValue) / 100;
            }
        }
        const totalPrice = subtotal + taxAmount;
        const onlineBranch = await prisma.branch.findFirst({
            where: { isOnline: true },
            select: { id: true },
        });
        const order = await prisma.order.create({
            data: {
                id: newId(),
                userId: req.user.id,
                branchId: onlineBranch?.id || null,
                originBranchId: onlineBranch?.id || null,
                paymentMethod: paymentMethod || "Cash on Delivery",
                subtotal,
                taxAmount,
                discountAmount: 0,
                totalPrice,
                ...formatShipping(shippingAddress),
                items: { create: orderProducts },
            },
            include: {
                items: true,
            },
        });
        await saveAddressIfNew(req.user.id, shippingAddress);
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: req.user.id,
                action: "customer_order_created",
                entityType: "order",
                entityId: order.id,
                branchId: onlineBranch?.id || null,
                message: "Customer placed online order",
            },
        })
            .catch(() => null);
        res.status(201).json(toLegacyOrder(order));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
// =========================
// Get logged in user's orders
// =========================
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                items: { include: { product: true } },
            },
        });
        res.json(orders.map((order) => toLegacyOrder(order)));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
// =========================
// Get a single order by ID
// =========================
exports.getOrderById = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                items: { include: { product: true } },
            },
        });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        if (order.userId !== req.user.id) {
            return res.status(403).json({ message: "Access denied" });
        }
        res.json(toLegacyOrder(order));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
// =========================
// Update order (admin or user can update certain fields)
// =========================
exports.updateOrder = async (req, res) => {
    try {
        const { shippingAddress, paymentMethod, orderStatus } = req.body;
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            select: { id: true, orderStatus: true },
        });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        const updateData = {};
        if (orderStatus && req.user.isAdmin) {
            updateData.orderStatus = legacyOrderStatusToDb(orderStatus);
        }
        if (order.orderStatus !== "DELIVERED") {
            if (shippingAddress) {
                Object.assign(updateData, formatShipping(shippingAddress));
            }
            if (paymentMethod)
                updateData.paymentMethod = paymentMethod;
        }
        const updated = await prisma.order.update({
            where: { id: req.params.id },
            data: updateData,
            include: {
                items: { include: { product: true } },
            },
        });
        res.json(toLegacyOrder(updated));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                user: {
                    select: { id: true, name: true, email: true, phone: true, role: true },
                },
                items: { include: { product: true } },
            },
        });
        res.json(orders.map((order) => toLegacyOrder(order)));
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
// =========================
// Get receipt (customer)
// =========================
exports.getReceipt = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: {
                user: { select: { id: true, name: true, email: true, phone: true, role: true } },
                branch: { select: { id: true, name: true } },
                items: {
                    include: {
                        product: { select: { id: true, title: true, price: true, images: true } },
                    },
                },
            },
        });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        if (order.userId !== req.user.id) {
            return res.status(403).json({ message: "Access denied" });
        }
        await generateReceipt({
            res,
            order: toLegacyOrder(order),
            issuerName: "Online",
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
