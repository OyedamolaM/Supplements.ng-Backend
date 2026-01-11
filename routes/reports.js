const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const ReportsController = require("../controllers/reportsController");

const reportRoles = ["super_admin", "admin", "accountant", "branch_manager"];

router.get("/daily-sales", protect, requireRole(reportRoles), ReportsController.dailySales);
router.get("/sales-summary", protect, requireRole(reportRoles), ReportsController.salesSummary);
router.get("/tax-summary", protect, requireRole(reportRoles), ReportsController.taxSummary);
router.get("/inventory-valuation", protect, requireRole(reportRoles), ReportsController.inventoryValuation);
router.get("/inventory-movement", protect, requireRole(reportRoles), ReportsController.inventoryMovement);
router.get("/supplier-balances", protect, requireRole(reportRoles), ReportsController.supplierBalances);
router.get("/returns", protect, requireRole(reportRoles), ReportsController.returnsReport);

module.exports = router;
