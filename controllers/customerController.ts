const User = require('../models/User');

// --- SHIPPING ADDRESSES ---
// Add a new address
exports.addShippingAddress = async (req, res) => {
  const user = req.user;
  user.shippingAddresses.push(req.body);
  await user.save();
  res.status(201).json(user.shippingAddresses);
};

// Update an address by index
exports.updateShippingAddress = async (req, res) => {
  const user = req.user;
  const { index } = req.params; // index of address in array
  if (!user.shippingAddresses[index]) return res.status(404).json({ message: 'Address not found' });

  user.shippingAddresses[index] = { ...user.shippingAddresses[index]._doc, ...req.body };
  await user.save();
  res.json(user.shippingAddresses);
};

// Delete an address by index
exports.deleteShippingAddress = async (req, res) => {
  const user = req.user;
  const { index } = req.params;
  if (!user.shippingAddresses[index]) return res.status(404).json({ message: 'Address not found' });

  user.shippingAddresses.splice(index, 1);
  await user.save();
  res.json(user.shippingAddresses);
};

// Get all addresses
exports.getShippingAddresses = async (req, res) => {
  res.json(req.user.shippingAddresses);
};

// --- WISHLIST ---
// Add product to wishlist
exports.addToWishlist = async (req, res) => {
  const user = req.user;
  const { productId } = req.body;

  if (!user.wishlist.includes(productId)) {
    user.wishlist.push(productId);
    await user.save();
  }

  res.json(user.wishlist);
};

// Remove product from wishlist
exports.removeFromWishlist = async (req, res) => {
  const user = req.user;
  const { productId } = req.body;

  user.wishlist = user.wishlist.filter(id => id.toString() !== productId);
  await user.save();

  res.json(user.wishlist);
};

// Get wishlist
exports.getWishlist = async (req, res) => {
  await req.user.populate('wishlist', 'title price images category');
  res.json(req.user.wishlist);
};
