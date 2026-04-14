"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
// Verify email
router.post('/verify-email', authController.verifyEmail);
// Resend verification code
router.post('/resend-verification', authController.resendVerification);
// Request password reset code
router.post('/forgot-password', authController.requestPasswordReset);
// Reset password with code
router.post('/reset-password', authController.resetPassword);
// Google OAuth (ID token)
router.post('/google', authController.googleAuth);
// Apple OAuth (ID token)
router.post('/apple', authController.appleAuth);
module.exports = router;
