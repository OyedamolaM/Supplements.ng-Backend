const { prisma, toDbUserRole, toLegacyOrder } = require("../utils/prismaLegacy");

const NON_REVENUE_STATUSES = ["CANCELLED", "RETURN_REQUESTED", "RETURNED"];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseIntSafe = (value, fallback) => {
  const parsed = Number.parseInt((value ?? "").toString(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toUtcDayKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const bucket = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return bucket.toISOString().slice(0, 10);
};

const utcStartOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
};

const utcEndOfDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
};

const employeeRoles = () =>
  ["branch_manager", "accountant", "inventory_manager", "cashier", "staff"].map(toDbUserRole);

exports.getAnalytics = async (req, res) => {
  try {
    const totalUsers = await prisma.user.count({
      where: { role: toDbUserRole("customer") },
    });

    const totalProducts = await prisma.product.count();

    const orderStats = await prisma.order.aggregate({
      _sum: { totalPrice: true },
      _count: { _all: true },
    });

    const totalRevenue = orderStats._sum.totalPrice || 0;
    const totalOrders = orderStats._count._all || 0;

    const recentOrders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        branch: {
          select: { id: true, name: true, isOnline: true, address: true, phone: true, region: true },
        },
        items: true,
      },
    });

    res.json({
      totalUsers,
      totalProducts,
      totalOrders,
      totalRevenue,
      recentOrders: recentOrders.map((order) => toLegacyOrder(order)),
    });
  } catch (err) {
    console.error("Admin Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

exports.getOverview = async (req, res) => {
  try {
    const now = new Date();
    const rangeDays = clamp(parseIntSafe(req.query.rangeDays, 7), 7, 90);
    const chartFrom = utcStartOfDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (rangeDays - 1))));
    const chartTo = utcEndOfDay(now);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const branchId = req.query.branchId ? req.query.branchId.toString() : null;

    const revenueWhere: Record<string, any> = {
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };
    const monthRevenueWhere: Record<string, any> = {
      createdAt: { gte: monthStart, lte: now },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };
    const chartWhere: Record<string, any> = {
      createdAt: { gte: chartFrom, lte: chartTo },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };

    if (branchId) {
      revenueWhere.branchId = branchId;
      monthRevenueWhere.branchId = branchId;
      chartWhere.branchId = branchId;
    }

    const [
      totalCustomers,
      newCustomersThisMonth,
      totalProducts,
      revenueAgg,
      monthRevenueAgg,
      pendingOrdersCount,
      pendingApprovalsCount,
      overdueInvoicesCount,
      recentOrders,
      branchRevenueRows,
      chartOrders,
      branchInventories,
      supplierBalances,
      supplierSpendAgg,
      orderItemsMonth,
      loginLogs,
    ] = await Promise.all([
      prisma.user.count({ where: { role: toDbUserRole("customer") } }),
      prisma.user.count({
        where: { role: toDbUserRole("customer"), createdAt: { gte: monthStart, lte: now } },
      }),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.order.aggregate({
        where: revenueWhere,
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: monthRevenueWhere,
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.order.count({
        where: branchId ? { branchId, orderStatus: "PROCESSING" } : { orderStatus: "PROCESSING" },
      }),
      prisma.approvalRequest.count({
        where: branchId ? { branchId, status: "PENDING" } : { status: "PENDING" },
      }),
      prisma.supplierInvoice.count({
        where: branchId ? { branchId, status: "OVERDUE" } : { status: "OVERDUE" },
      }),
      prisma.order.findMany({
        where: branchId ? { branchId } : {},
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          user: { select: { id: true, name: true, phone: true, role: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      prisma.order.groupBy({
        by: ["branchId"],
        where: {
          createdAt: { gte: monthStart, lte: now },
          orderStatus: { notIn: NON_REVENUE_STATUSES },
          ...(branchId ? { branchId } : {}),
        },
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.order.findMany({
        where: chartWhere,
        select: { createdAt: true, totalPrice: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.branchInventory.findMany({
        where: branchId ? { branchId } : {},
        include: {
          branch: { select: { id: true, name: true } },
          product: { select: { id: true, title: true, reorderLevel: true, deletedAt: true } },
        },
      }),
      prisma.supplier.findMany({
        where: branchId ? { branchId, balance: { gt: 0 } } : { balance: { gt: 0 } },
        orderBy: { balance: "desc" },
        take: 4,
        select: { id: true, name: true, balance: true },
      }),
      prisma.supplierInvoice.aggregate({
        where: branchId
          ? { branchId, dateSupplied: { gte: monthStart, lte: now } }
          : { dateSupplied: { gte: monthStart, lte: now } },
        _sum: { total: true },
      }),
      prisma.orderItem.findMany({
        where: {
          order: {
            createdAt: { gte: monthStart, lte: now },
            orderStatus: { notIn: NON_REVENUE_STATUSES },
            ...(branchId ? { branchId } : {}),
          },
        },
        select: {
          productId: true,
          quantity: true,
          price: true,
          product: { select: { id: true, title: true } },
        },
      }),
      prisma.activityLog.findMany({
        where: branchId
          ? { branchId, action: "login", createdAt: { gte: utcStartOfDay(now), lte: utcEndOfDay(now) } }
          : { action: "login", createdAt: { gte: utcStartOfDay(now), lte: utcEndOfDay(now) } },
        select: { userId: true },
      }),
    ]);

    const totalRevenue = Number(revenueAgg._sum.totalPrice || 0);
    const totalOrders = Number(revenueAgg._count._all || 0);
    const monthRevenue = Number(monthRevenueAgg._sum.totalPrice || 0);
    const monthOrders = Number(monthRevenueAgg._count._all || 0);

    const branchIds = branchRevenueRows
      .map((row) => row.branchId)
      .filter(Boolean) as string[];
    const branches = branchIds.length
      ? await prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, name: true },
        })
      : [];
    const branchNameMap = new Map(branches.map((branch) => [branch.id, branch.name]));

    const branchCards = branchRevenueRows
      .filter((row) => row.branchId)
      .map((row) => ({
        _id: row.branchId,
        id: row.branchId,
        name: branchNameMap.get(row.branchId) || "Unknown",
        revenue: Number(row._sum.totalPrice || 0),
        orders: Number(row._count._all || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const salesSeriesMap = new Map();
    for (const order of chartOrders) {
      const key = toUtcDayKey(order.createdAt);
      if (!salesSeriesMap.has(key)) {
        salesSeriesMap.set(key, { date: key, revenue: 0, orders: 0 });
      }
      const current = salesSeriesMap.get(key);
      current.revenue += Number(order.totalPrice || 0);
      current.orders += 1;
    }

    const salesSeries = [];
    for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
      const bucket = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
      const key = bucket.toISOString().slice(0, 10);
      const row = salesSeriesMap.get(key) || { date: key, revenue: 0, orders: 0 };
      salesSeries.push(row);
    }

    const employeeCount = await prisma.user.count({
      where: {
        role: { in: employeeRoles() },
        ...(branchId ? { branchId } : {}),
      },
    });

    const loginUserIds = [...new Set(loginLogs.map((log) => log.userId).filter(Boolean))];
    const loginEmployeeCount = loginUserIds.length
      ? await prisma.user.count({
          where: { id: { in: loginUserIds }, role: { in: employeeRoles() } },
        })
      : 0;

    const lowStockRows = branchInventories
      .filter(
        (row) =>
          row.product &&
          row.product.deletedAt === null &&
          Number(row.product.reorderLevel || 0) > 0 &&
          Number(row.quantity || 0) <= Number(row.product.reorderLevel || 0)
      )
      .map((row) => ({
        productId: row.productId,
        productTitle: row.product?.title || "",
        branchId: row.branchId,
        branchName: row.branch?.name || "",
        quantity: Number(row.quantity || 0),
        reorderLevel: Number(row.product?.reorderLevel || 0),
      }))
      .sort((a, b) => (a.quantity - a.reorderLevel) - (b.quantity - b.reorderLevel));

    const lowStockUniqueProducts = new Set(lowStockRows.map((row) => row.productId)).size;
    const lowStockTop = lowStockRows.slice(0, 6);

    const notifications = [];
    if (lowStockUniqueProducts > 0) {
      notifications.push({
        type: "low_stock",
        message: `${lowStockUniqueProducts} product(s) are low on stock`,
        href: "/admin/inventory/products",
      });
    }
    if (pendingOrdersCount > 0) {
      notifications.push({
        type: "orders_pending",
        message: `${pendingOrdersCount} order(s) are currently processing`,
        href: "/admin/orders",
      });
    }
    if (pendingApprovalsCount > 0) {
      notifications.push({
        type: "approvals_pending",
        message: `${pendingApprovalsCount} approval request(s) pending`,
        href: "/admin/inventory/approvals",
      });
    }
    if (overdueInvoicesCount > 0) {
      notifications.push({
        type: "supplier_overdue",
        message: `${overdueInvoicesCount} supplier invoice(s) overdue`,
        href: "/admin/inventory/invoices",
      });
    }

    const supplierSpend = Number(supplierSpendAgg._sum.total || 0);

    const topProductsMap = new Map();
    for (const item of orderItemsMonth || []) {
      const id = item.productId;
      if (!id) continue;
      if (!topProductsMap.has(id)) {
        topProductsMap.set(id, {
          productId: id,
          title: item.product?.title || "",
          units: 0,
          revenue: 0,
        });
      }
      const current = topProductsMap.get(id);
      const units = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      current.units += units;
      current.revenue += units * price;
      if (!current.title && item.product?.title) current.title = item.product.title;
    }

    const topProducts = [...topProductsMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    res.json({
      asOf: now.toISOString(),
      rangeDays,
      branchId,
      kpis: {
        totalRevenue,
        totalOrders,
        lowStockAlerts: lowStockUniqueProducts,
        newCustomers: newCustomersThisMonth,
      },
      customerStats: {
        totalCustomers,
        newThisMonth: newCustomersThisMonth,
      },
      ordersStats: {
        monthRevenue,
        monthOrders,
      },
      branchCards,
      salesSeries,
      recentOrders: recentOrders.map((order) => toLegacyOrder(order)),
      topProducts,
      lowStock: lowStockTop,
      supplierBalances: supplierBalances.map((supplier) => ({
        _id: supplier.id,
        id: supplier.id,
        name: supplier.name,
        balance: Number(supplier.balance || 0),
      })),
      staffOverview: {
        employeesActive: employeeCount,
        loginsToday: loginEmployeeCount,
      },
      financialSummary: {
        monthRevenue,
        supplierSpend,
        profitEstimate: monthRevenue - supplierSpend,
      },
      notifications,
    });
  } catch (err) {
    console.error("Admin Overview Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
