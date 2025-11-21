const Product = require('../models/Product');

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
// WITH CLOUDINARY IMAGES
// =========================
exports.create = async (req, res) => {
  try {
    const { title, description, price, stock, category } = req.body;

    // Save uploaded Cloudinary image URLs
    const images = req.files ? req.files.map(file => file.path) : [];

    const product = await Product.create({
      title,
      description,
      price,
      stock,
      category,
      images
    });

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =========================
// UPDATE PRODUCT (ADMIN)
// SUPPORTS NEW IMAGES
// =========================
exports.update = async (req, res) => {
  try {
    let updateData = req.body;

    // If new images uploaded, include them
    if (req.files && req.files.length > 0) {
      updateData.images = req.files.map(file => file.path);
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    if (!product)
      return res.status(404).json({ message: 'Product not found' });

    res.json(product);
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
