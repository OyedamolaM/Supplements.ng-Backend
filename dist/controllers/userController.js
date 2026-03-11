"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = require("bcryptjs");
const { prisma, newId, toDbUserRole, fromDbUserRole, toLegacyUser, } = require("../utils/prismaLegacy");
const toTitleCase = (value = "") => value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
const STAFF_ROLES = [
    "super_admin",
    "admin",
    "branch_manager",
    "accountant",
    "inventory_manager",
    "cashier",
    "staff",
];
const BRANCH_MANAGER_CREATABLE_ROLES = ["cashier", "inventory_manager"];
const IMMUTABLE_SUPER_ADMIN_MESSAGE = "Super admin is fixed and cannot be reassigned, edited, or removed";
const ADMIN_ROLES = ["super_admin", "admin"];
const isStaffRole = (role) => STAFF_ROLES.includes(role);
const canAssignRole = (requesterRole, targetRole) => {
    if (targetRole === "super_admin")
        return false;
    if (requesterRole === "super_admin")
        return true;
    if (requesterRole === "admin") {
        return targetRole !== "admin";
    }
    if (requesterRole === "branch_manager") {
        return BRANCH_MANAGER_CREATABLE_ROLES.includes(targetRole);
    }
    return targetRole === "customer";
};
const fetchShippingAddresses = async (userId) => {
    const addresses = await prisma.shippingAddress.findMany({
        where: { userId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return addresses.map((address) => ({
        _id: address.id,
        id: address.id,
        fullName: address.fullName,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 || "",
        city: address.city,
        state: address.state,
        country: address.country,
        postalCode: address.postalCode,
        phone: address.phone,
    }));
};
const normalizeAddress = (payload = {}) => ({
    fullName: payload.fullName || "",
    addressLine1: payload.addressLine1 || "",
    addressLine2: payload.addressLine2 || "",
    city: payload.city || "",
    state: payload.state || "",
    country: payload.country || "",
    postalCode: payload.postalCode || "",
    phone: payload.phone || "",
});
const relabelUser = (user) => {
    const role = fromDbUserRole(user.role);
    return {
        _id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        role,
        branch: user.branchId || null,
        region: user.region || "",
        isAdmin: role === "admin" || role === "super_admin",
    };
};
// =================== LOGGED IN USER ===================
exports.getProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                branch: true,
                shippingAddresses: {
                    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                },
            },
        });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        res.json(toLegacyUser(user));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.updateProfile = async (req, res) => {
    try {
        const existing = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, role: true, branchId: true },
        });
        if (!existing)
            return res.status(404).json({ message: "User not found" });
        const { name, email, password, phone } = req.body;
        const updateData = {};
        if (name)
            updateData.name = toTitleCase(name);
        if (email)
            updateData.email = email.toString().trim().toLowerCase();
        if (phone)
            updateData.phone = phone.toString().trim();
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }
        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                branchId: true,
                region: true,
            },
        });
        const role = fromDbUserRole(user.role);
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: req.user.id,
                action: role === "customer" ? "customer_updated" : "staff_updated",
                entityType: "user",
                entityId: user.id,
                branchId: user.branchId || null,
                message: "Updated user profile",
            },
        })
            .catch(() => null);
        res.json({
            message: "Profile updated",
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role,
                isAdmin: role === "admin" || role === "super_admin",
            },
        });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// =================== SHIPPING ADDRESS ===================
exports.addShippingAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const nextAddress = normalizeAddress(req.body || {});
        const saveAsNew = Boolean(req.body?.saveAsNew);
        const makeDefault = Boolean(req.body?.makeDefault);
        const addresses = await prisma.shippingAddress.findMany({
            where: { userId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        if (saveAsNew) {
            if (makeDefault) {
                await prisma.$transaction([
                    prisma.shippingAddress.updateMany({
                        where: { userId },
                        data: { sortOrder: { increment: 1 } },
                    }),
                    prisma.shippingAddress.create({
                        data: {
                            id: newId(),
                            userId,
                            ...nextAddress,
                            sortOrder: 0,
                        },
                    }),
                ]);
            }
            else {
                await prisma.shippingAddress.create({
                    data: {
                        id: newId(),
                        userId,
                        ...nextAddress,
                        sortOrder: addresses.length,
                    },
                });
            }
        }
        else if (addresses.length > 0) {
            await prisma.shippingAddress.update({
                where: { id: addresses[0].id },
                data: nextAddress,
            });
        }
        else {
            await prisma.shippingAddress.create({
                data: {
                    id: newId(),
                    userId,
                    ...nextAddress,
                    sortOrder: 0,
                },
            });
        }
        const response = await fetchShippingAddresses(userId);
        res.json(response);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.removeShippingAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const address = await prisma.shippingAddress.findFirst({
            where: { id: req.params.id, userId },
            select: { id: true },
        });
        if (!address)
            return res.status(404).json({ message: "Address not found" });
        await prisma.shippingAddress.delete({
            where: { id: address.id },
        });
        const addresses = await prisma.shippingAddress.findMany({
            where: { userId },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true },
        });
        await Promise.all(addresses.map((item, index) => prisma.shippingAddress.update({
            where: { id: item.id },
            data: { sortOrder: index },
        })));
        res.json(await fetchShippingAddresses(userId));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// =================== ADMIN CONTROLLERS ===================
exports.getAllUsers = async (req, res) => {
    try {
        const requesterRole = req.user?.role;
        const type = req.query.type?.toString();
        const requestedBranchId = req.query.branchId?.toString().trim() || "";
        let where = {};
        if (type === "customers") {
            if (requesterRole &&
                isStaffRole(requesterRole) &&
                !["super_admin", "admin"].includes(requesterRole)) {
                const branchIds = [];
                if (req.user?.branch)
                    branchIds.push(req.user.branch);
                const onlineBranch = await prisma.branch.findFirst({
                    where: { isOnline: true },
                    select: { id: true },
                });
                if (onlineBranch?.id)
                    branchIds.push(onlineBranch.id);
                const orders = branchIds.length
                    ? await prisma.order.findMany({
                        where: { branchId: { in: branchIds } },
                        select: { userId: true },
                    })
                    : [];
                const customerIds = [...new Set(orders.map((order) => order.userId).filter(Boolean))];
                const orFilters = [];
                if (customerIds.length) {
                    orFilters.push({ id: { in: customerIds } });
                }
                if (req.user?.branch) {
                    orFilters.push({ branchId: req.user.branch });
                }
                if (orFilters.length === 0) {
                    return res.json([]);
                }
                where = {
                    role: toDbUserRole("customer"),
                    OR: orFilters,
                };
            }
            else if (requestedBranchId) {
                const branchOrders = await prisma.order.findMany({
                    where: { branchId: requestedBranchId },
                    select: { userId: true },
                });
                const customerIds = [
                    ...new Set(branchOrders.map((order) => order.userId).filter(Boolean)),
                ];
                where = {
                    role: toDbUserRole("customer"),
                    OR: [{ branchId: requestedBranchId }, { id: { in: customerIds.length ? customerIds : ["__none__"] } }],
                };
            }
            else {
                where = { role: toDbUserRole("customer") };
            }
        }
        else if (type === "staff") {
            if (requesterRole === "branch_manager") {
                where = {
                    role: {
                        in: STAFF_ROLES.filter((role) => role !== "super_admin").map(toDbUserRole),
                    },
                    branchId: req.user.branch || null,
                };
            }
            else if (requesterRole === "admin" || requesterRole === "super_admin") {
                where = {
                    role: { in: STAFF_ROLES.map(toDbUserRole) },
                    ...(requestedBranchId ? { branchId: requestedBranchId } : {}),
                };
            }
            else {
                where = { role: toDbUserRole("customer") };
            }
        }
        else if (requesterRole === "super_admin" || requesterRole === "admin") {
            where = requestedBranchId ? { branchId: requestedBranchId } : {};
        }
        else {
            where = { role: toDbUserRole("customer") };
        }
        const users = await prisma.user.findMany({
            where,
            include: {
                branch: {
                    select: { id: true, name: true, address: true, phone: true, region: true, isOnline: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(users.map((user) => toLegacyUser(user)));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.createUser = async (req, res) => {
    try {
        const { name, email, password, role, phone, branchId, region } = req.body;
        if (!name || !email || !password || !phone) {
            return res.status(400).json({ message: "Please provide all fields" });
        }
        const normalizedEmail = email.toString().trim().toLowerCase();
        const exists = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true },
        });
        if (exists)
            return res.status(400).json({ message: "User already exists" });
        const targetRole = (role || "customer").toString().trim().toLowerCase();
        const requesterRole = req.user?.role || "customer";
        if (!canAssignRole(requesterRole, targetRole)) {
            return res.status(403).json({ message: "Not allowed to assign this role" });
        }
        const isAdmin = requesterRole === "super_admin" || requesterRole === "admin";
        let assignedBranch = null;
        if (targetRole === "customer") {
            if (!isAdmin && req.user.branch) {
                assignedBranch = req.user.branch;
            }
            else if (isAdmin && branchId) {
                assignedBranch = branchId;
            }
        }
        else if (requesterRole === "branch_manager") {
            assignedBranch = req.user.branch || null;
        }
        else {
            assignedBranch = branchId || null;
        }
        if (targetRole !== "customer" && !assignedBranch) {
            return res.status(400).json({ message: "Branch is required for staff roles" });
        }
        if (targetRole === "branch_manager" && !assignedBranch) {
            return res.status(400).json({ message: "Branch is required for branch managers" });
        }
        const newUser = await prisma.user.create({
            data: {
                id: newId(),
                name: toTitleCase(name),
                email: normalizedEmail,
                phone: phone.toString().trim(),
                password: await bcrypt.hash(password, 10),
                role: toDbUserRole(targetRole),
                branchId: assignedBranch,
                region: region || "",
            },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                branchId: true,
                region: true,
            },
        });
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: req.user.id,
                action: targetRole === "customer" ? "customer_created" : "staff_created",
                entityType: "user",
                entityId: newUser.id,
                branchId: newUser.branchId || null,
                message: "Created user",
            },
        })
            .catch(() => null);
        res.json({
            message: "User created successfully",
            user: relabelUser(newUser),
        });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.updateUser = async (req, res) => {
    try {
        const { name, email, password, role, phone, branchId, region } = req.body;
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                role: true,
                branchId: true,
            },
        });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const requesterRole = req.user?.role || "customer";
        const currentRole = fromDbUserRole(user.role);
        if (currentRole === "super_admin") {
            return res.status(403).json({ message: IMMUTABLE_SUPER_ADMIN_MESSAGE });
        }
        if (currentRole === "customer" &&
            !["super_admin", "admin", "branch_manager"].includes(requesterRole)) {
            return res.status(403).json({ message: "Not allowed to edit customer details" });
        }
        if (requesterRole === "branch_manager" &&
            (user.branchId || null) !== (req.user.branch || null)) {
            return res.status(403).json({ message: "Not allowed to edit outside branch" });
        }
        const updateData = {};
        if (name)
            updateData.name = toTitleCase(name);
        if (email)
            updateData.email = email.toString().trim().toLowerCase();
        if (phone)
            updateData.phone = phone.toString().trim();
        let nextRole = currentRole;
        if (role && role !== currentRole) {
            const normalizedRole = role.toString().trim().toLowerCase();
            if (!canAssignRole(requesterRole, normalizedRole)) {
                return res.status(403).json({ message: "Not allowed to update this role" });
            }
            nextRole = normalizedRole;
            updateData.role = toDbUserRole(normalizedRole);
        }
        if (branchId !== undefined) {
            if (requesterRole === "branch_manager") {
                updateData.branchId = req.user.branch || null;
            }
            else {
                updateData.branchId = branchId || null;
            }
        }
        if (region !== undefined) {
            updateData.region = region || "";
        }
        const effectiveBranchId = updateData.branchId !== undefined ? updateData.branchId : user.branchId;
        if (nextRole === "branch_manager" && !effectiveBranchId) {
            return res.status(400).json({ message: "Branch is required for branch managers" });
        }
        if (nextRole !== "customer" && !effectiveBranchId) {
            return res.status(400).json({ message: "Branch is required for staff roles" });
        }
        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }
        const updated = await prisma.user.update({
            where: { id: req.params.id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                branchId: true,
                region: true,
            },
        });
        res.json({
            message: "User updated successfully",
            user: relabelUser(updated),
        });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.deleteUser = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                role: true,
                branchId: true,
            },
        });
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const requesterRole = req.user?.role || "customer";
        const userRole = fromDbUserRole(user.role);
        const canDeleteCustomer = requesterRole === "super_admin";
        if (userRole === "super_admin") {
            return res.status(403).json({ message: IMMUTABLE_SUPER_ADMIN_MESSAGE });
        }
        if (requesterRole !== "super_admin" && isStaffRole(userRole)) {
            if (requesterRole === "admin" && userRole === "admin") {
                return res.status(403).json({ message: "Not allowed to delete admin" });
            }
            if (requesterRole !== "admin") {
                return res.status(403).json({ message: "Not allowed to delete staff" });
            }
        }
        if (requesterRole === "branch_manager" &&
            (user.branchId || null) !== (req.user.branch || null)) {
            return res.status(403).json({ message: "Not allowed to delete outside branch" });
        }
        const [orderCount, approvalRequestCount] = await prisma.$transaction([
            prisma.order.count({
                where: { userId: user.id },
            }),
            prisma.approvalRequest.count({
                where: { requestedById: user.id },
            }),
        ]);
        if (userRole === "customer") {
            if (!canDeleteCustomer) {
                return res.status(403).json({
                    message: "Only the highest admin can delete customers",
                });
            }
            if (orderCount > 0) {
                return res.status(400).json({
                    message: "Customer cannot be deleted because they have order history",
                });
            }
            if (approvalRequestCount > 0) {
                return res.status(400).json({
                    message: "Customer cannot be deleted because they are linked to approval history",
                });
            }
            await prisma.$transaction([
                prisma.shippingAddress.deleteMany({
                    where: { userId: user.id },
                }),
                prisma.userWishlistItem.deleteMany({
                    where: { userId: user.id },
                }),
                prisma.userCartItem.deleteMany({
                    where: { userId: user.id },
                }),
                prisma.activityLog.deleteMany({
                    where: { userId: user.id },
                }),
                prisma.user.delete({
                    where: { id: user.id },
                }),
            ]);
            prisma.activityLog
                .create({
                data: {
                    id: newId(),
                    userId: req.user.id,
                    action: "customer_deleted",
                    entityType: "user",
                    entityId: user.id,
                    branchId: user.branchId || req.user.branch || null,
                    message: "Deleted customer",
                },
            })
                .catch(() => null);
            return res.json({ message: "User removed" });
        }
        if (orderCount > 0) {
            return res.status(400).json({
                message: "User cannot be deleted because they are linked to order records",
            });
        }
        if (approvalRequestCount > 0) {
            return res.status(400).json({
                message: "User cannot be deleted because they are linked to approval records",
            });
        }
        await prisma.activityLog.deleteMany({
            where: { userId: user.id },
        });
        await prisma.user.delete({
            where: { id: user.id },
        });
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: req.user.id,
                action: "staff_deleted",
                entityType: "user",
                entityId: user.id,
                branchId: user.branchId || req.user.branch || null,
                message: "Deleted staff user",
            },
        })
            .catch(() => null);
        res.json({ message: "User removed" });
    }
    catch (error) {
        if (error.code === "P2003") {
            return res.status(400).json({
                message: "User cannot be removed because related records exist",
            });
        }
        res.status(500).json({ message: error.message });
    }
};
