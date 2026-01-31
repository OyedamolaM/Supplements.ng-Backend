const Product = require('../models/Product');
const ActivityLog = require('../models/ActivityLog');

// =========================
// LIST PRODUCTS (PUBLIC)
// =========================
exports.list = async (req, res) => {
  const { search = '' } = req.query;

  const filter = search
    ? { title: { $regex: search, $options: 'i' } }
    : {};

  const products = await Product.find(filter);
  res.json(products);
};

// =========================
// GET ONE PRODUCT
// =========================
exports.getOne = async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product)
    return res.status(404).json({ message: 'Product not found' });

  res.json(product);
};

// =========================
// CREATE PRODUCT (ADMIN)
// WITH IMAGE UPLOAD
// =========================
exports.create = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      stock,
      category,
      costPrice,
      sellingPrice,
      expiryDate,
      quantityAvailable,
      sku,
      batchNumber,
      barcode,
      supplier,
      reorderLevel,
      taxCategory,
      taxRate,
      dosageForm,
      strength,
      packSize,
      manufacturer
    } = req.body;

    const normalizedSellingPrice =
      sellingPrice !== undefined && sellingPrice !== ''
        ? Number(sellingPrice)
        : Number(price);
    const normalizedQuantity =
      quantityAvailable !== undefined && quantityAvailable !== ''
        ? Number(quantityAvailable)
        : Number(stock);

    // Save uploaded images
    const images = req.files ? req.files.map(file => file.path) : [];

    const product = await Product.create({
      title,
      description,
      price: normalizedSellingPrice,
      costPrice,
      sellingPrice: normalizedSellingPrice,
      expiryDate: expiryDate || undefined,
      stock: normalizedQuantity || 0,
      quantityAvailable: normalizedQuantity || 0,
      sku,
      batchNumber,
      barcode,
      supplier,
      reorderLevel,
      taxCategory,
      taxRate: taxRate || null,
      dosageForm,
      strength,
      packSize,
      manufacturer,
      category,
      images
    });

    res.status(201).json(product);

    ActivityLog.create({
      user: req.user?.id,
      action: "product_created",
      entityType: "product",
      entityId: product._id,
      branch: req.user?.branch || null,
      message: "Created product"
    }).catch(() => null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// UPDATE PRODUCT (ADMIN)
// =========================
exports.update = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (req.files && req.files.length > 0) {
      // Replace images if new files uploaded
      updateData.images = req.files.map(file => file.path);
    }

    if (updateData.taxRate === '') {
      updateData.taxRate = null;
    }

    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Product not found' });

    const nextSellingPrice = updateData.sellingPrice !== undefined ? Number(updateData.sellingPrice) : existing.sellingPrice;
    const nextCostPrice = updateData.costPrice !== undefined ? Number(updateData.costPrice) : existing.costPrice;
    const priceChanged =
      Number(existing.sellingPrice || existing.price || 0) !== Number(nextSellingPrice || 0) ||
      Number(existing.costPrice || 0) !== Number(nextCostPrice || 0);

    if (priceChanged && !updateData.changeReason) {
      return res.status(400).json({ message: "Change reason is required for price updates" });
    }

    const priceChangeReason = priceChanged ? updateData.changeReason : null;
    delete updateData.changeReason;

    if (updateData.sellingPrice !== undefined) {
      const normalized = Number(updateData.sellingPrice);
      updateData.price = normalized;
      updateData.sellingPrice = normalized;
    }

    if (updateData.quantityAvailable !== undefined) {
      const normalized = Number(updateData.quantityAvailable);
      updateData.stock = normalized;
      updateData.quantityAvailable = normalized;
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(product);

    ActivityLog.create({
      user: req.user?.id,
      action: "product_updated",
      entityType: "product",
      entityId: product._id,
      branch: req.user?.branch || null,
      message: "Updated product",
      meta: priceChangeReason ? { reason: priceChangeReason } : {}
    }).catch(() => null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// DELETE PRODUCT (ADMIN)
// =========================
exports.remove = async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product)
    return res.status(404).json({ message: 'Product not found' });

  res.json({ message: 'Product removed' });
};

export {};
