
const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const {
  getAllUsers,
  deleteUser,
  updateUser,
  createUser
} = require('../controllers/userController');

const staffRoles = [
  'super_admin',
  'admin',
  'branch_manager',
  'accountant',
  'inventory_manager',
  'cashier',
  'staff'
];

// Get all users
router.get('/', protect, requireRole(staffRoles), getAllUsers);
// Create new user
router.post('/', protect, requireRole(staffRoles), createUser);
// Update user (including admin status)
router.put('/:id', protect, requireRole(staffRoles), updateUser);
// Delete user
router.delete('/:id', protect, requireRole(staffRoles), deleteUser);
module.exports = router;

export {};
