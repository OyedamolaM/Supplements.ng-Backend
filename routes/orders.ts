const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createOrder,
  getMyOrders,
  getOrderById,
  getReceipt,
  cancelOrder,
  rateOrder,
  trackDelivery,
  getShippingQuote,
  getDeliveryTimeEstimate,
  getShippingStates,
  getLockersByState,
  checkLockerAvailability,
  getExportLocations,
  getExportDeliveryCost,
  confirmDelivery,
} = require('../controllers/orderController');

// Shipping quote (guest/customer)
router.post('/shipping-quote', getShippingQuote);
router.post('/shipping-eta', getDeliveryTimeEstimate);
router.get('/shipping-states', getShippingStates);
router.get('/lockers/:state', getLockersByState);
router.get('/lockers/availability/:lockerId', checkLockerAvailability);
router.get('/export/locations', getExportLocations);
router.post('/export/price', getExportDeliveryCost);

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

// Confirm delivery with order id
router.post('/:id/confirm-delivery', protect, confirmDelivery);

// Get a single order by ID
router.get('/:id', protect, getOrderById);

module.exports = router;

export {};
