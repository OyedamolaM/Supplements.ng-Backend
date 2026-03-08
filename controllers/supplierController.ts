const { prisma, newId } = require("../utils/prismaLegacy");

const isAdminRole = (role) => role === "super_admin" || role === "admin";

const buildSupplierWhere = (req) => {
  if (isAdminRole(req.user?.role)) return {};
  if (req.user?.branch) {
    return {
      OR: [{ branchId: req.user.branch }, { branchId: null }],
    };
  }
  return { branchId: null };
};

const toLegacySupplier = (supplier) => ({
  _id: supplier.id,
  id: supplier.id,
  name: supplier.name,
  contactName: supplier.contactName || "",
  phone: supplier.phone || "",
  email: supplier.email || "",
  address: supplier.address || "",
  paymentTerms: supplier.paymentTerms || "",
  bankName: supplier.bankName || "",
  accountName: supplier.accountName || "",
  accountNumber: supplier.accountNumber || "",
  notes: supplier.notes || "",
  balance: supplier.balance || 0,
  branch: supplier.branchId || null,
  createdBy: supplier.createdById || null,
  createdAt: supplier.createdAt,
  updatedAt: supplier.updatedAt,
});

exports.getSuppliers = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: buildSupplierWhere(req),
      orderBy: { name: "asc" },
    });
    res.json(suppliers.map(toLegacySupplier));
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
    const supplier = await prisma.supplier.create({
      data: {
        id: newId(),
        name,
        contactName: contactName || "",
        phone: phone || "",
        email: email || "",
        address: address || "",
        paymentTerms: paymentTerms || "",
        bankName: bankName || "",
        accountName: accountName || "",
        accountNumber: accountNumber || "",
        notes: notes || "",
        branchId: isAdmin ? branchId || null : req.user.branch || null,
        createdById: req.user?.id || null,
      },
    });

    res.status(201).json(toLegacySupplier(supplier));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
    });
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    if (!isAdminRole(req.user?.role)) {
      if (supplier.branchId && supplier.branchId !== req.user?.branch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    res.json(toLegacySupplier(supplier));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
    });
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    if (!isAdminRole(req.user?.role)) {
      if (supplier.branchId && supplier.branchId !== req.user?.branch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const update = { ...req.body };
    if (update.branchId !== undefined) {
      update.branchId = update.branchId || null;
    }
    if (!isAdminRole(req.user?.role)) {
      delete update.branchId;
    }

    const updated = await prisma.supplier.update({
      where: { id: req.params.id },
      data: update,
    });
    res.json(toLegacySupplier(updated));
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Supplier not found" });
    }
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.json({ message: "Supplier removed" });
  } catch (error) {
    if (error.code === "P2003") {
      return res.status(400).json({ message: "Cannot remove supplier with invoices" });
    }
    res.status(500).json({ message: error.message });
  }
};

export {};
