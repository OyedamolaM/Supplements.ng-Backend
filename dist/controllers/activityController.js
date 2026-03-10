"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, fromDbUserRole } = require("../utils/prismaLegacy");
const classifyActivityCategory = (action = "", entityType = "") => {
    const normalizedAction = action.toString().trim().toLowerCase();
    const normalizedEntity = entityType.toString().trim().toLowerCase();
    if (normalizedAction === "login")
        return "login";
    if ([
        "sale_created",
        "customer_order_created",
        "order_status_update",
        "order_claimed",
        "refund_requested",
        "refund_approved",
        "order_returned",
    ].includes(normalizedAction) ||
        normalizedEntity === "order") {
        return "orders";
    }
    if ([
        "inventory_adjusted",
        "inventory_adjustment_approved",
        "supplier_invoice_created",
    ].includes(normalizedAction)) {
        return "inventory";
    }
    if (["customer_created", "customer_updated", "staff_created", "staff_updated"].includes(normalizedAction) ||
        normalizedEntity === "user") {
        return "users";
    }
    if (normalizedAction === "approval_rejected" || normalizedEntity === "approval") {
        return "approvals";
    }
    if (["product_created", "product_updated"].includes(normalizedAction)) {
        return "catalog";
    }
    if (normalizedAction === "supplier_payment_recorded") {
        return "suppliers";
    }
    return "other";
};
exports.getActivityLogs = async (req, res) => {
    try {
        const { branchId, userId, action, entityType, entityId, category } = req.query;
        const where = {};
        if (action)
            where.action = action;
        if (entityType)
            where.entityType = entityType;
        if (userId)
            where.userId = userId;
        if (entityId)
            where.entityId = entityId;
        if (["super_admin", "admin"].includes(req.user.role)) {
            if (branchId)
                where.branchId = branchId;
        }
        else if (req.user.branch) {
            where.branchId = req.user.branch;
        }
        const logs = await prisma.activityLog.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
                branch: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            take: 1000,
        });
        const normalizedCategory = category ? category.toString().trim().toLowerCase() : "";
        const filteredLogs = normalizedCategory
            ? logs.filter((log) => classifyActivityCategory(log.action, log.entityType) === normalizedCategory)
            : logs;
        res.json(filteredLogs.slice(0, 300).map((log) => ({
            _id: log.id,
            id: log.id,
            user: log.user
                ? {
                    _id: log.user.id,
                    id: log.user.id,
                    name: log.user.name,
                    email: log.user.email,
                    role: fromDbUserRole(log.user.role),
                }
                : null,
            action: log.action,
            category: classifyActivityCategory(log.action, log.entityType),
            entityType: log.entityType || "",
            entityId: log.entityId || null,
            branch: log.branch
                ? {
                    _id: log.branch.id,
                    id: log.branch.id,
                    name: log.branch.name,
                }
                : null,
            message: log.message || "",
            meta: log.meta || {},
            createdAt: log.createdAt,
            updatedAt: log.updatedAt,
        })));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
