const Product = require("../models/Product");
const User = require("../models/User");

const buildCartResponse = (user) => {
  const items = user.cart.map((item) => {
    const product = item.product;
    const price = item.price ?? product?.price ?? 0;
    const quantity = item.quantity || 0;
    const productId =
      product?._id?.toString?.() ||
      item.product?.toString?.() ||
      item.product;
    return {
      id: item._id,
      product,
      productId,
      quantity,
      price,
      lineTotal: price * quantity,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const distinctCount = items.length;

  return { items, subtotal, itemCount, distinctCount };
};

const ensureCustomer = (req, res) => {
  if (req.user.role !== "user") {
    res.status(403).json({ message: "Only customers can use the cart" });
    return false;
  }
  return true;
};

exports.getCart = async (req, res) => {
  try {
    if (!ensureCustomer(req, res)) return;
    const user = await User.findById(req.user.id).populate(
      "cart.product",
      "title price images stock"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(buildCartResponse(user));
  } catch (err) {
    console.error("Cart fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.addToCart = async (req, res) => {
  try {
    if (!ensureCustomer(req, res)) return;
    const { productId, quantity } = req.body;
    const qty = Math.max(parseInt(quantity || 1, 10), 1);

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const existing = user.cart.find(
      (item) => item.product.toString() === productId
    );

    if (existing) {
      existing.quantity += qty;
      existing.price = product.price;
    } else {
      user.cart.push({
        product: product._id,
        quantity: qty,
        price: product.price,
      });
    }

    await user.save();
    await user.populate("cart.product", "title price images stock");
    res.json(buildCartResponse(user));
  } catch (err) {
    console.error("Add to cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    if (!ensureCustomer(req, res)) return;
    const { productId } = req.params;
    const qty = parseInt(req.body.quantity, 10);

    if (Number.isNaN(qty)) {
      return res.status(400).json({ message: "Quantity is required" });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const item = user.cart.find(
      (cartItem) => cartItem.product.toString() === productId
    );
    if (!item) return res.status(404).json({ message: "Item not in cart" });

    if (qty <= 0) {
      user.cart = user.cart.filter(
        (cartItem) => cartItem.product.toString() !== productId
      );
    } else {
      item.quantity = qty;
      item.price = product.price;
    }

    await user.save();
    await user.populate("cart.product", "title price images stock");
    res.json(buildCartResponse(user));
  } catch (err) {
    console.error("Update cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    if (!ensureCustomer(req, res)) return;
    const { productId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.cart = user.cart.filter(
      (item) => item.product.toString() !== productId
    );

    await user.save();
    await user.populate("cart.product", "title price images stock");
    res.json(buildCartResponse(user));
  } catch (err) {
    console.error("Remove from cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.clearCart = async (req, res) => {
  try {
    if (!ensureCustomer(req, res)) return;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.cart = [];
    await user.save();
    res.json({ items: [], subtotal: 0, itemCount: 0 });
  } catch (err) {
    console.error("Clear cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
