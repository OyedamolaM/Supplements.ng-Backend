const ApprovalRequest = require("../models/ApprovalRequest");
const BranchInventory = require("../models/BranchInventory");
const InventoryMovement = require("../models/InventoryMovement");
const Order = require("../models/Order");
const ActivityLog = require("../models/ActivityLog");

const applyInventoryAdjustment = async (approval, approverId) => {
  const { items = [] } = approval.payload || {};
  const branchId = approval.branch;
  if (!branchId) return;

  for (const item of items) {
    const current = await BranchInventory.findOne({
      branch: branchId,
      product: item.productId,
    });
    const currentQty = current?.quantity || 0;
    const nextQty = Number(item.quantity) || 0;
    const diff = nextQty - currentQty;

    await BranchInventory.findOneAndUpdate(
      { branch: branchId, product: item.productId },
      { $set: { quantity: nextQty } },
      { upsert: true, new: true }
    );

    if (diff !== 0) {
      await InventoryMovement.create({
        branch: branchId,
        product: item.productId,
        type: "adjustment",
        quantityChange: diff,
        reason: approval.reason || "approval_adjustment",
        referenceType: "approval",
        referenceId: approval._id,
        createdBy: approverId,
      });
    }
  }

  ActivityLog.create({
    user: approverId,
    action: "inventory_adjustment_approved",
    entityType: "approval",
    entityId: approval._id,
    branch: branchId,
    message: "Approved inventory adjustment",
  }).catch(() => null);
};

const applyRefund = async (approval, approverId) => {
  const { orderId } = approval.payload || {};
  if (!orderId) return;

  const order = await Order.findById(orderId).populate("branch", "name isOnline");
  if (!order || order.orderStatus === "Returned") return;

  if (order.branch && !order.branch.isOnline) {
    await Promise.all(
      order.products.map((item) =>
        BranchInventory.findOneAndUpdate(
          { branch: order.branch._id, product: item.product },
          { $inc: { quantity: item.quantity } },
          { upsert: true, new: true }
        )
      )
    );

    await Promise.all(
      order.products.map((item) =>
        InventoryMovement.create({
          branch: order.branch._id,
          product: item.product,
          type: "return",
          quantityChange: item.quantity,
          reason: approval.reason || "refund",
          referenceType: "order",
          referenceId: order._id,
          createdBy: approverId,
        })
      )
    );
  }

  order.orderStatus = "Returned";
  order.returnApprovedBy = approverId;
  await order.save({ validateBeforeSave: false });

  ActivityLog.create({
    user: approverId,
    action: "refund_approved",
    entityType: "order",
    entityId: order._id,
    branch: order.branch?._id || null,
    message: "Approved refund return",
  }).catch(() => null);
};

exports.listApprovals = async (req, res) => {
  try {
    const filter: Record<string, any> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.branchId) filter.branch = req.query.branchId;

    const approvals = await ApprovalRequest.find(filter)
      .populate("requestedBy", "name role")
      .populate("approvedBy", "name role")
      .populate("branch", "name")
      .sort({ createdAt: -1 });
    res.json(approvals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const approval = await ApprovalRequest.findById(req.params.id);
    if (!approval) return res.status(404).json({ message: "Approval not found" });
    if (approval.status !== "pending") {
      return res.status(400).json({ message: "Approval already processed" });
    }

    approval.status = "approved";
    approval.approvedBy = req.user.id;
    await approval.save();

    if (approval.type === "inventory_adjustment") {
      await applyInventoryAdjustment(approval, req.user.id);
    } else if (approval.type === "refund") {
      await applyRefund(approval, req.user.id);
    }

    res.json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const approval = await ApprovalRequest.findById(req.params.id);
    if (!approval) return res.status(404).json({ message: "Approval not found" });
    if (approval.status !== "pending") {
      return res.status(400).json({ message: "Approval already processed" });
    }

    approval.status = "rejected";
    approval.approvedBy = req.user.id;
    await approval.save();

    ActivityLog.create({
      user: req.user.id,
      action: "approval_rejected",
      entityType: "approval",
      entityId: approval._id,
      branch: approval.branch || null,
      message: "Rejected approval request",
    }).catch(() => null);

    res.json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
