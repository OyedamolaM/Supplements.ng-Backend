const { prisma, newId, fromDbUserRole } = require("../utils/prismaLegacy");

const NON_REVENUE_STATUSES = ["CANCELLED", "RETURN_REQUESTED", "RETURNED"];
const ACTIVE_EXPENSE_STATUS = "recorded";
const EXPIRY_WINDOW_DAYS = 60;

const isAdminRole = (role = "") => role === "super_admin" || role === "admin";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dayDiffInclusive = (start, end) => {
  const startDay = utcStartOfDay(start);
  const endDay = utcStartOfDay(end);
  const diff = endDay.getTime() - startDay.getTime();
  return Math.max(1, Math.floor(diff / 86400000) + 1);
};

const toDayKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
};

const getFinancePeriod = (query, now = new Date()) => {
  const rawPeriod = (query.period || "month").toString();
  const period = ["today", "yesterday", "week", "month", "year", "custom"].includes(rawPeriod)
    ? rawPeriod
    : "month";
  const todayStart = utcStartOfDay(now);
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let end = utcEndOfDay(now);
  let label = "This month";
  let compareLabel = "vs last month";
  let isCustom = false;

  if (period === "today") {
    start = todayStart;
    label = "Today";
    compareLabel = "vs yesterday";
  } else if (period === "yesterday") {
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
  } else if (period === "year") {
    start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    label = "This year";
    compareLabel = "vs last year";
  } else if (period === "custom") {
    const from = parseDateInput(query.startDate || query.from);
    const to = parseDateInput(query.endDate || query.to);
    const fallbackStart = addUtcDays(todayStart, -6);
    start = from || fallbackStart;
    end = utcEndOfDay(to || todayStart);
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

const resolveBranchId = (req, source: any = {}) => {
  if (!isAdminRole(req.user?.role) && req.user?.branch) {
    return req.user.branch;
  }
  const value = source.branchId ?? req.query?.branchId;
  return value ? value.toString() : null;
};

const normalizeCategory = (value = "") =>
  value.toString().trim().toLowerCase().replace(/[_-]+/g, " ");

const isSalaryCategory = (category = "") => {
  const normalized = normalizeCategory(category);
  return ["salary", "salaries", "payroll", "wage", "wages", "commission", "allowance", "bonus", "staff"].some((key) =>
    normalized.includes(key)
  );
};

const isTaxCategory = (category = "") => {
  const normalized = normalizeCategory(category);
  return ["tax", "vat", "paye", "withholding", "levy", "duty"].some((key) => normalized.includes(key));
};

const expenseClass = (category = "") => {
  if (isSalaryCategory(category)) return "salaries";
  if (isTaxCategory(category)) return "tax";
  return "operations";
};

const toLegacyExpense = (expense) => ({
  _id: expense.id,
  id: expense.id,
  date: expense.date,
  category: expense.category || "General",
  description: expense.description || "",
  vendor: expense.vendor || "",
  paymentMethod: expense.paymentMethod || "",
  reference: expense.reference || "",
  amount: Number(expense.amount || 0),
  notes: expense.notes || "",
  status: expense.status || ACTIVE_EXPENSE_STATUS,
  branch: expense.branch
    ? {
        _id: expense.branch.id,
        id: expense.branch.id,
        name: expense.branch.name,
      }
    : expense.branchId || null,
  createdBy: expense.createdBy
    ? {
        _id: expense.createdBy.id,
        id: expense.createdBy.id,
        name: expense.createdBy.name,
        email: expense.createdBy.email,
        role: fromDbUserRole(expense.createdBy.role),
      }
    : expense.createdById || null,
  createdAt: expense.createdAt,
  updatedAt: expense.updatedAt,
});

const expenseInclude = {
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
};

const createDailyRows = (start, end) => {
  const rowsByDate = new Map();
  for (let cursor = utcStartOfDay(start); cursor.getTime() <= end.getTime(); cursor = addUtcDays(cursor, 1)) {
    const key = cursor.toISOString().slice(0, 10);
    rowsByDate.set(key, {
      date: key,
      grossSales: 0,
      revenue: 0,
      taxCollected: 0,
      cogs: 0,
      grossProfit: 0,
      expenses: 0,
      salaries: 0,
      operations: 0,
      supplierSpend: 0,
      supplierPayments: 0,
      cashIn: 0,
      cashOut: 0,
      cashflow: 0,
      netProfit: 0,
      orders: 0,
    });
  }
  return rowsByDate;
};

const addAmount = (target, key, value) => {
  target[key] = Number(target[key] || 0) + Number(value || 0);
};

const summarizeOrders = (orders, rowsByDate) => {
  const totals = {
    revenue: 0,
    grossSales: 0,
    discounts: 0,
    netSales: 0,
    taxCollected: 0,
    cogs: 0,
    grossProfit: 0,
    salesCount: 0,
    unitsSold: 0,
    cashIn: 0,
    customerReceivables: 0,
  };

  for (const order of orders) {
    const row = rowsByDate?.get(toDayKey(order.createdAt));
    const orderItems = Array.isArray(order.items) ? order.items : [];
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discountAmount || 0);
    const netSales = Math.max(0, subtotal - discount);
    const revenue = Number(order.totalPrice || 0);
    const taxCollected = Number(order.taxAmount || 0);
    const cogs = orderItems.reduce((sum, item) => {
      const quantity = Number(item.quantity || 0);
      const unitCost = Number(item.product?.costPrice || 0);
      return sum + quantity * unitCost;
    }, 0);
    const units = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const isPaid = order.paymentStatus === "PAID";

    totals.grossSales += subtotal;
    totals.discounts += discount;
    totals.netSales += netSales;
    totals.revenue += revenue;
    totals.taxCollected += taxCollected;
    totals.cogs += cogs;
    totals.salesCount += 1;
    totals.unitsSold += units;
    if (isPaid) {
      totals.cashIn += revenue;
    } else {
      totals.customerReceivables += revenue;
    }

    if (row) {
      addAmount(row, "grossSales", subtotal);
      addAmount(row, "revenue", revenue);
      addAmount(row, "taxCollected", taxCollected);
      addAmount(row, "cogs", cogs);
      addAmount(row, "cashIn", isPaid ? revenue : 0);
      row.orders += 1;
    }
  }

  totals.grossProfit = totals.netSales - totals.cogs;
  return totals;
};

const summarizeExpenses = (expenses, rowsByDate) => {
  const categoryMap = new Map();
  const totals = {
    recordedExpenses: 0,
    salaryExpenses: 0,
    taxExpense: 0,
    operationsExpenses: 0,
  };

  for (const expense of expenses) {
    const amount = Number(expense.amount || 0);
    const category = expense.category || "General";
    const cls = expenseClass(category);
    const row = rowsByDate?.get(toDayKey(expense.date));

    totals.recordedExpenses += amount;
    if (cls === "salaries") totals.salaryExpenses += amount;
    if (cls === "tax") totals.taxExpense += amount;
    if (cls === "operations") totals.operationsExpenses += amount;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        category,
        amount: 0,
        count: 0,
        class: cls,
      });
    }
    const categoryRow = categoryMap.get(category);
    categoryRow.amount += amount;
    categoryRow.count += 1;

    if (row) {
      addAmount(row, "expenses", amount);
      addAmount(row, cls === "salaries" ? "salaries" : cls === "tax" ? "operations" : "operations", amount);
      addAmount(row, "cashOut", amount);
    }
  }

  return {
    ...totals,
    byCategory: [...categoryMap.values()].sort((a, b) => b.amount - a.amount),
  };
};

const summarizeSupplierInvoices = (supplierInvoices, supplierPayments, rowsByDate) => {
  const totals = {
    supplierSpend: 0,
    supplierPayments: 0,
    supplierTax: 0,
    supplierBalanceCreated: 0,
    supplierInvoiceCount: supplierInvoices.length,
  };

  for (const invoice of supplierInvoices) {
    const row = rowsByDate?.get(toDayKey(invoice.dateSupplied));
    const total = Number(invoice.total || 0);
    totals.supplierSpend += total;
    totals.supplierTax += Number(invoice.tax || 0);
    totals.supplierBalanceCreated += Number(invoice.balance || 0);
    if (row) addAmount(row, "supplierSpend", total);
  }

  for (const payment of supplierPayments) {
    const row = rowsByDate?.get(toDayKey(payment.date));
    const amount = Number(payment.amount || 0);
    totals.supplierPayments += amount;
    if (row) {
      addAmount(row, "supplierPayments", amount);
      addAmount(row, "cashOut", amount);
    }
  }

  return totals;
};

const finalizeDailyRows = (rowsByDate) =>
  [...rowsByDate.values()].map((row) => {
    row.grossProfit = row.grossSales - row.cogs;
    row.cashflow = row.cashIn - row.cashOut;
    row.netProfit = row.grossProfit - row.expenses;
    return row;
  });

const buildExpirySummary = (expiryRows, now = new Date()) => {
  const today = utcStartOfDay(now);
  const expiredProductIds = new Set();
  const expiringProductIds = new Set();
  let expiredValue = 0;
  let expiringValue = 0;

  const rows = expiryRows
    .map((row) => {
      const expiryDate = row.product?.expiryDate ? new Date(row.product.expiryDate) : null;
      const quantity = Number(row.quantity || 0);
      const value = quantity * Number(row.product?.costPrice || 0);
      const expired = Boolean(expiryDate && expiryDate.getTime() < today.getTime());
      if (expired) {
        expiredProductIds.add(row.productId);
        expiredValue += value;
      } else {
        expiringProductIds.add(row.productId);
        expiringValue += value;
      }
      return {
        productId: row.productId,
        title: row.product?.title || "",
        branchId: row.branchId,
        branchName: row.branch?.name || "",
        quantity,
        costValue: value,
        expiryDate: expiryDate?.toISOString() || null,
        status: expired ? "expired" : "expiring_soon",
      };
    })
    .sort((a, b) => new Date(a.expiryDate || 0).getTime() - new Date(b.expiryDate || 0).getTime())
    .slice(0, 30);

  return {
    expiredCount: expiredProductIds.size,
    expiringSoonCount: expiringProductIds.size,
    expiredValue,
    expiringSoonValue: expiringValue,
    totalRiskValue: expiredValue + expiringValue,
    windowDays: EXPIRY_WINDOW_DAYS,
    rows,
  };
};

const buildHealth = ({ netProfit, netMargin, cashflow, supplierDebt, customerReceivables, revenue, expiryRiskValue }) => {
  let score = 100;
  const alerts = [];

  if (netProfit < 0) {
    score -= 30;
    alerts.push("The selected period is currently at a loss.");
  } else if (netMargin < 0.1 && revenue > 0) {
    score -= 12;
    alerts.push("Net margin is under 10% for the selected period.");
  }

  if (cashflow < 0) {
    score -= 20;
    alerts.push("Cashflow is negative in this period.");
  }

  if (supplierDebt > Math.max(revenue, 1) * 0.5) {
    score -= 15;
    alerts.push("Supplier debt is high against current revenue.");
  }

  if (customerReceivables > Math.max(revenue, 1) * 0.35) {
    score -= 10;
    alerts.push("A notable share of sales is still unpaid.");
  }

  if (expiryRiskValue > Math.max(revenue, 1) * 0.15) {
    score -= 10;
    alerts.push("Expiry risk is material against current sales.");
  }

  const finalScore = clamp(Math.round(score), 0, 100);
  const status = finalScore >= 75 ? "Healthy" : finalScore >= 55 ? "Stable" : finalScore >= 35 ? "Watchlist" : "At risk";

  return {
    score: finalScore,
    status,
    alerts,
  };
};

const buildFinanceSnapshot = async ({ start, end, branchId, includeDetails = false }) => {
  const orderWhere: Record<string, any> = {
    createdAt: { gte: start, lte: end },
    orderStatus: { notIn: NON_REVENUE_STATUSES },
    ...(branchId ? { branchId } : {}),
  };
  const supplierInvoiceWhere: Record<string, any> = {
    dateSupplied: { gte: start, lte: end },
    ...(branchId ? { branchId } : {}),
  };
  const supplierPaymentWhere: Record<string, any> = {
    date: { gte: start, lte: end },
    ...(branchId ? { invoice: { branchId } } : {}),
  };
  const expenseWhere: Record<string, any> = {
    date: { gte: start, lte: end },
    status: ACTIVE_EXPENSE_STATUS,
    ...(branchId ? { branchId } : {}),
  };
  const debtWhere: Record<string, any> = {
    balance: { gt: 0 },
    ...(branchId ? { branchId } : {}),
  };
  const receivablesWhere: Record<string, any> = {
    paymentStatus: "PENDING",
    orderStatus: { notIn: NON_REVENUE_STATUSES },
    ...(branchId ? { branchId } : {}),
  };
  const expiryWindowEnd = utcEndOfDay(addUtcDays(new Date(), EXPIRY_WINDOW_DAYS));
  const expiryWhere: Record<string, any> = {
    quantity: { gt: 0 },
    ...(branchId ? { branchId } : {}),
    product: {
      deletedAt: null,
      expiryDate: { not: null, lte: expiryWindowEnd },
    },
  };

  const [
    orders,
    supplierInvoices,
    supplierPayments,
    expenses,
    supplierDebtAgg,
    customerReceivableAgg,
    expiryInventories,
  ] = await Promise.all([
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        createdAt: true,
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
        totalPrice: true,
        paymentStatus: true,
        branch: { select: { id: true, name: true } },
        items: {
          select: {
            quantity: true,
            price: true,
            product: { select: { costPrice: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplierInvoice.findMany({
      where: supplierInvoiceWhere,
      select: {
        id: true,
        invoiceNumber: true,
        reference: true,
        dateSupplied: true,
        subtotal: true,
        tax: true,
        total: true,
        amountPaid: true,
        balance: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { dateSupplied: "desc" },
    }),
    prisma.supplierInvoicePayment.findMany({
      where: supplierPaymentWhere,
      select: {
        id: true,
        amount: true,
        date: true,
        invoice: { select: { id: true, branchId: true } },
      },
      orderBy: { date: "desc" },
    }),
    prisma.businessExpense.findMany({
      where: expenseWhere,
      include: expenseInclude,
      orderBy: { date: "desc" },
    }),
    prisma.supplierInvoice.aggregate({
      where: debtWhere,
      _sum: { balance: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: receivablesWhere,
      _sum: { totalPrice: true },
      _count: { _all: true },
    }),
    prisma.branchInventory.findMany({
      where: expiryWhere,
      include: {
        branch: { select: { id: true, name: true } },
        product: { select: { id: true, title: true, costPrice: true, expiryDate: true } },
      },
      orderBy: { product: { expiryDate: "asc" } },
      take: includeDetails ? 200 : 50,
    }),
  ]);

  const rowsByDate = createDailyRows(start, end);
  const sales = summarizeOrders(orders, rowsByDate);
  const expenseTotals = summarizeExpenses(expenses, rowsByDate);
  const supplierTotals = summarizeSupplierInvoices(supplierInvoices, supplierPayments, rowsByDate);
  const dailyRows = finalizeDailyRows(rowsByDate);
  const expiries = buildExpirySummary(expiryInventories);

  const totalExpenses = expenseTotals.recordedExpenses;
  const netProfit = sales.grossProfit - totalExpenses;
  const loss = Math.max(0, -netProfit);
  const netMargin = sales.netSales > 0 ? netProfit / sales.netSales : 0;
  const grossMargin = sales.netSales > 0 ? sales.grossProfit / sales.netSales : 0;
  const supplierDebt = Number(supplierDebtAgg._sum.balance || 0);
  const customerReceivables = Number(customerReceivableAgg._sum.totalPrice || 0);
  const cashOut = expenseTotals.recordedExpenses + supplierTotals.supplierPayments;
  const cashflow = sales.cashIn - cashOut;

  const summary = {
    revenue: sales.revenue,
    grossSales: sales.grossSales,
    netSales: sales.netSales,
    discounts: sales.discounts,
    salesCount: sales.salesCount,
    orderCount: sales.salesCount,
    unitsSold: sales.unitsSold,
    averageOrderValue: sales.salesCount ? sales.revenue / sales.salesCount : 0,
    cogs: sales.cogs,
    grossProfit: sales.grossProfit,
    grossMargin,
    netProfit,
    netMargin,
    profitEstimate: netProfit,
    profitOrLoss: netProfit >= 0 ? "Profit" : "Loss",
    loss,
    recordedExpenses: totalExpenses,
    operationsExpenses: expenseTotals.operationsExpenses,
    salaryExpenses: expenseTotals.salaryExpenses,
    taxExpense: expenseTotals.taxExpense,
    supplierSpend: supplierTotals.supplierSpend,
    supplierPayments: supplierTotals.supplierPayments,
    supplierInvoiceCount: supplierTotals.supplierInvoiceCount,
    expenseCount: expenses.length,
    totalExpenses,
    taxCollected: sales.taxCollected,
    supplierTax: supplierTotals.supplierTax,
    taxLiabilityEstimate: Math.max(0, sales.taxCollected - expenseTotals.taxExpense),
    cashIn: sales.cashIn,
    cashOut,
    cashflow,
    supplierDebt,
    customerReceivables,
    netDebt: supplierDebt - customerReceivables,
    expiryRiskValue: expiries.totalRiskValue,
  };

  const profitStatement = [
    { label: "Gross sales", amount: sales.grossSales, type: "income" },
    { label: "Discounts", amount: -sales.discounts, type: "contra" },
    { label: "Net sales", amount: sales.netSales, type: "income" },
    { label: "Cost of goods sold", amount: -sales.cogs, type: "cost" },
    { label: "Gross profit", amount: sales.grossProfit, type: "profit" },
    { label: "Operations", amount: -expenseTotals.operationsExpenses, type: "expense" },
    { label: "Salaries", amount: -expenseTotals.salaryExpenses, type: "expense" },
    { label: "Tax paid/recorded", amount: -expenseTotals.taxExpense, type: "expense" },
    { label: netProfit >= 0 ? "Net profit" : "Net loss", amount: netProfit, type: netProfit >= 0 ? "profit" : "loss" },
  ];

  const tax = {
    collected: sales.taxCollected,
    paidOrRecorded: expenseTotals.taxExpense,
    supplierInvoiceTax: supplierTotals.supplierTax,
    liabilityEstimate: Math.max(0, sales.taxCollected - expenseTotals.taxExpense),
  };

  const cashflowSummary = {
    cashIn: sales.cashIn,
    cashOut,
    supplierPayments: supplierTotals.supplierPayments,
    expensePayments: expenseTotals.recordedExpenses,
    netCashflow: cashflow,
    receivables: sales.customerReceivables,
  };

  const debts = {
    supplierDebt,
    supplierDebtCount: Number(supplierDebtAgg._count._all || 0),
    customerReceivables,
    customerReceivableCount: Number(customerReceivableAgg._count._all || 0),
    netDebt: supplierDebt - customerReceivables,
  };

  const health = buildHealth({
    netProfit,
    netMargin,
    cashflow,
    supplierDebt,
    customerReceivables,
    revenue: sales.revenue,
    expiryRiskValue: expiries.totalRiskValue,
  });

  return {
    summary,
    dailyRows,
    expenses: includeDetails ? expenses.slice(0, 200).map(toLegacyExpense) : [],
    supplierInvoices: includeDetails
      ? supplierInvoices.slice(0, 200).map((invoice) => ({
          _id: invoice.id,
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber || "",
          reference: invoice.reference || "",
          dateSupplied: invoice.dateSupplied,
          subtotal: Number(invoice.subtotal || 0),
          tax: Number(invoice.tax || 0),
          total: Number(invoice.total || 0),
          amountPaid: Number(invoice.amountPaid || 0),
          balance: Number(invoice.balance || 0),
          status: (invoice.status || "").toString().toLowerCase(),
          supplier: invoice.supplier
            ? { _id: invoice.supplier.id, id: invoice.supplier.id, name: invoice.supplier.name }
            : null,
          branch: invoice.branch
            ? { _id: invoice.branch.id, id: invoice.branch.id, name: invoice.branch.name }
            : null,
        }))
      : [],
    profitStatement,
    expenseBreakdown: expenseTotals.byCategory,
    tax,
    cashflow: cashflowSummary,
    debts,
    expiries,
    health,
  };
};

const getFinanceSummary = async (req, res) => {
  try {
    const period = getFinancePeriod(req.query || {});
    const branchId = resolveBranchId(req, req.query || {});

    const [current, previous] = await Promise.all([
      buildFinanceSnapshot({
        start: period.start,
        end: period.end,
        branchId,
        includeDetails: true,
      }),
      buildFinanceSnapshot({
        start: period.previousStart,
        end: period.previousEnd,
        branchId,
        includeDetails: false,
      }),
    ]);

    res.json({
      period: {
        key: period.key,
        label: period.label,
        compareLabel: period.compareLabel,
        isCustom: period.isCustom,
        from: period.start.toISOString(),
        to: period.end.toISOString(),
        startDate: period.start.toISOString(),
        endDate: period.end.toISOString(),
        branchId,
      },
      summary: current.summary,
      previousSummary: previous.summary,
      dailyRows: current.dailyRows,
      expenses: current.expenses,
      supplierInvoices: current.supplierInvoices,
      profitStatement: current.profitStatement,
      expenseBreakdown: current.expenseBreakdown,
      tax: current.tax,
      cashflow: current.cashflow,
      debts: current.debts,
      expiries: current.expiries,
      health: current.health,
    });
  } catch (error) {
    console.error("Finance summary error:", error);
    res.status(500).json({ message: "Unable to load finance summary", error: error.message });
  }
};

const listExpenses = async (req, res) => {
  try {
    const period = getFinancePeriod(req.query || {});
    const branchId = resolveBranchId(req, req.query || {});
    const status = (req.query.status || ACTIVE_EXPENSE_STATUS).toString();
    const category = req.query.category ? req.query.category.toString() : "";

    const where: Record<string, any> = {
      date: { gte: period.start, lte: period.end },
      ...(status === "all" ? {} : { status }),
      ...(category ? { category } : {}),
      ...(branchId ? { branchId } : {}),
    };

    const expenses = await prisma.businessExpense.findMany({
      where,
      include: expenseInclude,
      orderBy: { date: "desc" },
      take: 300,
    });

    res.json(expenses.map(toLegacyExpense));
  } catch (error) {
    res.status(500).json({ message: "Unable to load expenses", error: error.message });
  }
};

const createExpense = async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);
    const date = parseDateInput(req.body?.date) || new Date();
    const branchId = resolveBranchId(req, req.body || {});

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Expense amount must be greater than zero" });
    }

    if (branchId) {
      const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
      if (!branch) return res.status(404).json({ message: "Branch not found" });
    }

    const expense = await prisma.businessExpense.create({
      data: {
        id: newId(),
        date: utcStartOfDay(date),
        category: (req.body?.category || "General").toString().trim() || "General",
        description: (req.body?.description || "").toString().trim(),
        vendor: (req.body?.vendor || "").toString().trim(),
        paymentMethod: (req.body?.paymentMethod || "").toString().trim(),
        reference: (req.body?.reference || "").toString().trim(),
        amount,
        notes: (req.body?.notes || "").toString().trim(),
        branchId,
        createdById: req.user?.id || req.user?._id || null,
      },
      include: expenseInclude,
    });

    if (req.user?.id || req.user?._id) {
      await prisma.activityLog.create({
        data: {
          id: newId(),
          userId: req.user.id || req.user._id,
          action: "finance.expense_created",
          entityType: "business_expense",
          entityId: expense.id,
          branchId,
          message: `Recorded ${expense.category} expense`,
          meta: {
            amount,
            category: expense.category,
            description: expense.description,
          },
        },
      });
    }

    res.status(201).json(toLegacyExpense(expense));
  } catch (error) {
    console.error("Create expense error:", error);
    res.status(500).json({ message: "Unable to record expense", error: error.message });
  }
};

const voidExpense = async (req, res) => {
  try {
    const existing = await prisma.businessExpense.findUnique({
      where: { id: req.params.id },
      select: { id: true, branchId: true },
    });
    if (!existing) return res.status(404).json({ message: "Expense not found" });

    if (!isAdminRole(req.user?.role) && req.user?.branch && existing.branchId !== req.user.branch) {
      return res.status(403).json({ message: "Access denied" });
    }

    const expense = await prisma.businessExpense.update({
      where: { id: req.params.id },
      data: { status: "void" },
      include: expenseInclude,
    });

    res.json(toLegacyExpense(expense));
  } catch (error) {
    res.status(500).json({ message: "Unable to void expense", error: error.message });
  }
};

module.exports = {
  getFinanceSummary,
  listExpenses,
  createExpense,
  voidExpense,
};
