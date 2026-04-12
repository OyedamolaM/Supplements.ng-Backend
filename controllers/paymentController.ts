const Paystack = require("paystack-node");
const paystackSecret = (process.env.PAYSTACK_SECRET_KEY || "").toString().trim();
const paystack = new Paystack(paystackSecret);
const { prisma, toLegacyOrder } = require("../utils/prismaLegacy");
const { generateReceiptBuffer } = require("../utils/receiptGenerator");
const {
  sendBrevoEmail,
  buildReceiptEmail,
} = require("../services/emailService");

const normalizeChannels = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
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
  if (!paystackSecret) {
    return res.status(500).json({ message: "PAYSTACK_SECRET_KEY is not configured" });
  }
  const { orderId, channels } = req.body;
  const email = (req.user?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ message: "Missing customer email" });
  if (!orderId) return res.status(400).json({ message: "Order ID is required" });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, totalPrice: true, userId: true, paymentStatus: true },
  });
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (order.userId !== req.user?.id && !req.user?.isAdmin) {
    return res.status(403).json({ message: "Access denied" });
  }
  if (order.paymentStatus === "PAID") {
    return res.status(400).json({ message: "Order has already been paid" });
  }

  try {
    const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
    const callbackUrl = clientUrl
      ? `${clientUrl}/confirmation?orderId=${encodeURIComponent(order.id)}&total=${encodeURIComponent(
          order.totalPrice
        )}`
      : null;

    const normalizedChannels = normalizeChannels(channels);

    const amountKobo = Math.round(Number(order.totalPrice || 0) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      return res.status(400).json({ message: "Invalid order amount" });
    }

    const response = await paystack.transaction.initialize({
      email,
      amount: amountKobo, // in kobo
      metadata: { orderId: order.id },
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      ...(normalizedChannels ? { channels: normalizedChannels } : {}),
    });

    if (!response?.data?.authorization_url) {
      return res.status(502).json({
        message: "Unable to initialize payment",
        details: response?.message || response,
      });
    }

    res.json({ authorization_url: response.data.authorization_url });
  } catch (err) {
    console.error("Paystack init error", err);
    res.status(500).json({ message: err.message || "Payment initialization failed" });
  }
};

// Verify payment
exports.verifyPayment = async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ message: "Payment reference is required" });

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
    if (!existingOrder) return res.status(404).json({ message: "Order not found" });
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
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
      },
    });

    const legacyOrder = toLegacyOrder(order);
    legacyOrder.paymentStatus = "Paid";

    if (order.user?.email) {
      const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
      const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
      try {
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
      } catch (emailError) {
        console.error("Receipt email failed", emailError);
      }
    }

    res.json({ message: "Payment successful", order: legacyOrder });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
