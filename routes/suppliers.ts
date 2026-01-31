const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const SupplierController = require("../controllers/supplierController");

const supplierRoles = [
  "super_admin",
  "admin",
  "inventory_manager",
  "branch_manager",
  "accountant",
];

router.get("/", protect, requireRole(supplierRoles), SupplierController.getSuppliers);
router.post("/", protect, requireRole(supplierRoles), SupplierController.createSupplier);
router.get("/:id", protect, requireRole(supplierRoles), SupplierController.getSupplier);
router.put("/:id", protect, requireRole(supplierRoles), SupplierController.updateSupplier);
router.delete("/:id", protect, requireRole(["super_admin", "admin"]), SupplierController.deleteSupplier);

module.exports = router;

export {};
