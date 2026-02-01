const jwt = require("jsonwebtoken");
const User = require("../models/User");
exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ message: "Not authorized. No token provided." });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }
    req.user = user;
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
