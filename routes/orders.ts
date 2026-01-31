const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createOrder, getMyOrders, getOrderById, getReceipt } = require('../controllers/orderController');

// Create order
router.post('/', protect, createOrder);

// Get all orders for logged-in user
router.get('/my-orders', protect, getMyOrders);

// Get receipt by ID
router.get('/:id/receipt', protect, getReceipt);

// Get a single order by ID
router.get('/:id', protect, getOrderById);

module.exports = router;

export {};
