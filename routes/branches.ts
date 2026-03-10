const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const BranchController = require("../controllers/branchController");

const adminRoles = ["super_admin", "admin"];
const staffRoles = [
  "super_admin",
  "admin",
  "branch_manager",
  "accountant",
  "inventory_manager",
  "cashier",
  "staff",
];

router.get("/", protect, requireRole(staffRoles), BranchController.listBranches);
router.post("/", protect, requireRole(adminRoles), BranchController.createBranch);
router.get("/:id/summary", protect, requireRole(staffRoles), BranchController.getBranchSummary);
router.get("/:id", protect, requireRole(staffRoles), BranchController.getBranch);
router.put("/:id", protect, requireRole(["super_admin", "admin", "branch_manager"]), BranchController.updateBranch);
router.delete("/:id", protect, requireRole(adminRoles), BranchController.deleteBranch);

router.get("/:id/staff", protect, requireRole(staffRoles), BranchController.getBranchStaff);
router.get("/:id/customers", protect, requireRole(staffRoles), BranchController.getBranchCustomers);
router.get("/:id/orders", protect, requireRole(staffRoles), BranchController.getBranchOrders);
router.get("/:id/inventory", protect, requireRole(staffRoles), BranchController.getBranchInventory);
router.put("/:id/inventory", protect, requireRole(["super_admin", "admin", "inventory_manager", "branch_manager"]), BranchController.updateBranchInventory);

module.exports = router;

export {};
