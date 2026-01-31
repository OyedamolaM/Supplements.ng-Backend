const Supplier = require("../models/Supplier");

const isAdminRole = (role) => role === "super_admin" || role === "admin";

const buildSupplierFilter = (req) => {
  if (isAdminRole(req.user?.role)) return {};
  if (req.user?.branch) {
    return { $or: [{ branch: req.user.branch }, { branch: null }] };
  }
  return { branch: null };
};

exports.getSuppliers = async (req, res) => {
  try {
    const filter = buildSupplierFilter(req);
    const suppliers = await Supplier.find(filter).sort({ name: 1 });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    const {
      name,
      contactName,
      phone,
      email,
      address,
      paymentTerms,
      bankName,
      accountName,
      accountNumber,
      notes,
      branchId,
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Supplier name is required" });
    }

    const isAdmin = isAdminRole(req.user?.role);
    const supplier = await Supplier.create({
      name,
      contactName,
      phone,
      email,
      address,
      paymentTerms,
      bankName,
      accountName,
      accountNumber,
      notes,
      branch: isAdmin ? branchId || null : req.user.branch || null,
      createdBy: req.user?.id || null,
    });

    res.status(201).json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    if (!isAdminRole(req.user?.role)) {
      if (supplier.branch && supplier.branch.toString() !== req.user?.branch?.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    res.json(supplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    if (!isAdminRole(req.user?.role)) {
      if (supplier.branch && supplier.branch.toString() !== req.user?.branch?.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const update = { ...req.body };
    if (update.branchId !== undefined) {
      update.branch = update.branchId || null;
      delete update.branchId;
    }
    if (!isAdminRole(req.user?.role)) {
      delete update.branch;
      delete update.branchId;
    }

    const updated = await Supplier.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });
    res.json({ message: "Supplier removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export {};
