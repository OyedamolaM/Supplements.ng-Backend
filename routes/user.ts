const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const parser = require('../middleware/upload');
const {
  getProfile,
  updateProfile,
  updateAvatar,
  addShippingAddress,
  removeShippingAddress,
  updateShippingAddress,
  changePassword
} = require('../controllers/userController');
const {
  getPrescriptions,
  createPrescription,
  createPrescriptionUpload,
  getReminders,
  syncReminders,
  upsertReminder,
  updateReminder,
  deleteReminder,
} = require('../controllers/customerDashboardController');

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

module.exports = router;

export {};
