"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Paystack = require("paystack-node");
const paystackSecret = (process.env.PAYSTACK_SECRET_KEY || "").toString().trim();
const paystack = new Paystack(paystackSecret);
const { prisma, toLegacyOrder, newId } = require("../utils/prismaLegacy");
const { generateReceiptBuffer } = require("../utils/receiptGenerator");
const { sendBrevoEmail, buildOrderConfirmationEmail, buildReceiptEmail, } = require("../services/emailService");
const { sendOrderStatusWhatsApp } = require("../services/whatsappService");
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
const appendPaymentAttempt = (meta = {}, attempt = {}) => {
    const existing = Array.isArray(meta?.paymentAttempts) ? meta.paymentAttempts : [];
    return {
        ...(meta || {}),
        paymentAttempts: [...existing, attempt],
    };
};
const updatePaymentAttemptStatus = (meta = {}, reference, status, extra = {}) => {
    const existing = Array.isArray(meta?.paymentAttempts) ? meta.paymentAttempts : [];
    const updated = existing.map((attempt) => {
        if (attempt?.reference !== reference)
            return attempt;
        return { ...attempt, status, ...extra };
    });
    return {
        ...(meta || {}),
        paymentAttempts: updated,
    };
};
// Initialize payment
exports.initiatePayment = async (req, res) => {
    if (!paystackSecret) {
        return res.status(500).json({ message: "PAYSTACK_SECRET_KEY is not configured" });
    }
    const { orderId, channels, callbackUrl: requestedCallbackUrl } = req.body;
    const email = (req.user?.email || "").toString().trim().toLowerCase();
    if (!email)
        return res.status(400).json({ message: "Missing customer email" });
    if (!orderId)
        return res.status(400).json({ message: "Order ID is required" });
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, totalPrice: true, userId: true, paymentStatus: true, deliveryMeta: true },
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
        const envClientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
        let origin = "";
        const headerOrigin = (req.headers.origin || "").toString().trim().replace(/\/+$/, "");
        if (headerOrigin)
            origin = headerOrigin;
        if (!origin && req.headers.referer) {
            try {
                origin = new URL(req.headers.referer.toString()).origin;
            }
            catch {
                origin = "";
            }
        }
        const baseClientUrl = envClientUrl || origin;
        const defaultCallbackUrl = baseClientUrl
            ? `${baseClientUrl}/confirmation?orderId=${encodeURIComponent(order.id)}&total=${encodeURIComponent(order.totalPrice)}`
            : null;
        let callbackUrl = defaultCallbackUrl;
        if (requestedCallbackUrl) {
            try {
                const parsed = new URL(requestedCallbackUrl.toString());
                const allowedOrigin = baseClientUrl ? new URL(baseClientUrl).origin : "";
                if (!allowedOrigin || parsed.origin === allowedOrigin) {
                    callbackUrl = parsed.toString();
                }
            }
            catch {
                // ignore invalid callback override
            }
        }
        const normalizedChannels = normalizeChannels(channels);
        const amountKobo = Math.round(Number(order.totalPrice || 0) * 100);
        if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
            return res.status(400).json({ message: "Invalid order amount" });
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ message: "Invalid customer email" });
        }
        if (callbackUrl && !/^https?:\/\//.test(callbackUrl)) {
            return res.status(400).json({ message: "Invalid callback URL" });
        }
        const initPayload = {
            email,
            amount: amountKobo, // in kobo
            metadata: { orderId: order.id },
            ...(callbackUrl ? { callback_url: callbackUrl } : {}),
            ...(normalizedChannels ? { channels: normalizedChannels } : {}),
        };
        console.log("Paystack init payload", {
            amount: initPayload.amount,
            callback_url: initPayload.callback_url || null,
            channels: initPayload.channels || null,
            email_domain: email.split("@")[1] || "",
            has_metadata: Boolean(initPayload.metadata),
        });
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${paystackSecret}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(initPayload),
        });
        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error("Paystack init failed", {
                status: response.status,
                body: responseBody,
            });
            return res.status(502).json({
                message: "Unable to initialize payment",
                details: responseBody,
            });
        }
        const authUrl = responseBody?.data?.authorization_url ||
            responseBody?.authorization_url;
        if (!authUrl) {
            const safeDetails = response?.message ||
                (response?.data
                    ? { status: response.data.status, message: response.data.message }
                    : undefined);
            console.error("Paystack init response missing authorization_url", {
                response,
                safeDetails,
            });
            return res.status(502).json({
                message: "Unable to initialize payment",
                ...(safeDetails ? { details: safeDetails } : {}),
            });
        }
        const reference = responseBody?.data?.reference || responseBody?.reference;
        const attempt = {
            reference: reference || null,
            status: "initiated",
            channel: normalizedChannels ? normalizedChannels.join(",") : null,
            initiatedAt: new Date().toISOString(),
        };
        await prisma.order.update({
            where: { id: order.id },
            data: { deliveryMeta: appendPaymentAttempt(order.deliveryMeta, attempt) },
        });
        res.json({ authorization_url: authUrl });
    }
    catch (err) {
        const paystackBody = err?.response?.body || err?.body || err?.response?.data;
        console.error("Paystack init error", {
            name: err?.name,
            message: err?.message,
            stack: err?.stack,
            paystackBody,
        });
        res.status(500).json({
            message: err.message || "Payment initialization failed",
            details: {
                name: err?.name,
                message: err?.message,
                paystackBody,
            },
        });
    }
};
// Verify payment
exports.verifyPayment = async (req, res) => {
    const { reference } = req.body;
    if (!reference)
        return res.status(400).json({ message: "Payment reference is required" });
    try {
        const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${paystackSecret}`,
                "Content-Type": "application/json",
            },
        });
        const verifyBody = await verifyResponse.json().catch(() => ({}));
        if (!verifyResponse.ok) {
            console.error("Paystack verify failed", {
                status: verifyResponse.status,
                body: verifyBody,
            });
            return res.status(502).json({
                message: "Unable to verify payment",
                details: verifyBody,
            });
        }
        const data = verifyBody?.data;
        if (!data) {
            console.error("Paystack verify returned no data", verifyBody);
            return res.status(500).json({ message: "Invalid verification response" });
        }
        if (data.status !== "success") {
            console.error("Paystack verify not successful", {
                status: data.status,
                message: data.message,
                reference,
            });
            let metadata = data.metadata || {};
            if (typeof metadata === "string") {
                try {
                    metadata = JSON.parse(metadata);
                }
                catch {
                    metadata = {};
                }
            }
            const orderId = metadata.orderId || metadata.order_id;
            if (orderId) {
                const existingOrder = await prisma.order.findUnique({
                    where: { id: orderId },
                    select: { deliveryMeta: true },
                });
                if (existingOrder) {
                    await prisma.order.update({
                        where: { id: orderId },
                        data: {
                            deliveryMeta: updatePaymentAttemptStatus(existingOrder.deliveryMeta, reference, "failed", {
                                failureStatus: data.status,
                                updatedAt: new Date().toISOString(),
                            }),
                        },
                    });
                }
            }
            return res.status(400).json({ message: "Payment not successful", status: data.status });
        }
        let metadata = data.metadata || {};
        if (typeof metadata === "string") {
            try {
                metadata = JSON.parse(metadata);
            }
            catch {
                metadata = {};
            }
        }
        const orderId = metadata.orderId || metadata.order_id;
        if (!orderId) {
            return res.status(400).json({ message: "Missing order reference in payment metadata" });
        }
        const existingOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, userId: true, totalPrice: true, paymentStatus: true, deliveryMeta: true },
        });
        if (!existingOrder)
            return res.status(404).json({ message: "Order not found" });
        if (req.user && existingOrder.userId !== req.user?.id && !req.user?.isAdmin) {
            return res.status(403).json({ message: "Access denied" });
        }
        const expectedAmount = Math.round(Number(existingOrder.totalPrice || 0) * 100);
        const paidAmount = Number(data.amount || 0);
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
            data: {
                paymentStatus: "PAID",
                paymentMethod: "Paystack",
                deliveryStatus: "PROCESSING",
                deliveryMeta: updatePaymentAttemptStatus(existingOrder.deliveryMeta, reference, "success", {
                    verifiedAt: new Date().toISOString(),
                }),
            },
            include: {
                items: true,
                user: { select: { id: true, name: true, email: true, phone: true, role: true } },
                branch: true,
                originBranch: true,
            },
        });
        const legacyOrder = toLegacyOrder(order);
        legacyOrder.paymentStatus = "Paid";
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: order.userId,
                action: "order_payment_confirmed",
                entityType: "order",
                entityId: order.id,
                branchId: order.branchId || order.originBranchId || null,
                message: "Payment confirmed for order",
                meta: { paymentStatus: "PAID" },
            },
        })
            .catch(() => null);
        try {
            await prisma.userCartItem.deleteMany({
                where: { userId: order.userId },
            });
        }
        catch (cartError) {
            console.error("Failed to clear cart after payment", cartError);
        }
        if (order.user?.email) {
            const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
            const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
            try {
                const shippingAddress = {
                    fullName: order.shippingFullName,
                    addressLine1: order.shippingAddressLine1,
                    addressLine2: order.shippingAddressLine2,
                    city: order.shippingCity,
                    state: order.shippingState,
                    country: order.shippingCountry,
                    postalCode: order.shippingPostalCode,
                    phone: order.shippingPhone,
                };
                const confirmation = buildOrderConfirmationEmail({
                    name: order.user.name || "Customer",
                    orderId: order.id,
                    items: order.items || [],
                    total: order.totalPrice || 0,
                    paymentMethod: order.paymentMethod || "Paystack",
                    createdAt: order.createdAt,
                    shippingAddress,
                    viewUrl,
                });
                await sendBrevoEmail({
                    to: order.user.email,
                    subject: confirmation.subject,
                    text: confirmation.text,
                    html: confirmation.html,
                    senderKey: "orders",
                });
                const receiptBuffer = await generateReceiptBuffer({
                    order: legacyOrder,
                    issuerName: "Online",
                });
                const { subject, text, html } = buildReceiptEmail({
                    name: order.user.name || "Customer",
                    orderId: order.id,
                    total: order.totalPrice || 0,
                    createdAt: order.createdAt,
                    viewUrl,
                });
                await sendBrevoEmail({
                    to: order.user.email,
                    subject,
                    text,
                    html,
                    senderKey: "orders",
                    attachments: [
                        {
                            name: `receipt-${order.id}.pdf`,
                            content: receiptBuffer.toString("base64"),
                            type: "application/pdf",
                        },
                    ],
                });
            }
            catch (emailError) {
                console.error("Receipt email failed", emailError);
            }
        }
        if (order.user?.phone) {
            sendOrderStatusWhatsApp({
                to: order.user.phone,
                orderId: order.id,
                status: "Processing",
            }).catch((err) => console.error("Order WhatsApp confirmation failed", err));
        }
        res.json({ message: "Payment successful", order: legacyOrder });
    }
    catch (err) {
        console.error("Paystack verify error", err);
        res.status(500).json({ message: err.message });
    }
};
