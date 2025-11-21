const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { getAllUsers, deleteUser } = require('../controllers/userController');

// Get all users
router.get('/', protect, adminOnly, getAllUsers);

// Delete a user
router.delete('/:id', protect, adminOnly, deleteUser);

module.exports = router;
