
const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
  getAllUsers,
  deleteUser,
  updateUser,
  createUser
} = require('../controllers/userController');

// Get all users
router.get('/', protect, adminOnly, getAllUsers);
// Create new user
router.post('/', protect, adminOnly, createUser);
// Update user (including admin status)
router.put('/:id', protect, adminOnly, updateUser);
// Delete user
router.delete('/:id', protect, adminOnly, deleteUser);
module.exports = router;