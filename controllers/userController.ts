const User = require("../models/User");
const Order = require("../models/Order");
const Branch = require("../models/Branch");
const bcrypt = require("bcryptjs");
const ActivityLog = require("../models/ActivityLog");

const toTitleCase = (value = "") =>
  value
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

const BRANCH_MANAGER_CREATABLE_ROLES = [
  "cashier",
  "inventory_manager",
];

const isStaffRole = (role) => STAFF_ROLES.includes(role);

const canAssignRole = (requesterRole, targetRole) => {
  if (requesterRole === "super_admin") return true;
  if (requesterRole === "admin") {
    return targetRole !== "super_admin" && targetRole !== "admin";
  }
  if (requesterRole === "branch_manager") {
    return BRANCH_MANAGER_CREATABLE_ROLES.includes(targetRole);
  }
  return targetRole === "customer";
};

// =================== LOGGED-IN USER ===================

// Get logged-in user profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password")
      .populate("branch", "name address phone region isOnline");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update logged-in user profile
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, email, password, phone } = req.body;

    if (name) user.name = toTitleCase(name);
    if (email) user.email = email;
    if (phone) user.phone = phone;

    // If password is being changed, let pre-save hook hash it
    if (password) user.password = password;

    await user.save();

    ActivityLog.create({
      user: req.user.id,
      action: user.role === "customer" ? "customer_updated" : "staff_updated",
      entityType: "user",
      entityId: user._id,
      branch: user.branch || null,
      message: "Updated user profile"
    }).catch(() => null);

    res.json({
      message: "Profile updated",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// =================== SHIPPING ADDRESS ===================

// Add new shipping address
exports.addShippingAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const nextAddress = {
      fullName: req.body?.fullName || "",
      addressLine1: req.body?.addressLine1 || "",
      addressLine2: req.body?.addressLine2 || "",
      city: req.body?.city || "",
      state: req.body?.state || "",
      country: req.body?.country || "",
      postalCode: req.body?.postalCode || "",
      phone: req.body?.phone || ""
    };

    const saveAsNew = Boolean(req.body?.saveAsNew);
    const makeDefault = Boolean(req.body?.makeDefault);

    if (saveAsNew) {
      if (makeDefault) {
        user.shippingAddresses.unshift(nextAddress);
      } else {
        user.shippingAddresses.push(nextAddress);
      }
    } else if (user.shippingAddresses.length > 0) {
      user.shippingAddresses[0] = {
        ...user.shippingAddresses[0].toObject(),
        ...nextAddress
      };
    } else {
      user.shippingAddresses.push(nextAddress);
    }

    await user.save();
    res.json(user.shippingAddresses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Remove a shipping address
exports.removeShippingAddress = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.shippingAddresses = user.shippingAddresses.filter(
      addr => addr._id.toString() !== req.params.id
    );

    await user.save();
    res.json(user.shippingAddresses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// =================== ADMIN CONTROLLERS ===================

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const requesterRole = req.user?.role;
    const { type } = req.query;

    let filter = {};

    if (type === "customers") {
      if (requesterRole && isStaffRole(requesterRole) && !["super_admin", "admin"].includes(requesterRole)) {
        const branchIds = [];
        if (req.user?.branch) branchIds.push(req.user.branch);
        const onlineBranch = await Branch.findOne({ isOnline: true }).select("_id");
        if (onlineBranch?._id) branchIds.push(onlineBranch._id);

        const orders = branchIds.length
          ? await Order.find({ branch: { $in: branchIds } }).select("user")
          : [];
        const customerIds = [
          ...new Set(
            orders.map((order) => order.user?.toString()).filter(Boolean)
          ),
        ];

        const orFilters = [];
        if (customerIds.length) {
          orFilters.push({ _id: { $in: customerIds } });
        }
        if (req.user?.branch) {
          orFilters.push({ branch: req.user.branch });
        }

        if (orFilters.length === 0) {
          return res.json([]);
        }

        filter = { role: "customer", $or: orFilters };
      } else {
        filter = { role: "customer" };
      }
    } else if (type === "staff") {
      if (requesterRole === "branch_manager") {
        filter = {
          role: { $in: STAFF_ROLES.filter((role) => role !== "super_admin") },
          branch: req.user.branch || null,
        };
      } else if (requesterRole === "admin" || requesterRole === "super_admin") {
        filter = { role: { $in: STAFF_ROLES } };
      } else {
        filter = { role: "customer" };
      }
    } else if (requesterRole === "super_admin" || requesterRole === "admin") {
      filter = {};
    } else {
      filter = { role: "customer" };
    }

    const users = await User.find(filter).select("-password").populate("branch", "name");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create a new user (Admin only)
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, branchId, region } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ message: "Please provide all fields" });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "User already exists" });

    const targetRole = role || "customer";
    const requesterRole = req.user?.role || "customer";

    if (!canAssignRole(requesterRole, targetRole)) {
      return res.status(403).json({ message: "Not allowed to assign this role" });
    }

    const isAdmin = requesterRole === "super_admin" || requesterRole === "admin";
    let assignedBranch = null;

    if (targetRole === "customer") {
      if (!isAdmin && req.user.branch) {
        assignedBranch = req.user.branch;
      } else if (isAdmin && branchId) {
        assignedBranch = branchId;
      }
    } else if (requesterRole === "branch_manager") {
      assignedBranch = req.user.branch || null;
    } else {
      assignedBranch = branchId || null;
    }

    if (targetRole !== "customer" && !assignedBranch) {
      return res.status(400).json({ message: "Branch is required for staff roles" });
    }

    if (targetRole === "branch_manager" && !assignedBranch) {
      return res.status(400).json({ message: "Branch is required for branch managers" });
    }

    // DO NOT hash password manually. The model handles it.
    const newUser = await User.create({
      name: toTitleCase(name),
      email,
      phone,
      password,
      role: targetRole,
      branch: assignedBranch,
      region: region || "",
    });

    ActivityLog.create({
      user: req.user.id,
      action: targetRole === "customer" ? "customer_created" : "staff_created",
      entityType: "user",
      entityId: newUser._id,
      branch: newUser.branch || null,
      message: "Created user"
    }).catch(() => null);

    res.json({
      message: "User created successfully",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        branch: newUser.branch,
        region: newUser.region,
        isAdmin: newUser.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update user (Admin)
exports.updateUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, branchId, region } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const requesterRole = req.user?.role || "customer";

    if (user.role === "customer" && !["super_admin", "admin", "branch_manager"].includes(requesterRole)) {
      return res.status(403).json({ message: "Not allowed to edit customer details" });
    }

    if (requesterRole === "branch_manager" && user.branch?.toString() !== req.user.branch?.toString()) {
      return res.status(403).json({ message: "Not allowed to edit outside branch" });
    }

    if (name) user.name = toTitleCase(name);
    if (email) user.email = email;
    if (phone) user.phone = phone;

    if (role && role !== user.role) {
      if (!canAssignRole(requesterRole, role)) {
        return res.status(403).json({ message: "Not allowed to update this role" });
      }
      user.role = role;
    }

    if (branchId !== undefined) {
      if (requesterRole === "branch_manager") {
        user.branch = req.user.branch || null;
      } else {
        user.branch = branchId || null;
      }
    }

    if (region !== undefined) {
      user.region = region || "";
    }

    if (user.role === "branch_manager" && !user.branch) {
      return res.status(400).json({ message: "Branch is required for branch managers" });
    }

    if (user.role !== "customer" && !user.branch) {
      return res.status(400).json({ message: "Branch is required for staff roles" });
    }

    // If password is being updated, set raw password. Model will hash it.
    if (password) user.password = password;

    await user.save();

    res.json({
      message: "User updated successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        branch: user.branch,
        region: user.region,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete User (Admin)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const requesterRole = req.user?.role || "customer";
    if (requesterRole !== "super_admin" && isStaffRole(user.role)) {
      if (requesterRole === "admin" && user.role === "admin") {
        return res.status(403).json({ message: "Not allowed to delete admin" });
      }
      if (requesterRole !== "admin") {
        return res.status(403).json({ message: "Not allowed to delete staff" });
      }
    }

    if (requesterRole === "branch_manager" && user.branch !== req.user.branch) {
      return res.status(403).json({ message: "Not allowed to delete outside branch" });
    }

    await User.deleteOne({ _id: user._id });

    res.json({ message: "User removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export {};
