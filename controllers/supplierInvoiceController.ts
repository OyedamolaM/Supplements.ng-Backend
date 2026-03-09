const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");

const isAdminRole = (role) => role === "super_admin" || role === "admin";

const computeStatus = (balance, dueDate, amountPaid = 0) => {
  if (balance <= 0) return "paid";
  if (dueDate && new Date(dueDate) < new Date()) return "overdue";
  if (amountPaid > 0) return "partial";
  return "unpaid";
};

const toDbInvoiceStatus = (status) => {
  const key = (status || "").toString().trim().toLowerCase();
  if (key === "paid") return "PAID";
  if (key === "partial") return "PARTIAL";
  if (key === "overdue") return "OVERDUE";
  return "UNPAID";
};

const fromDbInvoiceStatus = (status) => (status || "").toString().toLowerCase();

const parseDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseJsonOrFallback = (value, fallback) => {
  if (typeof value !== "string") return value ?? fallback;
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
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

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, costPrice: true, price: true },
    });
    if (!product) {
      throw new Error("Product not found for invoice line item");
    }

    const quantity = Number(item.quantity) || 0;
    const unitCost =
      Number(item.unitCost ?? item.costPrice ?? product.costPrice ?? product.price) || 0;
    if (quantity <= 0) {
      throw new Error("Quantity must be greater than zero");
    }

    const total = quantity * unitCost;
    subtotal += total;
    normalized.push({
      productId: product.id,
      description: item.description || product.title || "",
      quantity,
      unitCost,
      total,
      product,
    });
  }

  return { items: normalized, subtotal };
};

const toLegacyPayment = (payment) => ({
  _id: payment.id,
  id: payment.id,
  amount: payment.amount,
  method: payment.method || "",
  reference: payment.reference || "",
  note: payment.note || "",
  date: payment.date,
});

const toLegacyAttachment = (attachment) => ({
  _id: attachment.id,
  id: attachment.id,
  url: attachment.url,
  publicId: attachment.publicId || "",
  fileName: attachment.fileName || "",
  mimeType: attachment.mimeType || "",
});

const toLegacySupplierInvoice = (invoice) => ({
  _id: invoice.id,
  id: invoice.id,
  supplier: invoice.supplier
    ? {
        _id: invoice.supplier.id,
        id: invoice.supplier.id,
        name: invoice.supplier.name,
        phone: invoice.supplier.phone || "",
        email: invoice.supplier.email || "",
      }
    : invoice.supplierId,
  branch: invoice.branch
    ? {
        _id: invoice.branch.id,
        id: invoice.branch.id,
        name: invoice.branch.name,
      }
    : invoice.branchId,
  invoiceNumber: invoice.invoiceNumber || "",
  reference: invoice.reference || "",
  dateSupplied: invoice.dateSupplied,
  dueDate: invoice.dueDate,
  items: (invoice.items || []).map((item) => ({
    _id: item.id,
    id: item.id,
    product: item.product ? toLegacyProduct(item.product) : item.productId,
    description: item.description || "",
    quantity: item.quantity,
    unitCost: item.unitCost,
    total: item.total,
  })),
  subtotal: invoice.subtotal || 0,
  tax: invoice.tax || 0,
  total: invoice.total || 0,
  amountPaid: invoice.amountPaid || 0,
  balance: invoice.balance || 0,
  status: fromDbInvoiceStatus(invoice.status),
  payments: (invoice.payments || []).map(toLegacyPayment),
  attachments: (invoice.attachments || []).map(toLegacyAttachment),
  notes: invoice.notes || "",
  createdBy: invoice.createdById || null,
  createdAt: invoice.createdAt,
  updatedAt: invoice.updatedAt,
});

const invoiceInclude = {
  supplier: { select: { id: true, name: true, phone: true, email: true } },
  branch: { select: { id: true, name: true } },
  items: {
    include: {
      product: true,
    },
  },
  payments: true,
  attachments: true,
};

exports.getSupplierInvoices = async (req, res) => {
  try {
    const { supplierId, branchId, status } = req.query;
    const where: Record<string, any> = {};

    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = toDbInvoiceStatus(status);

    if (isAdminRole(req.user?.role)) {
      if (branchId) where.branchId = branchId;
    } else if (req.user?.branch) {
      where.branchId = req.user.branch;
    }

    const invoices = await prisma.supplierInvoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { dateSupplied: "desc" },
    });

    res.json(invoices.map((invoice) => toLegacySupplierInvoice(invoice)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getSupplierInvoice = async (req, res) => {
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (!isAdminRole(req.user?.role) && req.user?.branch) {
      if (invoice.branchId !== req.user.branch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    res.json(toLegacySupplierInvoice(invoice));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createSupplierInvoice = async (req, res) => {
  try {
    const {
      supplierId,
      branchId,
      invoiceNumber,
      reference,
      dateSupplied,
      dueDate,
      items,
      tax,
      notes,
      payments,
    } = req.body;

    if (!supplierId || !dateSupplied) {
      return res.status(400).json({ message: "Supplier and supply date are required" });
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    const isAdmin = isAdminRole(req.user?.role);
    const resolvedBranchId = isAdmin ? branchId : req.user?.branch;
    if (!resolvedBranchId) {
      return res.status(400).json({ message: "Branch is required for invoice" });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: resolvedBranchId },
      select: { id: true },
    });
    if (!branch) return res.status(404).json({ message: "Branch not found" });

    const parsedItems = parseJsonOrFallback(items, []);
    const parsedPayments = parseJsonOrFallback(payments, []);
    const normalized = await normalizeItems(parsedItems);
    const taxValue = Number(tax) || 0;
    const total = normalized.subtotal + taxValue;
    const paymentList = Array.isArray(parsedPayments) ? parsedPayments : [];
    const amountPaid = paymentList.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    );
    const balance = Math.max(total - amountPaid, 0);
    const dueDateValue = parseDateOrNull(dueDate);
    const statusValue = computeStatus(balance, dueDateValue, amountPaid);

    const attachments = (req.files || []).map((file) => ({
      id: newId(),
      url: file.path,
      publicId: file.filename || "",
      fileName: file.originalname || "",
      mimeType: file.mimetype || "",
    }));

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierInvoice.create({
        data: {
          id: newId(),
          supplierId: supplier.id,
          branchId: resolvedBranchId,
          invoiceNumber: invoiceNumber || "",
          reference: reference || "",
          dateSupplied: new Date(dateSupplied),
          dueDate: dueDateValue,
          subtotal: normalized.subtotal,
          tax: taxValue,
          total,
          amountPaid,
          balance,
          status: toDbInvoiceStatus(statusValue),
          notes: notes || "",
          createdById: req.user?.id || null,
          items: {
            create: normalized.items.map((item) => ({
              id: newId(),
              productId: item.productId,
              description: item.description || "",
              quantity: item.quantity,
              unitCost: item.unitCost,
              total: item.total,
            })),
          },
          payments: {
            create: paymentList.map((payment) => ({
              id: newId(),
              amount: Number(payment.amount) || 0,
              method: payment.method || "",
              reference: payment.reference || "",
              note: payment.note || "",
              date: parseDateOrNull(payment.date) || new Date(),
            })),
          },
          attachments: {
            create: attachments.map((attachment) => ({
              id: attachment.id,
              url: attachment.url,
              publicId: attachment.publicId,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
            })),
          },
        },
        include: invoiceInclude,
      });

      for (const item of normalized.items) {
        await tx.branchInventory.upsert({
          where: {
            branchId_productId: {
              branchId: resolvedBranchId,
              productId: item.productId,
            },
          },
          create: {
            id: newId(),
            branchId: resolvedBranchId,
            productId: item.productId,
            quantity: item.quantity,
          },
          update: {
            quantity: { increment: item.quantity },
          },
        });

        await tx.inventoryMovement.create({
          data: {
            id: newId(),
            branchId: resolvedBranchId,
            productId: item.productId,
            type: "RECEIPT",
            quantityChange: item.quantity,
            reason: "supplier_invoice",
            referenceType: "supplier_invoice",
            referenceId: created.id,
            createdById: req.user?.id || null,
          },
        });
      }

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { balance: { increment: balance } },
      });

      return created;
    });

    res.status(201).json(toLegacySupplierInvoice(invoice));

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user?.id,
          action: "supplier_invoice_created",
          entityType: "supplier_invoice",
          entityId: invoice.id,
          branchId: resolvedBranchId,
          message: "Recorded supplier invoice",
        },
      })
      .catch(() => null);
  } catch (error) {
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

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        supplierId: true,
        branchId: true,
        total: true,
        dueDate: true,
      },
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (!isAdminRole(req.user?.role) && req.user?.branch) {
      if (invoice.branchId !== req.user.branch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supplierInvoicePayment.create({
        data: {
          id: newId(),
          invoiceId: invoice.id,
          amount: paymentAmount,
          method: method || "",
          reference: reference || "",
          note: note || "",
          date: parseDateOrNull(date) || new Date(),
        },
      });

      const paid = await tx.supplierInvoicePayment.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      const amountPaid = Number(paid?._sum?.amount || 0);
      const balance = Math.max(Number(invoice.total || 0) - amountPaid, 0);
      const statusValue = computeStatus(balance, invoice.dueDate, amountPaid);

      const nextInvoice = await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid,
          balance,
          status: toDbInvoiceStatus(statusValue),
        },
        include: invoiceInclude,
      });

      await tx.supplier.update({
        where: { id: invoice.supplierId },
        data: { balance: { decrement: paymentAmount } },
      });

      return nextInvoice;
    });

    res.json(toLegacySupplierInvoice(updated));

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user?.id,
          action: "supplier_payment_recorded",
          entityType: "supplier_invoice",
          entityId: updated.id,
          branchId: updated.branchId,
          message: "Recorded supplier payment",
          meta: { amount: paymentAmount },
        },
      })
      .catch(() => null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSupplierInvoice = async (req, res) => {
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        branchId: true,
        amountPaid: true,
        balance: true,
        dueDate: true,
      },
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (!isAdminRole(req.user?.role) && req.user?.branch) {
      if (invoice.branchId !== req.user.branch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const updateData: Record<string, any> = {};
    if (req.body.invoiceNumber !== undefined) updateData.invoiceNumber = req.body.invoiceNumber || "";
    if (req.body.reference !== undefined) updateData.reference = req.body.reference || "";
    if (req.body.dateSupplied !== undefined) {
      const nextDateSupplied = parseDateOrNull(req.body.dateSupplied);
      if (!nextDateSupplied) {
        return res.status(400).json({ message: "Invalid date supplied" });
      }
      updateData.dateSupplied = nextDateSupplied;
    }
    if (req.body.dueDate !== undefined) {
      updateData.dueDate = parseDateOrNull(req.body.dueDate);
    }
    if (req.body.notes !== undefined) updateData.notes = req.body.notes || "";

    const nextDueDate =
      updateData.dueDate !== undefined ? updateData.dueDate : invoice.dueDate;
    updateData.status = toDbInvoiceStatus(
      computeStatus(invoice.balance, nextDueDate, invoice.amountPaid)
    );

    const updated = await prisma.supplierInvoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: invoiceInclude,
    });

    res.json(toLegacySupplierInvoice(updated));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSupplierInvoice = async (req, res) => {
  try {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: req.params.id },
      select: { id: true, supplierId: true, balance: true },
    });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    await prisma.$transaction(async (tx) => {
      await tx.supplierInvoice.delete({ where: { id: invoice.id } });
      await tx.supplier.update({
        where: { id: invoice.supplierId },
        data: { balance: { decrement: Number(invoice.balance || 0) } },
      });
    });

    res.json({ message: "Invoice removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
