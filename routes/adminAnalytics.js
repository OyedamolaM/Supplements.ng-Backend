const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { getAnalytics } = require('../controllers/adminAnalyticsController');

// Admin-only analytics route
router.get('/', protect, adminOnly, getAnalytics);

module.exports = router;
