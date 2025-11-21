const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getProfile, updateProfile } = require('../controllers/userController');

// Get user profile
router.get('/profile', protect, getProfile);

// Update user profile
router.put('/update', protect, updateProfile);

module.exports = router;
