const {
  prisma,
  newId,
  fromDbUserRole,
  toLegacyOrder,
  legacyOrderStatusToDb,
} = require("../utils/prismaLegacy");
const { generateReceipt } = require("../utils/receiptGenerator");

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

    if (shippingAddress) {
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

    res.status(201).json(toLegacyOrder(createdOrder));
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
// Update order status (admin/staff)
// =========================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, orderStatus } = req.body;
    const nextStatus = status || orderStatus;

    if (!nextStatus) {
      return res.status(400).json({ message: "Status is required" });
    }

    if (nextStatus === "Returned" && !ADMIN_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed to return orders" });
    }

    const existing = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ message: "Order not found" });

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        orderStatus: legacyOrderStatusToDb(nextStatus),
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
          action: "order_status_update",
          entityType: "order",
          entityId: updated.id,
          branchId: updated.branchId || null,
          message: `Order status updated to ${nextStatus}`,
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
