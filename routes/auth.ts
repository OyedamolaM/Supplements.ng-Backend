const express = require('express');
const router = express.Router();
const { register, login, refresh, logout } = require('../controllers/authController');

// Register
router.post('/register', register);

// Login -> sets refresh cookie, returns access token
router.post('/login', login);

// Refresh -> uses HttpOnly cookie, returns new access token
router.post('/refresh', refresh);

// Logout -> clears refresh cookie
router.post('/logout', logout);

module.exports = router;

export {};
