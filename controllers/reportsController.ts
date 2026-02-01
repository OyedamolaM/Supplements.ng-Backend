const Order = require("../models/Order");
const BranchInventory = require("../models/BranchInventory");
const InventoryMovement = require("../models/InventoryMovement");
const Supplier = require("../models/Supplier");

const parseDate = (value, fallback) => {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date?.getTime()) ? fallback : date;
};

exports.dailySales = async (req, res) => {
  try {
    const date = parseDate(req.query.date, new Date());
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const match: Record<string, any> = {
      createdAt: { $gte: start, $lte: end },
      orderStatus: { $nin: ["Cancelled", "ReturnRequested", "Returned"] },
    };
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }

    const summary = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: { branch: "$branch", cashier: "$createdBy" },
          totalSales: { $sum: "$totalPrice" },
          totalOrders: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "branches",
          localField: "_id.branch",
          foreignField: "_id",
          as: "branch",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id.cashier",
          foreignField: "_id",
          as: "cashier",
        },
      },
      {
        $project: {
          totalSales: 1,
          totalOrders: 1,
          branchName: { $arrayElemAt: ["$branch.name", 0] },
          cashierName: { $arrayElemAt: ["$cashier.name", 0] },
        },
      },
    ]);

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.salesSummary = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());
    const group = req.query.group || "day";

    const match: Record<string, any> = {
      createdAt: { $gte: from, $lte: to },
      orderStatus: { $nin: ["Cancelled", "ReturnRequested", "Returned"] },
    };
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }

    const unit = group === "month" ? "month" : group === "week" ? "week" : "day";

    const summary = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            period: { $dateTrunc: { date: "$createdAt", unit } },
          },
          totalSales: { $sum: "$totalPrice" },
          totalOrders: { $sum: 1 },
          taxTotal: { $sum: "$taxAmount" },
        },
      },
      { $sort: { "_id.period": 1 } },
    ]);

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.taxSummary = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());

    const match: Record<string, any> = {
      createdAt: { $gte: from, $lte: to },
      orderStatus: { $nin: ["Cancelled", "ReturnRequested", "Returned"] },
    };
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }

    const summary = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          taxableSales: { $sum: "$subtotal" },
          taxTotal: { $sum: "$taxAmount" },
          discountTotal: { $sum: "$discountAmount" },
          grossSales: { $sum: "$totalPrice" },
        },
      },
    ]);

    res.json(summary[0] || { taxableSales: 0, taxTotal: 0, discountTotal: 0, grossSales: 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.inventoryValuation = async (req, res) => {
  try {
    const match: Record<string, any> = {};
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }

    const valuation = await BranchInventory.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "products",
          localField: "product",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$branch",
          totalValue: {
            $sum: { $multiply: ["$quantity", "$product.costPrice"] },
          },
        },
      },
    ]);

    res.json(valuation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.inventoryMovement = async (req, res) => {
  try {
    const from = parseDate(req.query.from, new Date("2000-01-01"));
    const to = parseDate(req.query.to, new Date());

    const match: Record<string, any> = { createdAt: { $gte: from, $lte: to } };
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }
    if (req.query.productId) match.product = req.query.productId;
    if (req.query.type) match.type = req.query.type;

    const movements = await InventoryMovement.find(match)
      .populate("product", "title")
      .populate("branch", "name")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    res.json(movements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.supplierBalances = async (req, res) => {
  try {
    const suppliers = await Supplier.find().select("name balance");
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.returnsReport = async (req, res) => {
  try {
    const match: Record<string, any> = { orderStatus: { $in: ["ReturnRequested", "Returned"] } };
    if (req.user.role === "branch_manager" && req.user.branch) {
      match.branch = req.user.branch;
    } else if (req.query.branchId) {
      match.branch = req.query.branchId;
    }
    const orders = await Order.find(match)
      .populate("user", "name email phone")
      .populate("branch", "name")
      .populate("createdBy", "name");
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
