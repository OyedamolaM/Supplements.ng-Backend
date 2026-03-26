"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Paystack = require("paystack-node");
const paystack = new Paystack(process.env.PAYSTACK_SECRET_KEY);
const { prisma, toLegacyOrder } = require("../utils/prismaLegacy");
const normalizeChannels = (value) => {
    if (value === undefined || value === null || value === "")
        return undefined;
    const allowed = new Set([
        "card",
        "bank_transfer",
        "ussd",
        "bank",
        "qr",
        "mobile_money",
        "eft",
    ]);
    const raw = Array.isArray(value) ? value : [value];
    const normalized = raw
        .map((item) => (item ?? "").toString().trim().toLowerCase())
        .filter(Boolean)
        .filter((item) => allowed.has(item));
    return normalized.length > 0 ? normalized : undefined;
};
// Initialize payment
exports.initiatePayment = async (req, res) => {
    const { orderId, channels } = req.body;
    const email = (req.user?.email || "").toString().trim().toLowerCase();
    if (!email)
        return res.status(400).json({ message: "Missing customer email" });
    if (!orderId)
        return res.status(400).json({ message: "Order ID is required" });
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, totalPrice: true, userId: true, paymentStatus: true },
    });
    if (!order)
        return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user?.id && !req.user?.isAdmin) {
        return res.status(403).json({ message: "Access denied" });
    }
    if (order.paymentStatus === "PAID") {
        return res.status(400).json({ message: "Order has already been paid" });
    }
    try {
        const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
        const callbackUrl = clientUrl
            ? `${clientUrl}/confirmation?orderId=${encodeURIComponent(order.id)}&total=${encodeURIComponent(order.totalPrice)}`
            : null;
        const normalizedChannels = normalizeChannels(channels);
        const response = await paystack.transaction.initialize({
            email,
            amount: order.totalPrice * 100, // in kobo
            metadata: { orderId: order.id },
            ...(callbackUrl ? { callback_url: callbackUrl } : {}),
            ...(normalizedChannels ? { channels: normalizedChannels } : {}),
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
    if (!reference)
        return res.status(400).json({ message: "Payment reference is required" });
    try {
        const response = await paystack.transaction.verify({ reference });
        if (!response?.data) {
            return res.status(500).json({ message: "Invalid verification response" });
        }
        if (response.data.status !== "success") {
            return res.status(400).json({ message: "Payment not successful", status: response.data.status });
        }
        const metadata = response.data.metadata || {};
        const orderId = metadata.orderId || metadata.order_id;
        if (!orderId) {
            return res.status(400).json({ message: "Missing order reference in payment metadata" });
        }
        const existingOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, userId: true, totalPrice: true, paymentStatus: true },
        });
        if (!existingOrder)
            return res.status(404).json({ message: "Order not found" });
        if (existingOrder.userId !== req.user?.id && !req.user?.isAdmin) {
            return res.status(403).json({ message: "Access denied" });
        }
        const expectedAmount = Math.round(Number(existingOrder.totalPrice || 0) * 100);
        const paidAmount = Number(response.data.amount || 0);
        if (expectedAmount > 0 && paidAmount && expectedAmount !== paidAmount) {
            return res.status(400).json({ message: "Payment amount mismatch" });
        }
        if (existingOrder.paymentStatus === "PAID") {
            const paidOrder = await prisma.order.findUnique({
                where: { id: orderId },
                include: { items: true },
            });
            const legacyOrder = toLegacyOrder(paidOrder);
            legacyOrder.paymentStatus = "Paid";
            return res.json({ message: "Payment already verified", order: legacyOrder });
        }
        const order = await prisma.order.update({
            where: { id: orderId },
            data: { paymentStatus: "PAID", paymentMethod: "Paystack" },
            include: {
                items: true,
            },
        });
        const legacyOrder = toLegacyOrder(order);
        legacyOrder.paymentStatus = "Paid";
        res.json({ message: "Payment successful", order: legacyOrder });
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
};
