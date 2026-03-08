"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, fromDbUserRole } = require("../utils/prismaLegacy");
exports.getActivityLogs = async (req, res) => {
    try {
        const { branchId, userId, action, entityType, entityId } = req.query;
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
            take: 300,
        });
        res.json(logs.map((log) => ({
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
