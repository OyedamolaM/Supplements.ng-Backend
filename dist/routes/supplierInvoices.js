"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const router = express.Router();
const { protect, requireRole } = require("../middleware/authMiddleware");
const invoiceUpload = require("../middleware/invoiceUpload");
const SupplierInvoiceController = require("../controllers/supplierInvoiceController");
const invoiceRoles = [
    "super_admin",
    "admin",
    "inventory_manager",
    "branch_manager",
    "accountant",
];
router.get("/", protect, requireRole(invoiceRoles), SupplierInvoiceController.getSupplierInvoices);
router.post("/", protect, requireRole(invoiceRoles), invoiceUpload.array("attachments", 5), SupplierInvoiceController.createSupplierInvoice);
router.get("/:id", protect, requireRole(invoiceRoles), SupplierInvoiceController.getSupplierInvoice);
router.put("/:id", protect, requireRole(invoiceRoles), SupplierInvoiceController.updateSupplierInvoice);
router.post("/:id/payments", protect, requireRole(invoiceRoles), SupplierInvoiceController.addInvoicePayment);
router.delete("/:id", protect, requireRole(["super_admin", "admin"]), SupplierInvoiceController.deleteSupplierInvoice);
module.exports = router;
