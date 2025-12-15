const Order = require('../models/Order');
const Product = require('../models/Product');

// =========================
// Create a new order
// =========================
exports.createOrder = async (req, res) => {
  try {
    const { products, shippingAddress, paymentMethod } = req.body;

    if (!products || products.length === 0)
      return res.status(400).json({ message: 'No products in order' });

    let totalPrice = 0;
    const orderProducts = [];

    for (const item of products) {
      const product = await Product.findById(item.product);
      if (!product) return res.status(404).json({ message: 'Product not found' });

      orderProducts.push({
        product: product._id,
        title: product.title,
        price: product.price,
        quantity: item.quantity || 1
      });

      totalPrice += product.price * (item.quantity || 1);
    }

    const order = await Order.create({
      user: req.user._id,
      products: orderProducts,
      shippingAddress,
      paymentMethod: paymentMethod || 'Cash on Delivery',
      totalPrice
    });

    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Get logged-in user's orders
// =========================
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Get a single order by ID
// =========================
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Ensure user can only access their own orders
    if (order.user.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Access denied' });

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Update order (admin or user can update certain fields)
// =========================
exports.updateOrder = async (req, res) => {
  try {
    const { shippingAddress, paymentMethod, orderStatus } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Only admin can update status
    if (orderStatus && req.user.isAdmin) {
      order.orderStatus = orderStatus;
    }

    // Users can update shipping address or payment method if not yet delivered
    if (order.orderStatus !== 'Delivered') {
      if (shippingAddress) order.shippingAddress = shippingAddress;
      if (paymentMethod) order.paymentMethod = paymentMethod;
    }

    await order.save();
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'name email');
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
