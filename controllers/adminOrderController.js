const Order = require('../models/Order');

// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
  try {
    // Fetch orders with user info
    const orders = await Order.find().populate('user', 'name email');

    // No need to populate products.product — we rely on stored title & price snapshots
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Update order status (admin)
// =========================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const order = await Order.findById(req.params.id).populate('user', 'name email');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.orderStatus = status; // "Processing", "Shipped", "Delivered", "Cancelled"
    await order.save();

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
