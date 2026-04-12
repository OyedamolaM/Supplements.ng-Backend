const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { createOrder, getMyOrders, getOrderById, getReceipt, cancelOrder, rateOrder, trackDelivery } = require('../controllers/orderController');

// Create order
router.post('/', protect, createOrder);

// Get all orders for logged-in user
router.get('/my-orders', protect, getMyOrders);

// Get receipt by ID
router.get('/:id/receipt', protect, getReceipt);

// Track delivery by ID
router.get('/:id/track', protect, trackDelivery);

// Cancel an order
router.post('/:id/cancel', protect, cancelOrder);

// Rate an order
router.post('/:id/rate', protect, rateOrder);

// Get a single order by ID
router.get('/:id', protect, getOrderById);

module.exports = router;

export {};
