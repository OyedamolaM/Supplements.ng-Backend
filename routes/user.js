const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getProfile,
  updateProfile,
  addShippingAddress,
  removeShippingAddress
} = require('../controllers/userController');

// ===== Customer Routes =====

// Get user profile
router.get('/profile', protect, getProfile);

// Update user profile
router.put('/update', protect, updateProfile);

// Add new shipping address
router.post('/shipping', protect, addShippingAddress);

// Remove shipping address
router.delete('/shipping/:id', protect, removeShippingAddress);

module.exports = router;
