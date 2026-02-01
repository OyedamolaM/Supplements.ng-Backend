"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const toTitleCase = (value = '') => value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
const ACCESS_TTL = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const ACCESS_SECRET = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
const signAccessToken = (id) => jwt.sign({ id }, ACCESS_SECRET, {
    expiresIn: ACCESS_TTL,
});
const signRefreshToken = (id) => jwt.sign({ id }, REFRESH_SECRET, {
    expiresIn: REFRESH_TTL,
});
const setRefreshCookie = (res, token) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('refreshToken', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
};
// Register new user
exports.register = async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password || !phone) {
            return res.status(400).json({ message: 'Please provide all fields' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }
        const user = await User.create({
            name: toTitleCase(name),
            email,
            phone,
            password, // hashed automatically in pre-save
            role: 'customer'
        });
        res.status(201).json({
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isAdmin: user.isAdmin,
            accessToken: signAccessToken(user._id),
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
// Login user
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password' });
        }
        const user = await User.findOne({ email });
        if (!user)
            return res.status(400).json({ message: 'Invalid credentials' });
        const isMatch = await user.matchPassword(password);
        if (!isMatch)
            return res.status(400).json({ message: 'Invalid credentials' });
        ActivityLog.create({
            user: user._id,
            action: "login",
            entityType: "auth",
            branch: user.branch || null,
            message: "User signed in"
        }).catch(() => null);
        const refreshToken = signRefreshToken(user._id);
        setRefreshCookie(res, refreshToken);
        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isAdmin: user.isAdmin,
            accessToken: signAccessToken(user._id),
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
// Refresh access token using HttpOnly cookie
exports.refresh = async (req, res) => {
    const token = req.cookies?.refreshToken;
    if (!token)
        return res.status(401).json({ message: 'No refresh token' });
    try {
        const decoded = jwt.verify(token, REFRESH_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        if (!user)
            return res.status(401).json({ message: 'User not found' });
        const newRefresh = signRefreshToken(user._id);
        setRefreshCookie(res, newRefresh);
        res.json({
            accessToken: signAccessToken(user._id),
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                isAdmin: user.isAdmin,
            },
        });
    }
    catch (err) {
        console.error(err);
        res.status(401).json({ message: 'Invalid refresh token' });
    }
};
// Logout: clear cookie
exports.logout = (_req, res) => {
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/refresh',
    });
    res.status(204).send();
};
