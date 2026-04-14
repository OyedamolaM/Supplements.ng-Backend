const {
  prisma,
  newId,
  fromDbUserRole,
  toLegacyOrder,
  legacyOrderStatusToDb,
} = require("../utils/prismaLegacy");
const { generateReceipt } = require("../utils/receiptGenerator");
const {
  sendBrevoEmail,
  buildOrderConfirmationEmail,
  buildOrderStatusEmail,
} = require("../services/emailService");
const { sendOrderStatusWhatsApp } = require("../services/whatsappService");
const { createFezOrder } = require("../services/fezService");

const ADMIN_ROLES = ["super_admin", "admin"];
const STAFF_ROLES = [
  "branch_manager",
  "accountant",
  "inventory_manager",
  "cashier",
  "staff",
];
const REQUIRED_SHIPPING_FIELDS = [
  "fullName",
  "addressLine1",
  "city",
  "state",
  "country",
  "postalCode",
  "phone",
];

const FEZ_ENABLED = (process.env.FEZ_ENABLED || "").toString().trim().toLowerCase() === "true";
const FEZ_AUTO_DISPATCH = (process.env.FEZ_AUTO_DISPATCH || "true").toString().trim().toLowerCase() === "true";

const parseShippingFee = (payload: any) => {
  if (payload === null || payload === undefined) return 0;
  if (typeof payload === "number") return Number.isFinite(payload) ? payload : 0;
  if (typeof payload === "string") {
    const parsed = Number(payload);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const totalCost = payload?.totalCost ?? payload?.total_cost;
  if (totalCost !== undefined && totalCost !== null) {
    const parsed = Number(totalCost);
    if (Number.isFinite(parsed)) return parsed;
  }
  const costValue = payload?.cost?.cost ?? payload?.Cost?.cost ?? payload?.cost;
  if (costValue !== undefined && costValue !== null) {
    const parsed = Number(costValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  const exportPrice = payload?.data?.price ?? payload?.price;
  if (exportPrice !== undefined && exportPrice !== null) {
    const parsed = Number(exportPrice);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

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

const normalizeAddressValue = (value) =>
  (value || "").toString().trim().toLowerCase();
const normalizeUsageMode = (value) =>
  (value || "FIXED").toString().trim().toUpperCase() === "AS_NEEDED"
    ? "AS_NEEDED"
    : "FIXED";
const normalizeNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const normalizeText = (value, fallback) => {
  const text = (value || "").toString().trim();
  return text || fallback;
};

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
  const hasAddress = addresses.some((address) =>
    isSameAddress(address, shippingAddress)
  );
  if (hasAddress) return;

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
};

// =========================
// Get all orders (admin/staff)
// =========================
exports.getAllOrders = async (req, res) => {
  try {
    const where: Record<string, any> = {};
    const onlineBranch = await prisma.branch.findFirst({
      where: { isOnline: true },
      select: { id: true },
    });

    if (req.query.branchId && ADMIN_ROLES.includes(req.user.role)) {
      where.branchId = req.query.branchId;
    } else if (STAFF_ROLES.includes(req.user.role) && req.user.branch) {
      if (onlineBranch?.id) {
        where.OR = [{ branchId: req.user.branch }, { branchId: onlineBranch.id }];
      } else {
        where.branchId = req.user.branch;
      }
    } else if (STAFF_ROLES.includes(req.user.role) && onlineBranch?.id) {
      where.branchId = onlineBranch.id;
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
        items: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(orders.map((order) => toLegacyOrder(order)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Create order for a customer (admin/staff)
// =========================
exports.createOrderForUser = async (req, res) => {
  try {
    const { customerId, products, shippingAddress, paymentMethod, branchId } = req.body;

    if (!customerId) {
      return res.status(400).json({ message: "Customer is required" });
    }

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "No products in order" });
    }

    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, role: true },
    });
    if (!customer || fromDbUserRole(customer.role) !== "customer") {
      return res.status(404).json({ message: "Customer not found" });
    }

    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    const resolvedBranchId = isAdmin ? branchId : req.user.branch;
    if (!resolvedBranchId) {
      return res.status(400).json({ message: "Branch is required for this order" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: resolvedBranchId },
      select: { id: true, isOnline: true },
    });
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    if (branch.isOnline) {
      const hasShipping = REQUIRED_SHIPPING_FIELDS.every(
        (field) => shippingAddress && shippingAddress[field]
      );
      if (!hasShipping) {
        return res.status(400).json({ message: "Shipping address is required" });
      }
    }

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
    const orderProducts = [];
    let subtotal = 0;
    let taxAmount = 0;

    for (const item of products) {
      const productId = item.productId || item.product;
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      const quantity = Number(item.quantity) || 1;
      const lineTotal = Number(product.price || 0) * quantity;
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

    const shippingQuote = req.body?.shippingQuote || null;
    const shippingFee = parseShippingFee(req.body?.shippingFee ?? shippingQuote);
    const totalPrice = subtotal + taxAmount + (shippingFee || 0);
    const createdOrder = await prisma.$transaction(async (tx) => {
      if (!branch.isOnline) {
        for (const item of orderProducts) {
          const inventory = await tx.branchInventory.findUnique({
            where: {
              branchId_productId: {
                branchId: resolvedBranchId,
                productId: item.productId,
              },
            },
            select: { quantity: true },
          });
          if (!inventory || inventory.quantity < item.quantity) {
            throw new Error(`INSUFFICIENT_STOCK:${item.title}`);
          }
        }
      }

      const order = await tx.order.create({
        data: {
          id: newId(),
          userId: customer.id,
          branchId: resolvedBranchId,
          originBranchId: resolvedBranchId,
          paymentMethod: paymentMethod || "Cash on Delivery",
          subtotal,
          taxAmount,
          discountAmount: 0,
          totalPrice,
          createdById: req.user.id,
          ...formatShipping(shippingAddress),
          items: { create: orderProducts },
          deliveryMeta: shippingQuote
            ? { shippingQuote, shippingFee }
            : shippingFee
              ? { shippingFee }
              : undefined,
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, role: true } },
          branch: true,
          originBranch: true,
          items: true,
        },
      });

      if (!branch.isOnline) {
        for (const item of orderProducts) {
          await tx.branchInventory.update({
            where: {
              branchId_productId: {
                branchId: resolvedBranchId,
                productId: item.productId,
              },
            },
            data: { quantity: { decrement: item.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              id: newId(),
              branchId: resolvedBranchId,
              productId: item.productId,
              type: "SALE",
              quantityChange: -item.quantity,
              reason: "sale",
              referenceType: "order",
              referenceId: order.id,
              createdById: req.user.id,
            },
          });
        }
      }

      return order;
    });

    const shouldSaveAddress = Boolean(req.body?.saveAddress);
    if (shippingAddress && shouldSaveAddress) {
      await saveAddressIfNew(customer.id, shippingAddress);
    }

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "sale_created",
          entityType: "order",
          entityId: createdOrder.id,
          branchId: resolvedBranchId,
          message: "Created a sale order",
        },
      })
      .catch(() => null);

    if (createdOrder.user?.email) {
      const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
      const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
      const emailShipping = shippingAddress || {
        fullName: createdOrder.shippingFullName,
        addressLine1: createdOrder.shippingAddressLine1,
        addressLine2: createdOrder.shippingAddressLine2,
        city: createdOrder.shippingCity,
        state: createdOrder.shippingState,
        country: createdOrder.shippingCountry,
        postalCode: createdOrder.shippingPostalCode,
        phone: createdOrder.shippingPhone,
      };

      const { subject, text, html } = buildOrderConfirmationEmail({
        name: createdOrder.user.name || "Customer",
        orderId: createdOrder.id,
        items: createdOrder.items || [],
        total: createdOrder.totalPrice || 0,
        paymentMethod: createdOrder.paymentMethod || "Cash on Delivery",
        createdAt: createdOrder.createdAt,
        shippingAddress: emailShipping,
        viewUrl,
      });

      sendBrevoEmail({
        to: createdOrder.user.email,
        subject,
        text,
        html,
        senderKey: "orders",
      }).catch((err) => console.error("Order email failed", err));
    }

    let finalOrder = createdOrder;

    const shouldDispatch =
      FEZ_ENABLED &&
      shippingAddress &&
      (req.body?.dispatchNow !== undefined
        ? Boolean(req.body.dispatchNow)
        : FEZ_AUTO_DISPATCH);

    if (shouldDispatch) {
      try {
        const fezPayloadOrder = {
          id: createdOrder.id,
          totalPrice: createdOrder.totalPrice,
          paymentMethod: createdOrder.paymentMethod,
          shippingAddress,
          user: {
            name: createdOrder.user?.name || "",
            email: createdOrder.user?.email || "",
            phone: createdOrder.user?.phone || "",
          },
        };

        const fezResult = await createFezOrder({
          order: fezPayloadOrder,
          context: { deliveryWeightKg: req.body?.deliveryWeightKg },
        });

        if (fezResult?.orderNo) {
          finalOrder = await prisma.order.update({
            where: { id: createdOrder.id },
            data: {
              deliveryProvider: "FEZ",
              deliveryOrderNo: fezResult.orderNo,
              deliveryStatus: "PENDING_DISPATCH",
              deliveryMeta: {
                ...(createdOrder.deliveryMeta || {}),
                fez: fezResult.raw || undefined,
              },
            },
            include: {
              user: { select: { id: true, name: true, email: true, phone: true, role: true } },
              branch: true,
              originBranch: true,
              items: true,
            },
          });
        }
      } catch (error) {
        console.error("Fez dispatch failed", error);
      }
    }

    res.status(201).json(toLegacyOrder(finalOrder));
  } catch (err) {
    console.error(err);
    if (typeof err?.message === "string" && err.message.startsWith("INSUFFICIENT_STOCK:")) {
      const title = err.message.replace("INSUFFICIENT_STOCK:", "");
      return res.status(400).json({ message: `Insufficient stock for ${title}` });
    }
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Dispatch order to Fez (admin/staff)
// =========================
exports.dispatchFezOrder = async (req, res) => {
  try {
    if (!FEZ_ENABLED) {
      return res.status(400).json({ message: "Fez delivery is not enabled" });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        items: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.deliveryOrderNo) {
      return res.status(400).json({ message: "Order is already dispatched to Fez" });
    }

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

    const lockerId =
      (order.deliveryMeta && (order.deliveryMeta as any).lockerId) ||
      (order.deliveryMeta && (order.deliveryMeta as any).lockerID) ||
      null;
    const missingFields = REQUIRED_SHIPPING_FIELDS.filter((field) => !shippingAddress[field]);
    if (missingFields.length > 0 && !lockerId) {
      return res.status(400).json({
        message: "Shipping address is required to dispatch",
        missingFields,
      });
    }

    const fezPayloadOrder = {
      id: order.id,
      totalPrice: order.totalPrice,
      paymentMethod: order.paymentMethod,
      shippingAddress,
      user: {
        name: order.user?.name || "",
        email: order.user?.email || "",
        phone: order.user?.phone || "",
      },
    };

    const fezResult = await createFezOrder({
      order: fezPayloadOrder,
      context: {
        deliveryWeightKg: req.body?.deliveryWeightKg,
        lockerID: lockerId || undefined,
        thirdparty: req.body?.thirdparty || req.body?.thirdParty,
        senderName: req.body?.senderName,
        senderAddress: req.body?.senderAddress,
        senderPhone: req.body?.senderPhone,
      },
    });

    if (!fezResult?.orderNo) {
      return res.status(502).json({ message: "Fez did not return an order number" });
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        deliveryProvider: "FEZ",
        deliveryOrderNo: fezResult.orderNo,
        deliveryStatus: "PENDING_DISPATCH",
        orderStatus: "SHIPPED",
        deliveryMeta: {
          ...(order.deliveryMeta || {}),
          fez: fezResult.raw || undefined,
          sender: req.body?.thirdparty
            ? {
                thirdparty: true,
                senderName: req.body?.senderName || null,
                senderAddress: req.body?.senderAddress || null,
                senderPhone: req.body?.senderPhone || null,
              }
            : undefined,
          dispatchHistory: [
            ...(((order.deliveryMeta || {}).dispatchHistory as any[]) || []),
            {
              orderNo: fezResult.orderNo,
              thirdparty: Boolean(req.body?.thirdparty),
              timestamp: new Date().toISOString(),
            },
          ],
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        items: true,
      },
    });

    if (updated.user?.phone) {
      sendOrderStatusWhatsApp({
        to: updated.user.phone,
        orderId: updated.id,
        status: "Pending Dispatch",
      }).catch((err) => console.error("Dispatch WhatsApp failed", err));
    }

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error("Fez dispatch failed", err);
    const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
    const message = err?.message || "Server error";
    res.status(status).json({ message, error: err?.message, details: err?.payload });
  }
};

// =========================
// Update order status (admin/staff)
// =========================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, orderStatus, estimatedDeliveryDate, deliveryDate } = req.body;
    const nextStatus = status || orderStatus;
    const nextEta = estimatedDeliveryDate ?? deliveryDate;

    if (!nextStatus && nextEta === undefined) {
      return res.status(400).json({ message: "Status or delivery date is required" });
    }

    if (nextStatus === "Returned" && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed to return orders" });
    }

    const existing = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, deliveryMeta: true },
    });
    if (!existing) return res.status(404).json({ message: "Order not found" });

    const normalizedStatus = (nextStatus || "").toString().trim().toLowerCase();
    let deliveryStatus = null;
    if (normalizedStatus === "confirmed") deliveryStatus = "CONFIRMED";
    else if (normalizedStatus === "processing") deliveryStatus = "PROCESSING";
    else if (normalizedStatus === "processed") deliveryStatus = "PROCESSED";
    else if (normalizedStatus === "pending dispatch" || normalizedStatus === "shipped") {
      deliveryStatus = "PENDING_DISPATCH";
    } else if (normalizedStatus === "in transit" || normalizedStatus === "in_transit" || normalizedStatus === "intransit") {
      deliveryStatus = "IN_TRANSIT";
    } else if (normalizedStatus === "delivered") {
      deliveryStatus = "DELIVERED";
    }

    const nextDeliveryMeta =
      nextEta !== undefined
        ? {
            ...(existing.deliveryMeta || {}),
            estimatedDeliveryDate: nextEta ? new Date(nextEta).toISOString() : null,
          }
        : existing.deliveryMeta;

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        ...(nextStatus ? { orderStatus: legacyOrderStatusToDb(nextStatus) } : {}),
        ...(deliveryStatus ? { deliveryStatus } : {}),
        ...(nextEta !== undefined ? { deliveryMeta: nextDeliveryMeta } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
        items: true,
      },
    });

    if (nextStatus) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: req.user.id,
            action: "order_status_update",
            entityType: "order",
            entityId: updated.id,
            branchId: updated.branchId || null,
            message: `Order status updated to ${nextStatus}`,
          },
        })
        .catch(() => null);
    }

    if (updated.user?.id && nextStatus) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: updated.user.id,
            action: "order_status_update",
            entityType: "order",
            entityId: updated.id,
            branchId: updated.branchId || null,
            message: `Your order ${updated.id} is now ${nextStatus}`,
            meta: { orderStatus: nextStatus },
          },
        })
        .catch(() => null);
    }

    if (nextEta !== undefined && updated.user?.id) {
      let etaLabel = null;
      if (nextDeliveryMeta?.estimatedDeliveryDate) {
        const parsed = new Date(nextDeliveryMeta.estimatedDeliveryDate);
        if (!Number.isNaN(parsed.getTime())) {
          etaLabel = parsed.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
        }
      }
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: updated.user.id,
            action: "order_eta_update",
            entityType: "order",
            entityId: updated.id,
            branchId: updated.branchId || null,
            message: etaLabel
              ? `Estimated delivery date updated to ${etaLabel}.`
              : "Estimated delivery date updated.",
            meta: { estimatedDeliveryDate: nextDeliveryMeta?.estimatedDeliveryDate || null },
          },
        })
        .catch(() => null);
    }

    if (updated.user?.email) {
      const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
      const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
      const statusEmail = buildOrderStatusEmail({
        name: updated.user.name || "Customer",
        orderId: updated.id,
        status: nextStatus,
        viewUrl,
      });
      sendBrevoEmail({
        to: updated.user.email,
        subject: statusEmail.subject,
        text: statusEmail.text,
        html: statusEmail.html,
        senderKey: "orders",
      }).catch((err) => console.error("Order status email failed", err));
    }

    if (updated.user?.phone) {
      sendOrderStatusWhatsApp({
        to: updated.user.phone,
        orderId: updated.id,
        status: nextStatus,
      }).catch((err) => console.error("Order status WhatsApp failed", err));
    }

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Update order item dosage (admin/staff)
// =========================
exports.updateOrderItemDosage = async (req, res) => {
  try {
    const orderId = req.params.id;
    const itemId = req.params.itemId;

    const orderItem = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      include: {
        order: true,
        product: true,
      },
    });

    if (!orderItem) {
      return res.status(404).json({ message: "Order item not found" });
    }

    const nextDosageAmount = normalizeNumber(
      req.body?.dosageAmount,
      orderItem.recommendedDosageAmountSnapshot || 0
    );
    const nextFrequency = normalizeNumber(
      req.body?.frequencyPerDay,
      orderItem.recommendedFrequencyPerDaySnapshot || 0
    );
    const nextDosageUnit = normalizeText(
      req.body?.dosageUnit,
      orderItem.recommendedDosageUnitSnapshot || ""
    );
    const nextUsageText = normalizeText(
      req.body?.usageText,
      orderItem.recommendedUsageTextSnapshot || ""
    );
    const nextUsageMode = normalizeUsageMode(
      req.body?.usageMode || orderItem.usageModeSnapshot
    );

    const updated = await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: {
        recommendedDosageAmountSnapshot: nextDosageAmount,
        recommendedDosageUnitSnapshot: nextDosageUnit,
        recommendedFrequencyPerDaySnapshot: nextFrequency,
        recommendedUsageTextSnapshot: nextUsageText,
        usageModeSnapshot: nextUsageMode,
        dosageRecommendedByName: req.user?.name || req.user?.email || "Staff",
        dosageRecommendedByRole: fromDbUserRole(req.user?.role),
        dosageRecommendedAt: new Date(),
        manualOverrideEnabled: false,
        manualDosageAmount: null,
        manualFrequencyPerDay: null,
        manualDaysSupply: null,
        manualUsageText: null,
      },
    });

    res.json({
      id: updated.id,
      orderId: updated.orderId,
      recommendedDosageAmountSnapshot: updated.recommendedDosageAmountSnapshot,
      recommendedDosageUnitSnapshot: updated.recommendedDosageUnitSnapshot,
      recommendedFrequencyPerDaySnapshot: updated.recommendedFrequencyPerDaySnapshot,
      recommendedUsageTextSnapshot: updated.recommendedUsageTextSnapshot,
      usageModeSnapshot: updated.usageModeSnapshot,
      dosageRecommendedByName: updated.dosageRecommendedByName,
      dosageRecommendedByRole: updated.dosageRecommendedByRole,
      dosageRecommendedAt: updated.dosageRecommendedAt,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Claim online order for a branch
// =========================
exports.claimOnlineOrder = async (req, res) => {
  try {
    const { branchId } = req.body;
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        branch: { select: { id: true, name: true, isOnline: true } },
        items: { select: { productId: true, title: true, quantity: true } },
      },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!order.branch || !order.branch.isOnline) {
      return res.status(400).json({ message: "Only online orders can be claimed" });
    }

    const isAdmin = ADMIN_ROLES.includes(req.user.role);
    const targetBranchId = isAdmin ? branchId : req.user.branch;

    if (!targetBranchId) {
      return res.status(400).json({ message: "Branch is required to claim order" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: targetBranchId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(404).json({ message: "Branch not found" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const inventory = await tx.branchInventory.findUnique({
          where: {
            branchId_productId: {
              branchId: targetBranchId,
              productId: item.productId,
            },
          },
          select: { quantity: true },
        });
        if (!inventory || inventory.quantity < item.quantity) {
          throw new Error(`INSUFFICIENT_STOCK:${item.title || "item"}`);
        }
      }

      for (const item of order.items) {
        await tx.branchInventory.update({
          where: {
            branchId_productId: {
              branchId: targetBranchId,
              productId: item.productId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      return tx.order.update({
        where: { id: order.id },
        data: { branchId: targetBranchId },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, role: true } },
          branch: true,
          originBranch: true,
          items: true,
        },
      });
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "order_claimed",
          entityType: "order",
          entityId: updated.id,
          branchId: targetBranchId,
          message: "Claimed online order",
        },
      })
      .catch(() => null);

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    if (typeof err?.message === "string" && err.message.startsWith("INSUFFICIENT_STOCK:")) {
      const title = err.message.replace("INSUFFICIENT_STOCK:", "");
      return res.status(400).json({ message: `Insufficient stock for ${title}` });
    }
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Return order (admin)
// =========================
exports.returnOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ message: "Return reason is required" });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        branch: { select: { id: true, name: true, isOnline: true } },
        items: { select: { productId: true, quantity: true } },
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.orderStatus === "RETURNED") {
      return res.status(400).json({ message: "Order already returned" });
    }

    const approvalThreshold = Number(process.env.REFUND_APPROVAL_THRESHOLD || 0);
    if (approvalThreshold > 0 && order.totalPrice >= approvalThreshold) {
      const approval = await prisma.approvalRequest.create({
        data: {
          id: newId(),
          type: "REFUND",
          branchId: order.branchId || null,
          requestedById: req.user.id,
          reason,
          payload: { orderId: order.id },
        },
      });

      await prisma.order.update({
        where: { id: order.id },
        data: {
          orderStatus: "RETURN_REQUESTED",
          returnReason: reason,
          returnRequestedById: req.user.id,
        },
      });

      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: req.user.id,
            action: "refund_requested",
            entityType: "order",
            entityId: order.id,
            branchId: order.branchId || null,
            message: "Refund requires approval",
            meta: { approvalId: approval.id },
          },
        })
        .catch(() => null);

      return res.status(202).json({
        message: "Refund approval required",
        approvalId: approval.id,
      });
    }

    if (order.branch && !order.branch.isOnline) {
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.branchInventory.upsert({
            where: {
              branchId_productId: {
                branchId: order.branch.id,
                productId: item.productId,
              },
            },
            create: {
              id: newId(),
              branchId: order.branch.id,
              productId: item.productId,
              quantity: item.quantity,
            },
            update: {
              quantity: { increment: item.quantity },
            },
          });

          await tx.inventoryMovement.create({
            data: {
              id: newId(),
              branchId: order.branch.id,
              productId: item.productId,
              type: "RETURN",
              quantityChange: item.quantity,
              reason,
              referenceType: "order",
              referenceId: order.id,
              createdById: req.user.id,
            },
          });
        }
      });
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        orderStatus: "RETURNED",
        returnReason: reason,
        returnRequestedById: req.user.id,
        returnApprovedById: req.user.id,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
        items: true,
      },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "order_returned",
          entityType: "order",
          entityId: updated.id,
          branchId: updated.branchId || null,
          message: "Order returned",
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
// Get receipt (admin/staff)
// =========================
exports.getReceipt = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
        items: {
          include: {
            product: { select: { id: true, title: true, price: true, images: true } },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (STAFF_ROLES.includes(req.user.role)) {
      const staffBranch = req.user.branch?.toString();
      const orderBranch = order.branch?.id?.toString();
      if (staffBranch && orderBranch && staffBranch !== orderBranch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    await generateReceipt({
      res,
      order: toLegacyOrder(order),
      issuerName: req.user?.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
