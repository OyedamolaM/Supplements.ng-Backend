const { prisma, toLegacyOrder, fromDbUserRole } = require("../utils/prismaLegacy");

const parseDate = (value, fallback) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date?.getTime()) ? fallback : date;
};

const NON_REVENUE_STATUSES = ["CANCELLED", "RETURN_REQUESTED", "RETURNED"];

const applyBranchFilter = (req, where: Record<string, any>) => {
  if (req.user.role === "branch_manager" && req.user.branch) {
    where.branchId = req.user.branch;
  } else if (req.query.branchId) {
    where.branchId = req.query.branchId;
  }
};

const toPeriodKey = (value, group) => {
  const date = new Date(value);
  if (group === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  }
  if (group === "week") {
    const weekday = date.getUTCDay();
    const diff = weekday === 0 ? 6 : weekday - 1;
    const monday = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diff)
    );
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString();
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  ).toISOString();
};

const toLegacyMovementType = (value) => (value || "").toString().toLowerCase();

const toDbMovementType = (value) => {
  const key = (value || "").toString().trim().toLowerCase();
  if (key === "receipt") return "RECEIPT";
  if (key === "sale") return "SALE";
  if (key === "return") return "RETURN";
  if (key === "adjustment") return "ADJUSTMENT";
  return undefined;
};

exports.dailySales = async (req, res) => {
  try {
    const date = parseDate(req.query.date, new Date());
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const where: Record<string, any> = {
      createdAt: { gte: start, lte: end },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };
    applyBranchFilter(req, where);

    const orders = await prisma.order.findMany({
      where,
      select: {
        branchId: true,
        createdById: true,
        totalPrice: true,
      },
    });

    const grouped = new Map();
    for (const order of orders) {
      const branchId = order.branchId || null;
      const cashierId = order.createdById || null;
      const key = `${branchId || "none"}::${cashierId || "none"}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          _id: { branch: branchId, cashier: cashierId },
          totalSales: 0,
          totalOrders: 0,
        });
      }
      const current = grouped.get(key);
      current.totalSales += Number(order.totalPrice || 0);
      current.totalOrders += 1;
    }

    const branchIds = [...new Set(orders.map((item) => item.branchId).filter(Boolean))];
    const cashierIds = [...new Set(orders.map((item) => item.createdById).filter(Boolean))];

    const [branches, cashiers] = await Promise.all([
      branchIds.length
        ? prisma.branch.findMany({
            where: { id: { in: branchIds } },
            select: { id: true, name: true },
          })
        : [],
      cashierIds.length
        ? prisma.user.findMany({
            where: { id: { in: cashierIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const branchMap = new Map(branches.map((item) => [item.id, item.name]));
    const cashierMap = new Map(cashiers.map((item) => [item.id, item.name]));

    const summary = [...grouped.values()].map((row) => ({
      ...row,
      branchName: row._id.branch ? branchMap.get(row._id.branch) || null : null,
      cashierName: row._id.cashier ? cashierMap.get(row._id.cashier) || null : null,
    }));

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.salesSummary = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());
    const group = req.query.group === "month" || req.query.group === "week" ? req.query.group : "day";

    const where: Record<string, any> = {
      createdAt: { gte: from, lte: to },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };
    applyBranchFilter(req, where);

    const orders = await prisma.order.findMany({
      where,
      select: {
        createdAt: true,
        totalPrice: true,
        taxAmount: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const grouped = new Map();
    for (const order of orders) {
      const key = toPeriodKey(order.createdAt, group);
      if (!grouped.has(key)) {
        grouped.set(key, {
          _id: { period: key },
          totalSales: 0,
          totalOrders: 0,
          taxTotal: 0,
        });
      }
      const current = grouped.get(key);
      current.totalSales += Number(order.totalPrice || 0);
      current.totalOrders += 1;
      current.taxTotal += Number(order.taxAmount || 0);
    }

    const summary = [...grouped.values()].sort(
      (a, b) => new Date(a._id.period).getTime() - new Date(b._id.period).getTime()
    );

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.taxSummary = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());

    const where: Record<string, any> = {
      createdAt: { gte: from, lte: to },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };
    applyBranchFilter(req, where);

    const orders = await prisma.order.findMany({
      where,
      select: {
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
        totalPrice: true,
      },
    });

    const summary = orders.reduce(
      (acc, order) => {
        acc.taxableSales += Number(order.subtotal || 0);
        acc.taxTotal += Number(order.taxAmount || 0);
        acc.discountTotal += Number(order.discountAmount || 0);
        acc.grossSales += Number(order.totalPrice || 0);
        return acc;
      },
      { taxableSales: 0, taxTotal: 0, discountTotal: 0, grossSales: 0 }
    );

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.inventoryValuation = async (req, res) => {
  try {
    const where: Record<string, any> = {};
    applyBranchFilter(req, where);

    const rows = await prisma.branchInventory.findMany({
      where,
      include: {
        product: { select: { costPrice: true } },
      },
    });

    const grouped = new Map();
    for (const row of rows) {
      const branchId = row.branchId || null;
      if (!grouped.has(branchId)) {
        grouped.set(branchId, { _id: branchId, totalValue: 0 });
      }
      const current = grouped.get(branchId);
      current.totalValue += Number(row.quantity || 0) * Number(row.product?.costPrice || 0);
    }

    res.json([...grouped.values()]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.inventoryMovement = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());

    const where: Record<string, any> = {
      createdAt: { gte: from, lte: to },
    };
    applyBranchFilter(req, where);
    if (req.query.productId) where.productId = req.query.productId;
    const dbType = toDbMovementType(req.query.type);
    if (dbType) where.type = dbType;

    const movements = await prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { select: { id: true, title: true } },
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      movements.map((movement) => ({
        _id: movement.id,
        id: movement.id,
        branch: movement.branch
          ? { _id: movement.branch.id, id: movement.branch.id, name: movement.branch.name }
          : movement.branchId,
        product: movement.product
          ? { _id: movement.product.id, id: movement.product.id, title: movement.product.title }
          : movement.productId,
        createdBy: movement.createdBy
          ? {
              _id: movement.createdBy.id,
              id: movement.createdBy.id,
              name: movement.createdBy.name,
              role: fromDbUserRole(movement.createdBy.role),
            }
          : movement.createdById,
        type: toLegacyMovementType(movement.type),
        quantityChange: movement.quantityChange,
        reason: movement.reason,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        createdAt: movement.createdAt,
        updatedAt: movement.updatedAt,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.supplierBalances = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true, balance: true },
      orderBy: { name: "asc" },
    });
    res.json(
      suppliers.map((supplier) => ({
        _id: supplier.id,
        id: supplier.id,
        name: supplier.name,
        balance: supplier.balance || 0,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.returnsReport = async (req, res) => {
  try {
    const where: Record<string, any> = {
      orderStatus: { in: ["RETURN_REQUESTED", "RETURNED"] },
    };
    applyBranchFilter(req, where);

    const orders = await prisma.order.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        originBranch: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders.map((order) => toLegacyOrder(order)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
