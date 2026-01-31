const ActivityLog = require("../models/ActivityLog");

exports.getActivityLogs = async (req, res) => {
  try {
    const { branchId, userId, action, entityType, entityId } = req.query;
    const filter: Record<string, any> = {};

    if (action) filter.action = action;
    if (entityType) filter.entityType = entityType;
    if (userId) filter.user = userId;
    if (entityId) filter.entityId = entityId;

    if (["super_admin", "admin"].includes(req.user.role)) {
      if (branchId) filter.branch = branchId;
    } else if (req.user.branch) {
      filter.branch = req.user.branch;
    }

    const logs = await ActivityLog.find(filter)
      .populate("user", "name email role")
      .populate("branch", "name")
      .sort({ createdAt: -1 })
      .limit(300);

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export {};
