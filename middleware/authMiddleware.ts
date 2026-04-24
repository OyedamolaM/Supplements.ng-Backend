const jwt = require("jsonwebtoken");
const { prisma, fromDbUserRole } = require("../utils/prismaLegacy");
const {
  isUserDeactivated,
  buildAccountDeactivationResponse,
} = require("../services/accountLifecycleService");

exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        deactivatedAt: true,
        accountDeletionScheduledFor: true,
        accountPurgedAt: true,
      },
    });
    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }
    if (isUserDeactivated(user)) {
      return res.status(403).json(buildAccountDeactivationResponse(user));
    }

    const role = fromDbUserRole(user.role);
    req.user = {
      id: user.id,
      _id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      role,
      branch: user.branchId || null,
      isAdmin: role === "admin" || role === "super_admin",
    };
    next();

  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

exports.adminOnly = (req, res, next) => {
  if (req.user && ["super_admin", "admin"].includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({ message: "Admin access only" });
};

exports.requireRole = (roles = []) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({ message: "Access denied" });
};
