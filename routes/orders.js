const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createOrder, getMyOrders, getOrderById } = require('../controllers/orderController');

// Create order
router.post('/', protect, createOrder);

// Get all orders for logged-in user
router.get('/my-orders', protect, getMyOrders);

// Get a single order by ID
router.get('/:id', protect, getOrderById);

module.exports = router;
