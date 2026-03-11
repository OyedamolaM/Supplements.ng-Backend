const { prisma, newId, toLegacyProduct, toLegacyBranch, fromDbUserRole } = require("../utils/prismaLegacy");

const normalizeTaxCategory = (value) => {
  const key = (value || "standard").toString().trim().toLowerCase();
  if (key === "exempt") return "EXEMPT";
  if (key === "zero") return "ZERO";
  return "STANDARD";
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = value.toString().trim().toLowerCase();
  return ["true", "1", "yes", "on"].includes(normalized);
};

const buildPublicProductWhere = (search = "") => {
  const filters: any[] = [
    { deletedAt: null },
    { isActiveOnline: true },
    {
      OR: [
        { quantityAvailable: { gt: 0 } },
        {
          branchInventories: {
            some: {
              quantity: { gt: 0 },
              branch: { isOnline: true },
            },
          },
        },
      ],
    },
  ];

  const normalizedSearch = search.toString().trim();
  if (normalizedSearch) {
    filters.push({
      title: {
        contains: normalizedSearch,
        mode: "insensitive",
      },
    });
  }

  return { AND: filters };
};

const buildAdminProductWhere = (search = "") => {
  const filters: any[] = [{ deletedAt: null }];
  const normalizedSearch = search.toString().trim();

  if (normalizedSearch) {
    filters.push({
      title: {
        contains: normalizedSearch,
        mode: "insensitive",
      },
    });
  }

  return { AND: filters };
};

const serializeProductActivity = (log) => ({
  _id: log.id,
  id: log.id,
  action: log.action,
  entityType: log.entityType || "",
  entityId: log.entityId || null,
  branch: log.branch ? toLegacyBranch(log.branch) : log.branchId || null,
  user: log.user
    ? {
        _id: log.user.id,
        id: log.user.id,
        name: log.user.name || "",
        email: log.user.email || "",
        role: fromDbUserRole(log.user.role),
      }
    : null,
  message: log.message || "",
  meta: log.meta || null,
  createdAt: log.createdAt,
  updatedAt: log.updatedAt,
});

// =========================
// LIST PRODUCTS (PUBLIC)
// =========================
exports.list = async (req, res) => {
  const { search = "" } = req.query;
  const includeAllProducts =
    req.query.visibility?.toString().trim().toLowerCase() === "all";
  const where = includeAllProducts
    ? buildAdminProductWhere(search)
    : buildPublicProductWhere(search);

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json(products.map((product) => toLegacyProduct(product)));
};

// =========================
// GET ONE PRODUCT
// =========================
exports.getOne = async (req, res) => {
  const includeAllProducts =
    req.query.visibility?.toString().trim().toLowerCase() === "all";
  const publicWhere = buildPublicProductWhere();
  const product = includeAllProducts
    ? await prisma.product.findFirst({
        where: { id: req.params.id, deletedAt: null },
      })
    : await prisma.product.findFirst({
        where: {
          id: req.params.id,
          AND: publicWhere.AND,
        },
      });
  if (!product) return res.status(404).json({ message: "Product not found" });

  res.json(toLegacyProduct(product));
};

exports.getAdminDetail = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        taxRate: {
          select: {
            id: true,
            name: true,
            rate: true,
          },
        },
        branchInventories: {
          include: {
            branch: true,
          },
          orderBy: [
            { branch: { name: "asc" } },
            { updatedAt: "desc" },
          ],
        },
      },
    });

    if (!product || product.deletedAt) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [orderItems, supplierInvoiceItems, inventoryMovements, activityLogs] =
      await Promise.all([
        prisma.orderItem.findMany({
          where: { productId: req.params.id },
          include: {
            order: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                  },
                },
                branch: true,
              },
            },
          },
          orderBy: {
            order: {
              createdAt: "desc",
            },
          },
          take: 20,
        }),
        prisma.supplierInvoiceItem.findMany({
          where: { productId: req.params.id },
          include: {
            invoice: {
              include: {
                supplier: true,
                branch: true,
              },
            },
          },
          orderBy: {
            invoice: {
              dateSupplied: "desc",
            },
          },
          take: 20,
        }),
        prisma.inventoryMovement.findMany({
          where: { productId: req.params.id },
          include: {
            branch: true,
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.activityLog.findMany({
          where: {
            OR: [
              { entityType: "product", entityId: req.params.id },
              {
                meta: {
                  path: ["productId"],
                  equals: req.params.id,
                },
              },
            ],
          },
          include: {
            branch: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);

    const unitsSold = orderItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
    const totalStock = product.branchInventories.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );

    res.json({
      product: {
        ...toLegacyProduct(product),
        taxRateDetail: product.taxRate
          ? {
              _id: product.taxRate.id,
              id: product.taxRate.id,
              name: product.taxRate.name,
              rate: product.taxRate.rate,
            }
          : null,
      },
      summary: {
        totalStock,
        trackedBranches: product.branchInventories.length,
        orderCount: orderItems.length,
        unitsSold,
        supplierReceipts: supplierInvoiceItems.length,
        inventoryChanges: inventoryMovements.length,
      },
      branchInventory: product.branchInventories.map((item) => ({
        _id: item.id,
        id: item.id,
        branch: item.branch ? toLegacyBranch(item.branch) : item.branchId,
        quantity: item.quantity,
        updatedAt: item.updatedAt,
      })),
      orderHistory: orderItems.map((item) => ({
        _id: item.id,
        id: item.id,
        orderId: item.orderId,
        quantity: item.quantity,
        price: item.price,
        createdAt: item.order?.createdAt || null,
        orderStatus: item.order?.orderStatus || "",
        branch: item.order?.branch ? toLegacyBranch(item.order.branch) : item.order?.branchId || null,
        customer: item.order?.user
          ? {
              _id: item.order.user.id,
              id: item.order.user.id,
              name: item.order.user.name,
              email: item.order.user.email,
              role: fromDbUserRole(item.order.user.role),
            }
          : null,
      })),
      supplyHistory: supplierInvoiceItems.map((item) => ({
        _id: item.id,
        id: item.id,
        invoiceId: item.invoiceId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        total: item.total,
        description: item.description || "",
        dateSupplied: item.invoice?.dateSupplied || null,
        supplier: item.invoice?.supplier
          ? {
              _id: item.invoice.supplier.id,
              id: item.invoice.supplier.id,
              name: item.invoice.supplier.name,
            }
          : null,
        branch: item.invoice?.branch ? toLegacyBranch(item.invoice.branch) : null,
      })),
      inventoryHistory: inventoryMovements.map((movement) => ({
        _id: movement.id,
        id: movement.id,
        type: movement.type,
        quantityChange: movement.quantityChange,
        reason: movement.reason || "",
        referenceType: movement.referenceType || "",
        referenceId: movement.referenceId || null,
        createdAt: movement.createdAt,
        branch: movement.branch ? toLegacyBranch(movement.branch) : movement.branchId,
        createdBy: movement.createdBy
          ? {
              _id: movement.createdBy.id,
              id: movement.createdBy.id,
              name: movement.createdBy.name,
              email: movement.createdBy.email,
              role: fromDbUserRole(movement.createdBy.role),
            }
          : null,
      })),
      activityHistory: activityLogs.map((log) => serializeProductActivity(log)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// CREATE PRODUCT (ADMIN)
// WITH IMAGE UPLOAD
// =========================
exports.create = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      stock,
      category,
      costPrice,
      sellingPrice,
      expiryDate,
      quantityAvailable,
      sku,
      batchNumber,
      barcode,
      supplier,
      reorderLevel,
      taxCategory,
      taxRate,
      dosageForm,
      strength,
      packSize,
      manufacturer,
      isActiveOnline,
    } = req.body;

    const normalizedSellingPrice =
      sellingPrice !== undefined && sellingPrice !== ""
        ? Number(sellingPrice)
        : Number(price);
    const normalizedQuantity =
      quantityAvailable !== undefined && quantityAvailable !== ""
        ? Number(quantityAvailable)
        : Number(stock);

    const images = req.files ? req.files.map((file) => file.path) : [];

    const product = await prisma.product.create({
      data: {
        id: newId(),
        title,
        description: description || "",
        price: Number.isFinite(normalizedSellingPrice) ? normalizedSellingPrice : 0,
        costPrice: Number(costPrice || 0),
        sellingPrice: Number.isFinite(normalizedSellingPrice) ? normalizedSellingPrice : 0,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        stock: Number.isFinite(normalizedQuantity) ? normalizedQuantity : 0,
        quantityAvailable: Number.isFinite(normalizedQuantity) ? normalizedQuantity : 0,
        sku: sku || "",
        batchNumber: batchNumber || "",
        barcode: barcode || "",
        supplierName: supplier || "",
        reorderLevel: Number(reorderLevel || 0),
        taxCategory: normalizeTaxCategory(taxCategory),
        taxRateId: taxRate || null,
        dosageForm: dosageForm || "",
        strength: strength || "",
        packSize: packSize || "",
        manufacturer: manufacturer || "",
        isActiveOnline: normalizeBoolean(isActiveOnline, true),
        category: category || "General",
        images,
      },
    });

    res.status(201).json(toLegacyProduct(product));

    if (req.user?.id) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: req.user.id,
            action: "product_created",
            entityType: "product",
            entityId: product.id,
            branchId: req.user?.branch || null,
            message: "Created product",
          },
        })
        .catch(() => null);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// UPDATE PRODUCT (ADMIN)
// =========================
exports.update = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (req.files && req.files.length > 0) {
      updateData.images = req.files.map((file) => file.path);
    }

    if (updateData.taxRate === "") {
      updateData.taxRate = null;
    }

    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ message: "Product not found" });

    const nextSellingPrice =
      updateData.sellingPrice !== undefined
        ? Number(updateData.sellingPrice)
        : existing.sellingPrice;
    const nextCostPrice =
      updateData.costPrice !== undefined
        ? Number(updateData.costPrice)
        : existing.costPrice;
    const priceChanged =
      Number(existing.sellingPrice || existing.price || 0) !==
        Number(nextSellingPrice || 0) ||
      Number(existing.costPrice || 0) !== Number(nextCostPrice || 0);

    if (priceChanged && !updateData.changeReason) {
      return res
        .status(400)
        .json({ message: "Change reason is required for price updates" });
    }

    const priceChangeReason = priceChanged ? updateData.changeReason : null;
    delete updateData.changeReason;

    if (updateData.sellingPrice !== undefined) {
      const normalized = Number(updateData.sellingPrice);
      updateData.price = normalized;
      updateData.sellingPrice = normalized;
    }

    if (updateData.quantityAvailable !== undefined) {
      const normalized = Number(updateData.quantityAvailable);
      updateData.stock = normalized;
      updateData.quantityAvailable = normalized;
    }

    if (updateData.taxCategory !== undefined) {
      updateData.taxCategory = normalizeTaxCategory(updateData.taxCategory);
    }
    if (updateData.taxRate !== undefined) {
      updateData.taxRateId = updateData.taxRate || null;
      delete updateData.taxRate;
    }
    if (updateData.supplier !== undefined) {
      updateData.supplierName = updateData.supplier || "";
      delete updateData.supplier;
    }
    if (updateData.isActiveOnline !== undefined) {
      updateData.isActiveOnline = normalizeBoolean(
        updateData.isActiveOnline,
        existing.isActiveOnline
      );
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json(toLegacyProduct(product));

    if (req.user?.id) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: req.user.id,
            action: "product_updated",
            entityType: "product",
            entityId: product.id,
            branchId: req.user?.branch || null,
            message: "Updated product",
            meta: priceChangeReason ? { reason: priceChangeReason } : {},
          },
        })
        .catch(() => null);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// DELETE PRODUCT (ADMIN)
// =========================
exports.remove = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Only the highest admin can delete products" });
    }

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true, deletedAt: true },
    });

    if (!product || product.deletedAt) {
      return res.status(404).json({ message: "Product not found" });
    }

    await prisma.$transaction([
      prisma.userCartItem.deleteMany({
        where: { productId: req.params.id },
      }),
      prisma.userWishlistItem.deleteMany({
        where: { productId: req.params.id },
      }),
      prisma.product.update({
        where: { id: req.params.id },
        data: {
          deletedAt: new Date(),
          isActiveOnline: false,
        },
      }),
      prisma.activityLog.create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "product_deleted",
          entityType: "product",
          entityId: product.id,
          branchId: req.user?.branch || null,
          message: `Deleted product ${product.title}`,
          meta: {
            mode: "archive_delete",
            preservedHistory: true,
          },
        },
      }),
    ]);

    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
