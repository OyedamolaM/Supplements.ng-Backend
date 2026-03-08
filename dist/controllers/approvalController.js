"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, newId, fromDbUserRole } = require("../utils/prismaLegacy");
const toDbApprovalType = (value) => {
    const key = (value || "").toString().trim().toLowerCase();
    if (key === "refund")
        return "REFUND";
    if (key === "inventory_adjustment")
        return "INVENTORY_ADJUSTMENT";
    return undefined;
};
const toDbApprovalStatus = (value) => {
    const key = (value || "").toString().trim().toLowerCase();
    if (key === "approved")
        return "APPROVED";
    if (key === "rejected")
        return "REJECTED";
    if (key === "pending")
        return "PENDING";
    return undefined;
};
const toLegacyApproval = (approval) => ({
    _id: approval.id,
    id: approval.id,
    type: (approval.type || "").toLowerCase(),
    status: (approval.status || "").toLowerCase(),
    branch: approval.branch
        ? {
            _id: approval.branch.id,
            id: approval.branch.id,
            name: approval.branch.name,
        }
        : approval.branchId || null,
    requestedBy: approval.requestedBy
        ? {
            _id: approval.requestedBy.id,
            id: approval.requestedBy.id,
            name: approval.requestedBy.name,
            role: fromDbUserRole(approval.requestedBy.role),
        }
        : approval.requestedById,
    approvedBy: approval.approvedBy
        ? {
            _id: approval.approvedBy.id,
            id: approval.approvedBy.id,
            name: approval.approvedBy.name,
            role: fromDbUserRole(approval.approvedBy.role),
        }
        : approval.approvedById || null,
    reason: approval.reason || "",
    payload: approval.payload || {},
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
});
const applyInventoryAdjustment = async (approval, approverId) => {
    const payload = approval.payload || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const branchId = approval.branchId;
    if (!branchId)
        return;
    for (const item of items) {
        const productId = item.productId || item.product;
        if (!productId)
            continue;
        const current = await prisma.branchInventory.findUnique({
            where: {
                branchId_productId: {
                    branchId,
                    productId,
                },
            },
            select: { quantity: true },
        });
        const currentQty = current?.quantity || 0;
        const nextQty = Number(item.quantity) || 0;
        const diff = nextQty - currentQty;
        await prisma.branchInventory.upsert({
            where: {
                branchId_productId: {
                    branchId,
                    productId,
                },
            },
            create: {
                id: newId(),
                branchId,
                productId,
                quantity: nextQty,
            },
            update: {
                quantity: nextQty,
            },
        });
        if (diff !== 0) {
            await prisma.inventoryMovement.create({
                data: {
                    id: newId(),
                    branchId,
                    productId,
                    type: "ADJUSTMENT",
                    quantityChange: diff,
                    reason: approval.reason || "approval_adjustment",
                    referenceType: "approval",
                    referenceId: approval.id,
                    createdById: approverId,
                },
            });
        }
    }
    prisma.activityLog
        .create({
        data: {
            id: newId(),
            userId: approverId,
            action: "inventory_adjustment_approved",
            entityType: "approval",
            entityId: approval.id,
            branchId,
            message: "Approved inventory adjustment",
        },
    })
        .catch(() => null);
};
const applyRefund = async (approval, approverId) => {
    const payload = approval.payload || {};
    const orderId = payload.orderId;
    if (!orderId)
        return;
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            branch: {
                select: { id: true, isOnline: true },
            },
            items: {
                select: { productId: true, quantity: true },
            },
        },
    });
    if (!order || order.orderStatus === "RETURNED")
        return;
    if (order.branch && !order.branch.isOnline) {
        for (const item of order.items) {
            const existing = await prisma.branchInventory.findUnique({
                where: {
                    branchId_productId: {
                        branchId: order.branch.id,
                        productId: item.productId,
                    },
                },
                select: { quantity: true },
            });
            const nextQty = (existing?.quantity || 0) + item.quantity;
            await prisma.branchInventory.upsert({
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
                    quantity: nextQty,
                },
                update: {
                    quantity: nextQty,
                },
            });
            await prisma.inventoryMovement.create({
                data: {
                    id: newId(),
                    branchId: order.branch.id,
                    productId: item.productId,
                    type: "RETURN",
                    quantityChange: item.quantity,
                    reason: approval.reason || "refund",
                    referenceType: "order",
                    referenceId: order.id,
                    createdById: approverId,
                },
            });
        }
    }
    await prisma.order.update({
        where: { id: order.id },
        data: {
            orderStatus: "RETURNED",
            returnApprovedById: approverId,
        },
    });
    prisma.activityLog
        .create({
        data: {
            id: newId(),
            userId: approverId,
            action: "refund_approved",
            entityType: "order",
            entityId: order.id,
            branchId: order.branch?.id || null,
            message: "Approved refund return",
        },
    })
        .catch(() => null);
};
exports.listApprovals = async (req, res) => {
    try {
        const where = {};
        const dbStatus = toDbApprovalStatus(req.query.status);
        const dbType = toDbApprovalType(req.query.type);
        if (dbStatus)
            where.status = dbStatus;
        if (dbType)
            where.type = dbType;
        if (req.query.branchId)
            where.branchId = req.query.branchId;
        const approvals = await prisma.approvalRequest.findMany({
            where,
            include: {
                requestedBy: { select: { id: true, name: true, role: true } },
                approvedBy: { select: { id: true, name: true, role: true } },
                branch: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(approvals.map((approval) => toLegacyApproval(approval)));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.approveRequest = async (req, res) => {
    try {
        const approval = await prisma.approvalRequest.findUnique({
            where: { id: req.params.id },
        });
        if (!approval)
            return res.status(404).json({ message: "Approval not found" });
        if (approval.status !== "PENDING") {
            return res.status(400).json({ message: "Approval already processed" });
        }
        const updated = await prisma.approvalRequest.update({
            where: { id: req.params.id },
            data: {
                status: "APPROVED",
                approvedById: req.user.id,
            },
            include: {
                requestedBy: { select: { id: true, name: true, role: true } },
                approvedBy: { select: { id: true, name: true, role: true } },
                branch: { select: { id: true, name: true } },
            },
        });
        if (updated.type === "INVENTORY_ADJUSTMENT") {
            await applyInventoryAdjustment(updated, req.user.id);
        }
        else if (updated.type === "REFUND") {
            await applyRefund(updated, req.user.id);
        }
        res.json(toLegacyApproval(updated));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.rejectRequest = async (req, res) => {
    try {
        const approval = await prisma.approvalRequest.findUnique({
            where: { id: req.params.id },
        });
        if (!approval)
            return res.status(404).json({ message: "Approval not found" });
        if (approval.status !== "PENDING") {
            return res.status(400).json({ message: "Approval already processed" });
        }
        const updated = await prisma.approvalRequest.update({
            where: { id: req.params.id },
            data: {
                status: "REJECTED",
                approvedById: req.user.id,
            },
            include: {
                requestedBy: { select: { id: true, name: true, role: true } },
                approvedBy: { select: { id: true, name: true, role: true } },
                branch: { select: { id: true, name: true } },
            },
        });
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: req.user.id,
                action: "approval_rejected",
                entityType: "approval",
                entityId: updated.id,
                branchId: updated.branchId || null,
                message: "Rejected approval request",
            },
        })
            .catch(() => null);
        res.json(toLegacyApproval(updated));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
