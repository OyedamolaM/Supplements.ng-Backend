const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const { getAnalytics, getOverview } = require('../controllers/adminAnalyticsController');

// Admin/accountant analytics route
router.get('/', protect, requireRole(['super_admin', 'admin', 'accountant']), getAnalytics);
router.get('/overview', protect, requireRole(['super_admin', 'admin']), getOverview);

module.exports = router;

export {};
