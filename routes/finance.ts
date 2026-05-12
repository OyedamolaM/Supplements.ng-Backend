const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const FinanceController = require("../controllers/financeController");

const financeRoles = ["super_admin", "admin", "accountant", "branch_manager"];

router.get("/summary", protect, requireRole(financeRoles), FinanceController.getFinanceSummary);
router.get("/expenses", protect, requireRole(financeRoles), FinanceController.listExpenses);
router.post("/expenses", protect, requireRole(financeRoles), FinanceController.createExpense);
router.patch("/expenses/:id/void", protect, requireRole(financeRoles), FinanceController.voidExpense);

module.exports = router;

export {};
