const Order = require('../models/Order');
const Product = require('../models/Product');

// Create a new order
exports.createOrder = async (req, res) => {
  const { products, shippingAddress, paymentMethod } = req.body;

  if (!products || products.length === 0)
    return res.status(400).json({ message: 'No products in order' });

  // Calculate total price
  let totalPrice = 0;
  for (const item of products) {
    const product = await Product.findById(item.product);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    totalPrice += product.price * item.quantity;
    item.price = product.price; // store price at order time
  }

  const order = await Order.create({
    user: req.user._id,
    products,
    shippingAddress,
    paymentMethod,
    totalPrice
  });

  res.status(201).json(order);
};

// Get logged-in user's orders
exports.getMyOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).populate('products.product', 'title price');
  res.json(orders);
};

// Get single order (optional)
exports.getOrderById = async (req, res) => {
  const order = await Order.findById(req.params.id).populate('products.product', 'title price');
  if (!order) return res.status(404).json({ message: 'Order not found' });

  // Ensure user can only access their own orders
  if (order.user.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'Access denied' });

  res.json(order);
};
