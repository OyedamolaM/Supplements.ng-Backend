const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { getAllOrders, updateOrderStatus } = require('../controllers/adminOrderController');

// Get all orders (admin)
router.get('/', protect, adminOnly, getAllOrders);

// Update order status (admin)
router.put('/:id', protect, adminOnly, updateOrderStatus);

module.exports = router;
