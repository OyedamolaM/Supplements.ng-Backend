const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  subscribeNewsletter,
  addShippingAddress,
  updateShippingAddress,
  deleteShippingAddress,
  getShippingAddresses,
  addToWishlist,
  removeFromWishlist,
  getWishlist
} = require('../controllers/customerController');

// Newsletter
router.post('/newsletter/subscribe', subscribeNewsletter);

// Shipping addresses
router.get('/shipping', protect, getShippingAddresses);
router.post('/shipping', protect, addShippingAddress);
router.put('/shipping/:index', protect, updateShippingAddress);
router.delete('/shipping/:index', protect, deleteShippingAddress);

// Wishlist
router.get('/wishlist', protect, getWishlist);
router.post('/wishlist', protect, addToWishlist);
router.delete('/wishlist', protect, removeFromWishlist);

module.exports = router;

export {};
