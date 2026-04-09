"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getProfile, updateProfile, addShippingAddress, removeShippingAddress } = require('../controllers/userController');
const { getPrescriptions, createPrescription, getReminders, syncReminders, upsertReminder, updateReminder, deleteReminder, } = require('../controllers/customerDashboardController');
// ===== Customer Routes =====
// Get user profile
router.get('/profile', protect, getProfile);
// Update user profile
router.put('/update', protect, updateProfile);
// Add new shipping address
router.post('/shipping', protect, addShippingAddress);
// Remove shipping address
router.delete('/shipping/:id', protect, removeShippingAddress);
// Customer prescriptions
router.get('/prescriptions', protect, getPrescriptions);
router.post('/prescriptions', protect, createPrescription);
// Customer reminders
router.get('/reminders', protect, getReminders);
router.post('/reminders/sync', protect, syncReminders);
router.post('/reminders', protect, upsertReminder);
router.put('/reminders/:id', protect, updateReminder);
router.delete('/reminders/:id', protect, deleteReminder);
module.exports = router;
