const Paystack = require("paystack-node");
const paystack = new Paystack(process.env.PAYSTACK_SECRET_KEY);
const { prisma, toLegacyOrder } = require("../utils/prismaLegacy");

// Initialize payment
exports.initiatePayment = async (req, res) => {
  const { email, orderId } = req.body;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, totalPrice: true },
  });
  if (!order) return res.status(404).json({ message: "Order not found" });

  try {
    const response = await paystack.transaction.initialize({
      email,
      amount: order.totalPrice * 100, // in kobo
      metadata: { orderId: order.id },
    });

    res.json({ authorization_url: response.data.authorization_url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Verify payment
exports.verifyPayment = async (req, res) => {
  const { reference } = req.body;

  try {
    const response = await paystack.transaction.verify({ reference });
    const orderId = response.data.metadata.orderId;

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: "PAID" },
      include: {
        items: true,
      },
    });

    const legacyOrder = toLegacyOrder(order);
    legacyOrder.paymentStatus = "Paid";

    res.json({ message: "Payment successful", order: legacyOrder });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export {};
