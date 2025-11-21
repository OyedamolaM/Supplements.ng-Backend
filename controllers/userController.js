const User = require('../models/User');
const bcrypt = require('bcryptjs');

// ===== Logged-in user routes =====

// Get logged-in user profile
exports.getProfile = async (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ message: 'User not found' });

  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
  });
};

// Update logged-in user profile
exports.updateProfile = async (req, res) => {
  const user = req.user;
  if (!user) return res.status(404).json({ message: 'User not found' });

  const { name, email, password } = req.body;

  if (name) user.name = name;
  if (email) user.email = email;

  if (password) {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
  }

  await user.save();

  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
  });
};

// ===== Admin-only routes =====

// Get all users
exports.getAllUsers = async (req, res) => {
  const users = await User.find().select('-password');
  res.json(users);
};

// Delete a user
exports.deleteUser = async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  await user.remove();
  res.json({ message: 'User removed' });
};
