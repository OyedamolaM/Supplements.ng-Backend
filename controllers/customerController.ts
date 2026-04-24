const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");
const {
  subscribeToNewsletter,
  getNewsletterFirstOrderDiscountPercent,
  normalizeNewsletterEmail,
} = require("../services/newsletterService");

const normalizeAddress = (payload: any = {}) => ({
  fullName: payload.fullName || "",
  addressLine1: payload.addressLine1 || "",
  addressLine2: payload.addressLine2 || "",
  city: payload.city || "",
  state: payload.state || "",
  country: payload.country || "",
  postalCode: payload.postalCode || "",
  phone: payload.phone || "",
});

const loadAddresses = async (userId) => {
  const addresses = await prisma.shippingAddress.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return addresses.map((address) => ({
    _id: address.id,
    id: address.id,
    fullName: address.fullName,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 || "",
    city: address.city,
    state: address.state,
    country: address.country,
    postalCode: address.postalCode,
    phone: address.phone,
  }));
};

exports.subscribeNewsletter = async (req, res) => {
  try {
    const email = normalizeNewsletterEmail(req.body?.email);
    const { subscriber, created } = await subscribeToNewsletter(email);
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    const hasOrderHistory = existingUser
      ? (await prisma.order.count({ where: { userId: existingUser.id } })) > 0
      : false;
    const discountPercent = Number(
      subscriber.firstOrderDiscountPercent || getNewsletterFirstOrderDiscountPercent()
    );
    const firstOrderDiscountUsed = Boolean(subscriber.firstOrderDiscountUsedAt);
    const eligibleForFirstOrderDiscount =
      subscriber.isActive && !firstOrderDiscountUsed && !hasOrderHistory;

    let message = `Subscribed successfully. You will receive ${discountPercent}% off your first order.`;
    if (!created && eligibleForFirstOrderDiscount) {
      message = `Already subscribed. Your ${discountPercent}% first-order discount is still available.`;
    } else if (!created && !eligibleForFirstOrderDiscount) {
      message = "Already subscribed. Your first-order newsletter discount is no longer available.";
    }

    res.status(created ? 201 : 200).json({
      message,
      email: subscriber.email,
      discountPercent,
      eligibleForFirstOrderDiscount,
      firstOrderDiscountUsed,
    });
  } catch (error) {
    res.status(error?.status || 500).json({ message: error.message });
  }
};

exports.addShippingAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const count = await prisma.shippingAddress.count({ where: { userId } });
    await prisma.shippingAddress.create({
      data: {
        id: newId(),
        userId,
        ...normalizeAddress(req.body),
        sortOrder: count,
      },
    });
    res.status(201).json(await loadAddresses(userId));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateShippingAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const index = Number(req.params.index);
    const addresses = await prisma.shippingAddress.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });

    if (!addresses[index]) return res.status(404).json({ message: "Address not found" });

    await prisma.shippingAddress.update({
      where: { id: addresses[index].id },
      data: normalizeAddress(req.body),
    });
    res.json(await loadAddresses(userId));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteShippingAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const index = Number(req.params.index);
    const addresses = await prisma.shippingAddress.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });

    if (!addresses[index]) return res.status(404).json({ message: "Address not found" });

    await prisma.shippingAddress.delete({ where: { id: addresses[index].id } });
    const updated = await prisma.shippingAddress.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    await Promise.all(
      updated.map((address, sortOrder) =>
        prisma.shippingAddress.update({
          where: { id: address.id },
          data: { sortOrder },
        })
      )
    );

    res.json(await loadAddresses(userId));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getShippingAddresses = async (req, res) => {
  try {
    res.json(await loadAddresses(req.user.id));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: "Product is required" });

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    await prisma.userWishlistItem.upsert({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
      create: {
        id: newId(),
        userId,
        productId,
      },
      update: {},
    });

    const items = await prisma.userWishlistItem.findMany({
      where: { userId },
      select: { productId: true },
    });
    res.json(items.map((item) => item.productId));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ message: "Product is required" });

    await prisma.userWishlistItem.deleteMany({
      where: { userId, productId },
    });

    const items = await prisma.userWishlistItem.findMany({
      where: { userId },
      select: { productId: true },
    });
    res.json(items.map((item) => item.productId));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getWishlist = async (req, res) => {
  try {
    const items = await prisma.userWishlistItem.findMany({
      where: { userId: req.user.id },
      include: {
        product: true,
      },
    });
    res.json(items.map((item) => toLegacyProduct(item.product)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
