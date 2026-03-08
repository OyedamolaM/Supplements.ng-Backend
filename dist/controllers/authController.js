"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma, newId, fromDbUserRole, toDbUserRole } = require("../utils/prismaLegacy");
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
        const normalizedEmail = email.toString().trim().toLowerCase();
        const existingUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: { id: true },
        });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                id: newId(),
                role: toDbUserRole("customer"),
                password: hashedPassword,
                email: normalizedEmail,
                phone: phone.toString().trim(),
                region: "",
                branchId: null,
                name: toTitleCase(name),
            },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
            },
        });
        const role = fromDbUserRole(user.role);
        res.status(201).json({
            id: user.id,
            name: toTitleCase(name),
            email: user.email,
            phone: user.phone,
            role,
            isAdmin: role === "admin" || role === "super_admin",
            accessToken: signAccessToken(user.id),
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
        const normalizedEmail = email.toString().trim().toLowerCase();
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                password: true,
                role: true,
                branchId: true,
            },
        });
        if (!user)
            return res.status(400).json({ message: 'Invalid credentials' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch)
            return res.status(400).json({ message: 'Invalid credentials' });
        prisma.activityLog
            .create({
            data: {
                id: newId(),
                userId: user.id,
                action: "login",
                entityType: "auth",
                branchId: user.branchId || null,
                message: "User signed in",
            },
        })
            .catch(() => null);
        const role = fromDbUserRole(user.role);
        const refreshToken = signRefreshToken(user.id);
        setRefreshCookie(res, refreshToken);
        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role,
            isAdmin: role === "admin" || role === "super_admin",
            accessToken: signAccessToken(user.id),
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
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
            },
        });
        if (!user)
            return res.status(401).json({ message: 'User not found' });
        const role = fromDbUserRole(user.role);
        const newRefresh = signRefreshToken(user.id);
        setRefreshCookie(res, newRefresh);
        res.json({
            accessToken: signAccessToken(user.id),
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role,
                isAdmin: role === "admin" || role === "super_admin",
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
