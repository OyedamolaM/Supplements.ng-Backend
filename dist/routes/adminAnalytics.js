"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const { getAnalytics } = require('../controllers/adminAnalyticsController');
// Admin/accountant analytics route
router.get('/', protect, requireRole(['super_admin', 'admin', 'accountant']), getAnalytics);
module.exports = router;
