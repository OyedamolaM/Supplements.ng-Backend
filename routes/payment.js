const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { initiatePayment, verifyPayment } = require('../controllers/paymentController');

// Initialize payment
router.post('/initiate', protect, initiatePayment);

// Verify payment
router.post('/verify', protect, verifyPayment);

module.exports = router;
