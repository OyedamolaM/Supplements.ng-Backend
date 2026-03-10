const { prisma, fromDbUserRole, toDbUserRole } = require("../utils/prismaLegacy");

const ADMIN_ROLES = ["super_admin", "admin"];
const BRANCH_MANAGER_VISIBLE_ROLES = [
  "branch_manager",
  "accountant",
  "inventory_manager",
  "cashier",
  "staff",
];
const ACCOUNTANT_ALLOWED_CATEGORIES = ["orders", "inventory", "approvals", "suppliers"];

const classifyActivityCategory = (action = "", entityType = "") => {
  const normalizedAction = action.toString().trim().toLowerCase();
  const normalizedEntity = entityType.toString().trim().toLowerCase();

  if (normalizedAction === "login") return "login";

  if (
    [
      "sale_created",
      "customer_order_created",
      "order_status_update",
      "order_claimed",
      "refund_requested",
      "refund_approved",
      "order_returned",
    ].includes(normalizedAction) ||
    normalizedEntity === "order"
  ) {
    return "orders";
  }

  if (
    [
      "inventory_adjusted",
      "inventory_adjustment_approved",
      "supplier_invoice_created",
    ].includes(normalizedAction)
  ) {
    return "inventory";
  }

  if (
    [
      "customer_created",
      "customer_updated",
      "customer_deleted",
      "staff_created",
      "staff_updated",
      "staff_deleted",
    ].includes(normalizedAction) ||
    normalizedEntity === "user"
  ) {
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

const applyRoleScopeToActivityQuery = (req, where) => {
  if (ADMIN_ROLES.includes(req.user.role)) {
    return;
  }

  if (!req.user.branch) {
    where.branchId = "__none__";
    return;
  }

  where.branchId = req.user.branch;

  if (req.user.role === "branch_manager") {
    const existingUserScope = where.user?.is || {};
    where.user = {
      is: {
        ...existingUserScope,
        branchId: req.user.branch,
        role: {
          in: BRANCH_MANAGER_VISIBLE_ROLES.map(toDbUserRole),
        },
      },
    };
  }
};

const isCategoryAllowedForRole = (role, category) => {
  if (!category) return true;
  if (ADMIN_ROLES.includes(role)) return true;
  if (role === "branch_manager") return true;
  if (role === "accountant") {
    return ACCOUNTANT_ALLOWED_CATEGORIES.includes(category);
  }
  return false;
};

const filterLogsForRole = (logs, role) => {
  if (ADMIN_ROLES.includes(role) || role === "branch_manager") {
    return logs;
  }

  if (role === "accountant") {
    return logs.filter((log) =>
      ACCOUNTANT_ALLOWED_CATEGORIES.includes(
        classifyActivityCategory(log.action, log.entityType)
      )
    );
  }

  return [];
};

exports.getActivityLogs = async (req, res) => {
  try {
    const { branchId, userId, action, entityType, entityId, category } = req.query;
    const where: Record<string, any> = {};
    const normalizedCategory = category ? category.toString().trim().toLowerCase() : "";

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;
    if (entityId) where.entityId = entityId;

    if (!isCategoryAllowedForRole(req.user.role, normalizedCategory)) {
      return res.status(403).json({ message: "Access denied for this activity category" });
    }

    if (ADMIN_ROLES.includes(req.user.role)) {
      if (branchId) where.branchId = branchId;
    } else if (req.user.branch) {
      where.branchId = req.user.branch;
    }

    applyRoleScopeToActivityQuery(req, where);

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

    const scopedLogs = filterLogsForRole(logs, req.user.role);
    const filteredLogs = normalizedCategory
      ? scopedLogs.filter(
          (log) => classifyActivityCategory(log.action, log.entityType) === normalizedCategory
        )
      : scopedLogs;

    res.json(
      filteredLogs.slice(0, 300).map((log) => ({
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
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
