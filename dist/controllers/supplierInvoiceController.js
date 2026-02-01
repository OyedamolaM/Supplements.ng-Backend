"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SupplierInvoice = require("../models/SupplierInvoice");
const Supplier = require("../models/Supplier");
const Branch = require("../models/Branch");
const BranchInventory = require("../models/BranchInventory");
const InventoryMovement = require("../models/InventoryMovement");
const Product = require("../models/Product");
const ActivityLog = require("../models/ActivityLog");
const isAdminRole = (role) => role === "super_admin" || role === "admin";
const computeStatus = (balance, dueDate, amountPaid = 0) => {
    if (balance <= 0)
        return "paid";
    if (dueDate && new Date(dueDate) < new Date())
        return "overdue";
    if (amountPaid > 0)
        return "partial";
    return "unpaid";
};
const normalizeItems = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return { items: [], subtotal: 0 };
    }
    const normalized = [];
    let subtotal = 0;
    for (const item of items) {
        const productId = item.productId || item.product;
        if (!productId) {
            throw new Error("Product is required for each line item");
        }
        const product = await Product.findById(productId);
        if (!product) {
            throw new Error("Product not found for invoice line item");
        }
        const quantity = Number(item.quantity) || 0;
        const unitCost = Number(item.unitCost ?? item.costPrice ?? product.costPrice ?? product.price) || 0;
        if (quantity <= 0) {
            throw new Error("Quantity must be greater than zero");
        }
        const total = quantity * unitCost;
        subtotal += total;
        normalized.push({
            product: product._id,
            description: item.description || product.title || "",
            quantity,
            unitCost,
            total,
        });
    }
    return { items: normalized, subtotal };
};
exports.getSupplierInvoices = async (req, res) => {
    try {
        const { supplierId, branchId, status } = req.query;
        const filter = {};
        if (supplierId)
            filter.supplier = supplierId;
        if (status)
            filter.status = status;
        if (isAdminRole(req.user?.role)) {
            if (branchId)
                filter.branch = branchId;
        }
        else if (req.user?.branch) {
            filter.branch = req.user.branch;
        }
        const invoices = await SupplierInvoice.find(filter)
            .populate("supplier", "name phone email")
            .populate("branch", "name")
            .sort({ dateSupplied: -1 });
        res.json(invoices);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.getSupplierInvoice = async (req, res) => {
    try {
        const invoice = await SupplierInvoice.findById(req.params.id)
            .populate("supplier", "name phone email")
            .populate("branch", "name")
            .populate("items.product", "title");
        if (!invoice)
            return res.status(404).json({ message: "Invoice not found" });
        if (!isAdminRole(req.user?.role) && req.user?.branch) {
            if (invoice.branch?.toString() !== req.user.branch.toString()) {
                return res.status(403).json({ message: "Access denied" });
            }
        }
        res.json(invoice);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.createSupplierInvoice = async (req, res) => {
    try {
        const { supplierId, branchId, invoiceNumber, reference, dateSupplied, dueDate, items, tax, notes, payments, } = req.body;
        if (!supplierId || !dateSupplied) {
            return res.status(400).json({ message: "Supplier and supply date are required" });
        }
        const supplier = await Supplier.findById(supplierId);
        if (!supplier)
            return res.status(404).json({ message: "Supplier not found" });
        const isAdmin = isAdminRole(req.user?.role);
        const resolvedBranchId = isAdmin ? branchId : req.user.branch;
        if (!resolvedBranchId) {
            return res.status(400).json({ message: "Branch is required for invoice" });
        }
        const branch = await Branch.findById(resolvedBranchId);
        if (!branch)
            return res.status(404).json({ message: "Branch not found" });
        const parsedItems = typeof items === "string"
            ? JSON.parse(items || "[]")
            : items;
        const parsedPayments = typeof payments === "string"
            ? JSON.parse(payments || "[]")
            : payments;
        const normalized = await normalizeItems(parsedItems);
        const taxValue = Number(tax) || 0;
        const total = normalized.subtotal + taxValue;
        const paymentList = Array.isArray(parsedPayments) ? parsedPayments : [];
        const amountPaid = paymentList.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
        const balance = Math.max(total - amountPaid, 0);
        const status = computeStatus(balance, dueDate, amountPaid);
        const attachments = (req.files || []).map((file) => ({
            url: file.path,
            publicId: file.filename || "",
            fileName: file.originalname || "",
            mimeType: file.mimetype || "",
        }));
        const invoice = await SupplierInvoice.create({
            supplier: supplier._id,
            branch: resolvedBranchId,
            invoiceNumber,
            reference,
            dateSupplied,
            dueDate: dueDate || null,
            items: normalized.items,
            subtotal: normalized.subtotal,
            tax: taxValue,
            total,
            amountPaid,
            balance,
            status,
            payments: paymentList.map((payment) => ({
                amount: Number(payment.amount) || 0,
                method: payment.method || "",
                reference: payment.reference || "",
                note: payment.note || "",
                date: payment.date || new Date(),
            })),
            attachments,
            notes,
            createdBy: req.user?.id || null,
        });
        await Promise.all(normalized.items.map((item) => BranchInventory.findOneAndUpdate({ branch: resolvedBranchId, product: item.product }, { $inc: { quantity: item.quantity } }, { upsert: true, new: true })));
        await Promise.all(normalized.items.map((item) => InventoryMovement.create({
            branch: resolvedBranchId,
            product: item.product,
            type: "receipt",
            quantityChange: item.quantity,
            reason: "supplier_invoice",
            referenceType: "supplier_invoice",
            referenceId: invoice._id,
            createdBy: req.user?.id,
        })));
        await Supplier.updateOne({ _id: supplier._id }, { $inc: { balance } });
        const populated = await SupplierInvoice.findById(invoice._id)
            .populate("supplier", "name phone email")
            .populate("branch", "name");
        res.status(201).json(populated);
        ActivityLog.create({
            user: req.user?.id,
            action: "supplier_invoice_created",
            entityType: "supplier_invoice",
            entityId: invoice._id,
            branch: resolvedBranchId,
            message: "Recorded supplier invoice"
        }).catch(() => null);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.addInvoicePayment = async (req, res) => {
    try {
        const { amount, method, reference, note, date } = req.body;
        const paymentAmount = Number(amount) || 0;
        if (paymentAmount <= 0) {
            return res.status(400).json({ message: "Payment amount is required" });
        }
        const invoice = await SupplierInvoice.findById(req.params.id);
        if (!invoice)
            return res.status(404).json({ message: "Invoice not found" });
        if (!isAdminRole(req.user?.role) && req.user?.branch) {
            if (invoice.branch.toString() !== req.user.branch.toString()) {
                return res.status(403).json({ message: "Access denied" });
            }
        }
        invoice.payments.push({
            amount: paymentAmount,
            method: method || "",
            reference: reference || "",
            note: note || "",
            date: date || new Date(),
        });
        invoice.amountPaid = invoice.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
        invoice.balance = Math.max(invoice.total - invoice.amountPaid, 0);
        invoice.status = computeStatus(invoice.balance, invoice.dueDate, invoice.amountPaid);
        await invoice.save();
        await Supplier.updateOne({ _id: invoice.supplier }, { $inc: { balance: -paymentAmount } });
        const populated = await SupplierInvoice.findById(invoice._id)
            .populate("supplier", "name phone email")
            .populate("branch", "name");
        res.json(populated);
        ActivityLog.create({
            user: req.user?.id,
            action: "supplier_payment_recorded",
            entityType: "supplier_invoice",
            entityId: invoice._id,
            branch: invoice.branch,
            message: "Recorded supplier payment",
            meta: { amount: paymentAmount }
        }).catch(() => null);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.updateSupplierInvoice = async (req, res) => {
    try {
        const invoice = await SupplierInvoice.findById(req.params.id);
        if (!invoice)
            return res.status(404).json({ message: "Invoice not found" });
        if (!isAdminRole(req.user?.role) && req.user?.branch) {
            if (invoice.branch.toString() !== req.user.branch.toString()) {
                return res.status(403).json({ message: "Access denied" });
            }
        }
        const updateFields = [
            "invoiceNumber",
            "reference",
            "dateSupplied",
            "dueDate",
            "notes",
        ];
        updateFields.forEach((field) => {
            if (req.body[field] !== undefined) {
                invoice[field] = req.body[field];
            }
        });
        invoice.status = computeStatus(invoice.balance, invoice.dueDate, invoice.amountPaid);
        await invoice.save();
        res.json(invoice);
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.deleteSupplierInvoice = async (req, res) => {
    try {
        const invoice = await SupplierInvoice.findByIdAndDelete(req.params.id);
        if (!invoice)
            return res.status(404).json({ message: "Invoice not found" });
        await Supplier.updateOne({ _id: invoice.supplier }, { $inc: { balance: -invoice.balance } });
        res.json({ message: "Invoice removed" });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
