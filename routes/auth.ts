const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Register
router.post('/register', authController.register);

// Login -> sets refresh cookie, returns access token
router.post('/login', authController.login);

// Refresh -> uses HttpOnly cookie, returns new access token
router.post('/refresh', authController.refresh);

// Logout -> clears refresh cookie
router.post('/logout', authController.logout);

module.exports = router;

export {};
