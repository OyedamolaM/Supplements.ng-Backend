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

const addUtcDays = (value, days) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
};

const parseDateInput = (value) => {
  const raw = (value ?? "").toString().trim();
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dayDiffInclusive = (start, end) => {
  const startDay = utcStartOfDay(start);
  const endDay = utcStartOfDay(end);
  const diff = endDay.getTime() - startDay.getTime();
  return Math.max(1, Math.floor(diff / 86400000) + 1);
};

const getDashboardPeriod = (query, now) => {
  const rawPeriod = (query.period || "today").toString();
  const period = ["today", "yesterday", "week", "month", "year", "custom"].includes(rawPeriod)
    ? rawPeriod
    : "today";
  const todayStart = utcStartOfDay(now);
  let start = todayStart;
  let end = utcEndOfDay(now);
  let label = "Today";
  let compareLabel = "vs yesterday";
  let isCustom = false;

  if (period === "yesterday") {
    start = addUtcDays(todayStart, -1);
    end = utcEndOfDay(start);
    label = "Yesterday";
    compareLabel = "vs previous day";
  } else if (period === "week") {
    const day = todayStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start = addUtcDays(todayStart, mondayOffset);
    label = "This week";
    compareLabel = "vs last week";
  } else if (period === "month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    label = "This month";
    compareLabel = "vs last month";
  } else if (period === "year") {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    label = "This year";
    compareLabel = "vs last year";
  } else if (period === "custom") {
    const from = parseDateInput(query.startDate || query.from);
    const to = parseDateInput(query.endDate || query.to);
    const fallbackEnd = todayStart;
    const fallbackStart = addUtcDays(todayStart, -6);
    start = from || fallbackStart;
    end = utcEndOfDay(to || fallbackEnd);
    if (start.getTime() > end.getTime()) {
      const nextStart = utcStartOfDay(end);
      end = utcEndOfDay(start);
      start = nextStart;
    }
    label = "Custom";
    compareLabel = "vs previous period";
    isCustom = true;
  }

  const days = dayDiffInclusive(start, end);
  const previousEnd = utcEndOfDay(addUtcDays(start, -1));
  const previousStart = utcStartOfDay(addUtcDays(start, -days));

  return {
    key: period,
    label,
    compareLabel,
    isCustom,
    start,
    end,
    previousStart,
    previousEnd,
    days,
  };
};

const employeeRoles = () =>
  ["branch_manager", "accountant", "inventory_manager", "cashier", "staff"].map(toDbUserRole);

const buildTopProducts = (items = [], take = 60) => {
  const topProductsMap = new Map();

  for (const item of items || []) {
    const id = item.productId;
    if (!id) continue;
    if (!topProductsMap.has(id)) {
      topProductsMap.set(id, {
        productId: id,
        title: item.product?.title || item.title || "",
        units: 0,
        revenue: 0,
      });
    }

    const current = topProductsMap.get(id);
    const units = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    current.units += units;
    current.revenue += units * price;
    if (!current.title && (item.product?.title || item.title)) {
      current.title = item.product?.title || item.title;
    }
  }

  return [...topProductsMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, take);
};

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
    const selectedPeriod = getDashboardPeriod(req.query, now);
    const rangeDays = selectedPeriod.days;
    const chartFrom = selectedPeriod.start;
    const chartTo = selectedPeriod.end;
    const previousRangeFrom = selectedPeriod.previousStart;
    const previousRangeTo = selectedPeriod.previousEnd;
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
    const previousRangeWhere: Record<string, any> = {
      createdAt: { gte: previousRangeFrom, lte: previousRangeTo },
      orderStatus: { notIn: NON_REVENUE_STATUSES },
    };

    if (branchId) {
      revenueWhere.branchId = branchId;
      monthRevenueWhere.branchId = branchId;
      chartWhere.branchId = branchId;
      previousRangeWhere.branchId = branchId;
    }

    const [
      totalCustomers,
      newCustomersThisMonth,
      totalProducts,
      revenueAgg,
      monthRevenueAgg,
      currentRangeAgg,
      previousRangeAgg,
      currentRangeCustomers,
      previousRangeCustomers,
      pendingOrdersCount,
      returnRequestsCount,
      pendingApprovalsCount,
      overdueInvoicesCount,
      recentOrders,
      branchRevenueRows,
      chartOrders,
      branchInventories,
      productsForStock,
      supplierBalances,
      supplierSpendAgg,
      operatingExpenseAgg,
      orderItemsMonth,
      orderItemsAllTime,
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
      prisma.order.aggregate({
        where: chartWhere,
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: previousRangeWhere,
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.user.count({
        where: { role: toDbUserRole("customer"), createdAt: { gte: chartFrom, lte: chartTo } },
      }),
      prisma.user.count({
        where: { role: toDbUserRole("customer"), createdAt: { gte: previousRangeFrom, lte: previousRangeTo } },
      }),
      prisma.order.count({
        where: branchId ? { branchId, orderStatus: "PROCESSING" } : { orderStatus: "PROCESSING" },
      }),
      prisma.order.count({
        where: branchId ? { branchId, orderStatus: "RETURN_REQUESTED" } : { orderStatus: "RETURN_REQUESTED" },
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
      prisma.product.findMany({
        where: {
          deletedAt: null,
          ...(branchId ? { branchInventories: { some: { branchId } } } : {}),
        },
        select: {
          id: true,
          title: true,
          quantityAvailable: true,
          stock: true,
          reorderLevel: true,
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
      prisma.businessExpense.aggregate({
        where: branchId
          ? { branchId, status: "recorded", date: { gte: monthStart, lte: now } }
          : { status: "recorded", date: { gte: monthStart, lte: now } },
        _sum: { amount: true },
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
          title: true,
          quantity: true,
          price: true,
          product: { select: { id: true, title: true } },
        },
      }),
      prisma.orderItem.findMany({
        where: {
          order: {
            orderStatus: { notIn: NON_REVENUE_STATUSES },
            ...(branchId ? { branchId } : {}),
          },
        },
        orderBy: { purchaseDate: "desc" },
        take: 5000,
        select: {
          productId: true,
          title: true,
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
    const rangeRevenue = Number(currentRangeAgg._sum.totalPrice || 0);
    const rangeOrders = Number(currentRangeAgg._count._all || 0);
    const previousRangeRevenue = Number(previousRangeAgg._sum.totalPrice || 0);
    const previousRangeOrders = Number(previousRangeAgg._count._all || 0);

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
      .filter((row) => {
        const quantity = Number(row.quantity || 0);
        const reorderLevel = Number(row.product?.reorderLevel || 0);
        return (
          row.product &&
          row.product.deletedAt === null &&
          (quantity === 0 || (reorderLevel > 0 && quantity <= reorderLevel))
        );
      })
      .map((row) => ({
        productId: row.productId,
        productTitle: row.product?.title || "",
        branchId: row.branchId,
        branchName: row.branch?.name || "",
        quantity: Number(row.quantity || 0),
        reorderLevel: Number(row.product?.reorderLevel || 0),
      }))
      .sort((a, b) => (a.quantity - a.reorderLevel) - (b.quantity - b.reorderLevel));

    if (!branchId) {
      const listedLowStockProductIds = new Set(lowStockRows.map((row) => row.productId).filter(Boolean));
      const catalogLowStockRows = productsForStock
        .filter((product) => {
          const reorderLevel = Number(product.reorderLevel || 0);
          const quantity = Number(product.quantityAvailable ?? product.stock ?? 0);
          return (
            (quantity === 0 || (reorderLevel > 0 && quantity <= reorderLevel)) &&
            !listedLowStockProductIds.has(product.id)
          );
        })
        .map((product) => ({
          productId: product.id,
          productTitle: product.title || "",
          branchId: "catalog-stock",
          branchName: "Catalog stock",
          quantity: Number(product.quantityAvailable ?? product.stock ?? 0),
          reorderLevel: Number(product.reorderLevel || 0),
        }));

      lowStockRows.push(...catalogLowStockRows);
      lowStockRows.sort((a, b) => (a.quantity - a.reorderLevel) - (b.quantity - b.reorderLevel));
    }

    const lowStockUniqueProducts = new Set(lowStockRows.map((row) => row.productId)).size;
    const zeroStockAlerts = new Set(
      lowStockRows.filter((row) => Number(row.quantity || 0) === 0).map((row) => row.productId)
    ).size;
    const lowStockTop = lowStockRows.slice(0, 6);

    const notifications = [];
    if (pendingApprovalsCount > 0) {
      notifications.push({
        type: "approvals_pending",
        message: `${pendingApprovalsCount} approval request(s) pending`,
        href: "/admin/inventory/approvals",
      });
    }
    if (returnRequestsCount > 0) {
      notifications.push({
        type: "return_requests",
        message: `${returnRequestsCount} return request(s) need review`,
        href: "/admin/orders",
      });
    }
    if (pendingOrdersCount > 0) {
      notifications.push({
        type: "orders_processing",
        message: `${pendingOrdersCount} order(s) are currently processing`,
        href: "/admin/orders",
      });
    }
    if (overdueInvoicesCount > 0) {
      notifications.push({
        type: "supplier_overdue",
        message: `${overdueInvoicesCount} supplier invoice(s) overdue`,
        href: "/admin/inventory/invoices",
      });
    }
    if (lowStockUniqueProducts > 0) {
      notifications.push({
        type: "low_stock",
        message: `${lowStockUniqueProducts} product(s) are low on stock`,
        href: "/admin/inventory/products",
      });
    }

    const supplierSpend = Number(supplierSpendAgg._sum.total || 0);
    const operatingExpenses = Number(operatingExpenseAgg._sum.amount || 0);

    const topProductsMtd = buildTopProducts(orderItemsMonth, 60);
    const topProductsAllTime = buildTopProducts(orderItemsAllTime, 60);
    const topProductsPeriod = topProductsMtd.length ? "MTD" : "All time";
    const topProducts = (topProductsMtd.length ? topProductsMtd : topProductsAllTime).slice(0, 5);

    res.json({
      asOf: now.toISOString(),
      rangeDays,
      branchId,
      period: {
        key: selectedPeriod.key,
        label: selectedPeriod.label,
        compareLabel: selectedPeriod.compareLabel,
        isCustom: selectedPeriod.isCustom,
        startDate: selectedPeriod.start.toISOString(),
        endDate: selectedPeriod.end.toISOString(),
      },
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
      rangeStats: {
        revenue: rangeRevenue,
        orders: rangeOrders,
        newCustomers: currentRangeCustomers,
        previousRevenue: previousRangeRevenue,
        previousOrders: previousRangeOrders,
        previousNewCustomers: previousRangeCustomers,
      },
      stockStats: {
        zeroStockAlerts,
      },
      branchCards,
      salesSeries,
      recentOrders: recentOrders.map((order) => toLegacyOrder(order)),
      topProducts,
      topProductsPeriod,
      topProductsLists: {
        mtd: topProductsMtd,
        allTime: topProductsAllTime,
      },
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
        operatingExpenses,
        totalExpenses: supplierSpend + operatingExpenses,
        profitEstimate: monthRevenue - supplierSpend - operatingExpenses,
      },
      notifications,
    });
  } catch (err) {
    console.error("Admin Overview Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
