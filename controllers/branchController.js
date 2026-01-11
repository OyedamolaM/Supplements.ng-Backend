const Branch = require("../models/Branch");
const BranchInventory = require("../models/BranchInventory");
const Order = require("../models/Order");
const User = require("../models/User");
const ActivityLog = require("../models/ActivityLog");
const ApprovalRequest = require("../models/ApprovalRequest");
const InventoryMovement = require("../models/InventoryMovement");

const STAFF_ROLES = [
  "super_admin",
  "admin",
  "branch_manager",
  "accountant",
  "inventory_manager",
  "cashier",
  "staff",
];

exports.listBranches = async (req, res) => {
  try {
    const isAdmin = req.user.role === "super_admin" || req.user.role === "admin";
    const isStaffRestricted = STAFF_ROLES.includes(req.user.role) && !isAdmin;
    const filter = isStaffRestricted
      ? req.user.branch
        ? { _id: req.user.branch }
        : { _id: null }
      : {};
    let branches = await Branch.find(filter).sort({ name: 1 });
    if (branches.length === 0 && (req.user.role === "super_admin" || req.user.role === "admin")) {
      const onlineBranch = await Branch.create({
        name: "Online",
        address: "Online Store",
        phone: "N/A",
        region: "",
        isOnline: true
      });
      branches = [onlineBranch];
    }
    res.json(branches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    const { name, address, phone, region, isOnline } = req.body;
    if (!name || !address || !phone) {
      return res.status(400).json({ message: "Name, address and phone are required" });
    }
    const branch = await Branch.create({
      name,
      address,
      phone,
      region: region || "",
      isOnline: Boolean(isOnline)
    });
    res.status(201).json(branch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranch = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const branch = await Branch.findById(req.params.id);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    res.json(branch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const updateData = { ...req.body };
    if (updateData.isOnline !== undefined) {
      updateData.isOnline = Boolean(updateData.isOnline);
    }
    const branch = await Branch.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    res.json(branch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndDelete(req.params.id);
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    res.json({ message: "Branch removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchStaff = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const staff = await User.find({
      role: { $in: STAFF_ROLES },
      branch: req.params.id,
    }).select("-password");
    res.json(staff);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchCustomers = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const orders = await Order.find({ branch: req.params.id }).select("user");
    const customerIds = [...new Set(orders.map((o) => o.user?.toString()))].filter(Boolean);
    const customers = await User.find({ _id: { $in: customerIds } }).select("-password");
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchOrders = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const orders = await Order.find({ branch: req.params.id })
      .populate("user", "name email phone")
      .populate("branch", "name");
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchInventory = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const inventory = await BranchInventory.find({ branch: req.params.id })
      .populate("product", "title sellingPrice price sku");
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateBranchInventory = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch?.toString() !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { items, reason } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "items array is required" });
    }
    if (!reason) {
      return res.status(400).json({ message: "Reason is required for inventory adjustments" });
    }

    const threshold = Number(process.env.INVENTORY_APPROVAL_THRESHOLD || 0);
    if (threshold > 0) {
      const currentInventory = await BranchInventory.find({ branch: req.params.id });
      const currentMap = new Map(
        currentInventory.map((item) => [item.product.toString(), item.quantity])
      );
      const requiresApproval = items.some((item) => {
        const currentQty = currentMap.get(item.productId) || 0;
        const nextQty = Number(item.quantity) || 0;
        return Math.abs(nextQty - currentQty) >= threshold;
      });

      if (requiresApproval) {
        const approval = await ApprovalRequest.create({
          type: "inventory_adjustment",
          branch: req.params.id,
          requestedBy: req.user.id,
          reason,
          payload: { items },
        });
        return res.status(202).json({
          message: "Approval required for large inventory adjustment",
          approvalId: approval._id,
        });
      }
    }

    const results = [];
    for (const item of items) {
      const current = await BranchInventory.findOne({
        branch: req.params.id,
        product: item.productId,
      });
      const currentQty = current?.quantity || 0;
      const nextQty = Number(item.quantity) || 0;
      const diff = nextQty - currentQty;

      const updated = await BranchInventory.findOneAndUpdate(
        { branch: req.params.id, product: item.productId },
        { $set: { quantity: nextQty } },
        { upsert: true, new: true }
      );
      results.push(updated);

      if (diff !== 0) {
        await InventoryMovement.create({
          branch: req.params.id,
          product: item.productId,
          type: "adjustment",
          quantityChange: diff,
          reason,
          referenceType: "manual_adjustment",
          referenceId: null,
          createdBy: req.user.id,
        });
      }
    }
    res.json(results);

    ActivityLog.create({
      user: req.user.id,
      action: "inventory_adjusted",
      entityType: "branch_inventory",
      branch: req.params.id,
      message: "Adjusted branch inventory",
      meta: { items: items.length, reason }
    }).catch(() => null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
