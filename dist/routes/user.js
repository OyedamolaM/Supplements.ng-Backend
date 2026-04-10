"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const parser = require('../middleware/upload');
const { getProfile, updateProfile, updateAvatar, addShippingAddress, removeShippingAddress, updateShippingAddress, changePassword } = require('../controllers/userController');
const { getPrescriptions, createPrescription, createPrescriptionUpload, getReminders, syncReminders, upsertReminder, updateReminder, deleteReminder, getRefillReminders, getPurchasedItems, updatePurchasedItemUsage, updatePurchasedItemPause, getNotifications, markNotificationsRead, } = require('../controllers/customerDashboardController');
// ===== Customer Routes =====
// Get user profile
router.get('/profile', protect, getProfile);
// Update user profile
router.put('/update', protect, updateProfile);
// Update avatar
router.post('/avatar', protect, parser.single('avatar'), updateAvatar);
// Add new shipping address
router.post('/shipping', protect, addShippingAddress);
// Remove shipping address
router.delete('/shipping/:id', protect, removeShippingAddress);
// Update shipping address
router.put('/shipping/:id', protect, updateShippingAddress);
// Change password
router.put('/password', protect, changePassword);
// Customer prescriptions
router.get('/prescriptions', protect, getPrescriptions);
router.post('/prescriptions', protect, createPrescription);
router.post('/prescriptions/upload', protect, parser.single('attachment'), createPrescriptionUpload);
// Customer reminders
router.get('/reminders', protect, getReminders);
router.post('/reminders/sync', protect, syncReminders);
router.post('/reminders', protect, upsertReminder);
router.put('/reminders/:id', protect, updateReminder);
router.delete('/reminders/:id', protect, deleteReminder);
// Refill reminders + purchased items
router.get('/refill-reminders', protect, getRefillReminders);
router.get('/purchased-items', protect, getPurchasedItems);
router.put('/purchased-items/:id/usage', protect, updatePurchasedItemUsage);
router.put('/purchased-items/:id/pause', protect, updatePurchasedItemPause);
// Notifications
router.get('/notifications', protect, getNotifications);
router.put('/notifications/read', protect, markNotificationsRead);
module.exports = router;
