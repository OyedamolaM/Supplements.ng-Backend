const {
  prisma,
  newId,
  toLegacyOrder,
  legacyOrderStatusToDb,
} = require("../utils/prismaLegacy");
const { generateReceipt } = require("../utils/receiptGenerator");
const {
  sendBrevoEmail,
  buildOrderConfirmationEmail,
} = require("../services/emailService");
const { createFezOrder, trackFezOrder } = require("../services/fezService");

const isProductAvailableForOnlinePurchase = (product) => {
  if (!product || !product.isActiveOnline) return false;
  if (Number(product.quantityAvailable || 0) > 0) return true;
  return (product.branchInventories || []).some(
    (entry) => entry?.branch?.isOnline && Number(entry.quantity || 0) > 0
  );
};

const normalizeAddressValue = (value) =>
  (value || "").toString().trim().toLowerCase();

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

  return fields.every(
    (field) => normalizeAddressValue(a[field]) === normalizeAddressValue(b[field])
  );
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

const FEZ_ENABLED = (process.env.FEZ_ENABLED || "").toString().trim().toLowerCase() === "true";
const COD_ENABLED = FEZ_ENABLED || (process.env.ALLOW_COD || "").toString().trim().toLowerCase() === "true";

const buildOrderItemSnapshot = (product) => ({
  purchaseDate: new Date(),
  packQuantitySnapshot: Number(product.packQuantity || 0),
  unitTypeSnapshot: product.unitType || "",
  recommendedDosageAmountSnapshot: Number(product.recommendedDosageAmount || 0),
  recommendedDosageUnitSnapshot: product.recommendedDosageUnit || "",
  recommendedFrequencyPerDaySnapshot: Number(product.recommendedFrequencyPerDay || 0),
  recommendedUsageTextSnapshot: product.recommendedUsageText || "",
  usageModeSnapshot:
    (product.usageMode || "FIXED").toString().toUpperCase() === "AS_NEEDED"
      ? "AS_NEEDED"
      : "FIXED",
  refillableSnapshot:
    product.refillable === undefined || product.refillable === null
      ? true
      : Boolean(product.refillable),
  reorderableSnapshot:
    product.reorderable === undefined || product.reorderable === null
      ? true
      : Boolean(product.reorderable),
  manualOverrideEnabled: false,
  dosageRecommendedByName: null,
  dosageRecommendedByRole: null,
  dosageRecommendedAt: null,
});

const formatShipping = (shippingAddress: any = {}) => ({
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
  if (!shippingAddress) return;
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

    const hasShipping = requiredShippingFields.every(
      (field) => shippingAddress && shippingAddress[field]
    );
    if (!hasShipping) {
      return res.status(400).json({ message: "Shipping address is required" });
    }

    const normalizedPaymentMethod = (paymentMethod || "Paystack")
      .toString()
      .trim();
    const paymentMethodLower = normalizedPaymentMethod.toLowerCase();
    if (paymentMethodLower.includes("cash") && !COD_ENABLED) {
      return res.status(400).json({
        message: "Cash on delivery is not available for online orders",
      });
    }
    const resolvedPaymentMethod = normalizedPaymentMethod || "Paystack";

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
      if (!product) return res.status(404).json({ message: "Product not found" });
      if (product.deletedAt) {
        return res.status(400).json({ message: `${product.title} is no longer available` });
      }
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
        ...buildOrderItemSnapshot(product),
      });

      subtotal += lineTotal;
      if ((product.taxCategory || "STANDARD").toUpperCase() === "STANDARD") {
        let rateValue = defaultRateValue;
        if (product.taxRateId) {
          const key = product.taxRateId;
          if (taxRateCache.has(key)) {
            rateValue = taxRateCache.get(key);
          } else {
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

    let order = await prisma.order.create({
      data: {
        id: newId(),
        userId: req.user.id,
        branchId: onlineBranch?.id || null,
        originBranchId: onlineBranch?.id || null,
        paymentMethod: resolvedPaymentMethod,
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

    const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
    const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
    const { subject, text, html } = buildOrderConfirmationEmail({
      name: req.user.name || "Customer",
      orderId: order.id,
      items: order.items || [],
      total: order.totalPrice || 0,
      paymentMethod: resolvedPaymentMethod,
      createdAt: order.createdAt,
      shippingAddress,
      viewUrl,
    });

    sendBrevoEmail({
      to: req.user.email,
      subject,
      text,
      html,
      senderKey: "orders",
    }).catch((err) => console.error("Order email failed", err));

    if (FEZ_ENABLED) {
      try {
        const fezPayloadOrder = {
          id: order.id,
          totalPrice: order.totalPrice,
          paymentMethod: order.paymentMethod,
          shippingAddress,
          user: {
            name: req.user.name,
            email: req.user.email,
            phone: req.user.phone,
          },
        };
        const fezResult = await createFezOrder({
          order: fezPayloadOrder,
          context: {
            deliveryWeightKg: req.body?.deliveryWeightKg,
          },
        });

        if (fezResult?.orderNo) {
          order = await prisma.order.update({
            where: { id: order.id },
            data: {
              deliveryProvider: "FEZ",
              deliveryOrderNo: fezResult.orderNo,
              deliveryStatus: "CREATED",
              deliveryMeta: fezResult.raw || undefined,
            },
            include: { items: true },
          });
        }
      } catch (error) {
        console.error("Fez dispatch failed", error);
      }
    }

    res.status(201).json(toLegacyOrder(order));
  } catch (err) {
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
  } catch (err) {
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
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(toLegacyOrder(order));
  } catch (err) {
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
    if (!order) return res.status(404).json({ message: "Order not found" });

    const updateData: Record<string, any> = {};
    if (orderStatus && req.user.isAdmin) {
      updateData.orderStatus = legacyOrderStatusToDb(orderStatus);
    }

    if (order.orderStatus !== "DELIVERED") {
      if (shippingAddress) {
        Object.assign(updateData, formatShipping(shippingAddress));
      }
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        items: { include: { product: true } },
      },
    });
    res.json(toLegacyOrder(updated));
  } catch (err) {
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
  } catch (err) {
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

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    await generateReceipt({
      res,
      order: toLegacyOrder(order),
      issuerName: "Online",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Track delivery (customer)
// =========================
exports.trackDelivery = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        userId: true,
        deliveryProvider: true,
        deliveryOrderNo: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!order.deliveryProvider || order.deliveryProvider.toUpperCase() !== "FEZ") {
      return res.status(400).json({ message: "Delivery provider not configured for this order" });
    }
    if (!order.deliveryOrderNo) {
      return res.status(400).json({ message: "No delivery tracking available for this order" });
    }

    const tracking = await trackFezOrder(order.deliveryOrderNo);
    res.json({
      provider: "FEZ",
      orderNo: order.deliveryOrderNo,
      tracking,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Cancel order (customer)
// =========================
exports.cancelOrder = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, orderStatus: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const status = (order.orderStatus || "").toUpperCase();
    if (status === "SHIPPED" || status === "DELIVERED") {
      return res.status(400).json({ message: "Order has already shipped and cannot be cancelled" });
    }

    if (status === "CANCELLED" || status === "RETURNED") {
      const existing = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { product: true } } },
      });
      return res.json(toLegacyOrder(existing));
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { orderStatus: "CANCELLED" },
      include: { items: { include: { product: true } } },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "customer_order_cancelled",
          entityType: "order",
          entityId: updated.id,
          branchId: updated.branchId || null,
          message: "Customer cancelled online order",
        },
      })
      .catch(() => null);

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Rate order (customer)
// =========================
exports.rateOrder = async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const note = (req.body?.note || "").toString().trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, orderStatus: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if ((order.orderStatus || "").toUpperCase() !== "DELIVERED") {
      return res.status(400).json({ message: "Only delivered orders can be rated" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        customerRating: rating,
        customerRatingNote: note,
        customerRatedAt: new Date(),
      },
      include: { items: { include: { product: true } } },
    });

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
