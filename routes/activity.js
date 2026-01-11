const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const ActivityController = require("../controllers/activityController");

router.get(
  "/",
  protect,
  requireRole(["super_admin", "admin", "branch_manager", "inventory_manager"]),
  ActivityController.getActivityLogs
);

module.exports = router;
