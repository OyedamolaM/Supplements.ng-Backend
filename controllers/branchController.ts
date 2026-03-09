const {
  prisma,
  newId,
  fromDbUserRole,
  toDbUserRole,
  toLegacyBranch,
  toLegacyProduct,
  toLegacyOrder,
} = require("../utils/prismaLegacy");

const STAFF_ROLES = [
  "super_admin",
  "admin",
  "branch_manager",
  "accountant",
  "inventory_manager",
  "cashier",
  "staff",
];

const toLegacyInventory = (item) => ({
  _id: item.id,
  id: item.id,
  branch: item.branchId,
  product: item.product ? toLegacyProduct(item.product) : item.productId,
  quantity: item.quantity,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

exports.listBranches = async (req, res) => {
  try {
    const isAdmin = req.user.role === "super_admin" || req.user.role === "admin";
    const isStaffRestricted = STAFF_ROLES.includes(req.user.role) && !isAdmin;
    const where = isStaffRestricted
      ? req.user.branch
        ? { id: req.user.branch }
        : { id: "__none__" }
      : {};
    let branches = await prisma.branch.findMany({
      where,
      orderBy: { name: "asc" },
    });

    if (
      branches.length === 0 &&
      (req.user.role === "super_admin" || req.user.role === "admin")
    ) {
      const onlineBranch = await prisma.branch.create({
        data: {
          id: newId(),
          name: "Online",
          address: "Online Store",
          phone: "N/A",
          region: "",
          isOnline: true,
        },
      });
      branches = [onlineBranch];
    }

    res.json(branches.map((branch) => toLegacyBranch(branch)));
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
    const branch = await prisma.branch.create({
      data: {
        id: newId(),
        name,
        address,
        phone,
        region: region || "",
        isOnline: Boolean(isOnline),
      },
    });
    res.status(201).json(toLegacyBranch(branch));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranch = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
    });
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    res.json(toLegacyBranch(branch));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const updateData = { ...req.body };
    if (updateData.isOnline !== undefined) {
      updateData.isOnline = Boolean(updateData.isOnline);
    }
    const branch = await prisma.branch.update({
      where: { id: req.params.id },
      data: updateData,
    });
    if (!branch) return res.status(404).json({ message: "Branch not found" });
    res.json(toLegacyBranch(branch));
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Branch not found" });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    await prisma.branch.delete({ where: { id: req.params.id } });
    res.json({ message: "Branch removed" });
  } catch (error) {
    if (error.code === "P2003") {
      return res.status(400).json({ message: "Branch cannot be removed due to related records" });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchStaff = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const staff = await prisma.user.findMany({
      where: {
        role: { in: STAFF_ROLES.map(toDbUserRole) },
        branchId: req.params.id,
      },
      include: {
        branch: true,
      },
    });
    res.json(staff.map((user) => ({
      ...user,
      _id: user.id,
      role: fromDbUserRole(user.role),
      branch: user.branch ? toLegacyBranch(user.branch) : null,
      isAdmin: ["admin", "super_admin"].includes(fromDbUserRole(user.role)),
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchCustomers = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const orders = await prisma.order.findMany({
      where: { branchId: req.params.id },
      select: { userId: true },
    });
    const customerIds = [...new Set(orders.map((o) => o.userId).filter(Boolean))];
    const customers = await prisma.user.findMany({
      where: { id: { in: customerIds } },
      include: { branch: true },
    });
    res.json(
      customers.map((user) => ({
        ...user,
        _id: user.id,
        role: fromDbUserRole(user.role),
        branch: user.branch ? toLegacyBranch(user.branch) : null,
        isAdmin: ["admin", "super_admin"].includes(fromDbUserRole(user.role)),
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchOrders = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const orders = await prisma.order.findMany({
      where: { branchId: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders.map((order) => toLegacyOrder(order)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getBranchInventory = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
      return res.status(403).json({ message: "Access denied" });
    }
    const inventory = await prisma.branchInventory.findMany({
      where: { branchId: req.params.id },
      include: {
        product: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(inventory.map((item) => toLegacyInventory(item)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateBranchInventory = async (req, res) => {
  try {
    if (req.user.role === "branch_manager" && req.user.branch !== req.params.id) {
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
      const currentInventory = await prisma.branchInventory.findMany({
        where: { branchId: req.params.id },
        select: { productId: true, quantity: true },
      });
      const currentMap = new Map(
        currentInventory.map((item) => [item.productId, item.quantity])
      );
      const requiresApproval = items.some((item) => {
        const currentQty = Number(currentMap.get(item.productId) || 0);
        const nextQty = Number(item.quantity) || 0;
        return Math.abs(nextQty - currentQty) >= threshold;
      });

      if (requiresApproval) {
        const approval = await prisma.approvalRequest.create({
          data: {
            id: newId(),
            type: "INVENTORY_ADJUSTMENT",
            branchId: req.params.id,
            requestedById: req.user.id,
            reason,
            payload: { items },
          },
        });
        return res.status(202).json({
          message: "Approval required for large inventory adjustment",
          approvalId: approval.id,
        });
      }
    }

    const results = [];
    for (const item of items) {
      const current = await prisma.branchInventory.findUnique({
        where: {
          branchId_productId: {
            branchId: req.params.id,
            productId: item.productId,
          },
        },
      });
      const currentQty = current?.quantity || 0;
      const nextQty = Number(item.quantity) || 0;
      const diff = nextQty - currentQty;

      const updated = await prisma.branchInventory.upsert({
        where: {
          branchId_productId: {
            branchId: req.params.id,
            productId: item.productId,
          },
        },
        create: {
          id: newId(),
          branchId: req.params.id,
          productId: item.productId,
          quantity: nextQty,
        },
        update: {
          quantity: nextQty,
        },
        include: {
          product: true,
        },
      });
      results.push(updated);

      if (diff !== 0) {
        await prisma.inventoryMovement.create({
          data: {
            id: newId(),
            branchId: req.params.id,
            productId: item.productId,
            type: "ADJUSTMENT",
            quantityChange: diff,
            reason,
            referenceType: "manual_adjustment",
            referenceId: null,
            createdById: req.user.id,
          },
        });
      }
    }

    res.json(results.map((item) => toLegacyInventory(item)));

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "inventory_adjusted",
          entityType: "branch_inventory",
          branchId: req.params.id,
          message: "Adjusted branch inventory",
          meta: { items: items.length, reason },
        },
      })
      .catch(() => null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
