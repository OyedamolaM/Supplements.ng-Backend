"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jwt = require('jsonwebtoken');
const { prisma, fromDbUserRole } = require("../utils/prismaLegacy");
exports.protect = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer '))
        return res.status(401).json({ message: 'Not authorized' });
    const token = auth.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                role: true,
                branchId: true,
            },
        });
        if (!user)
            return res.status(401).json({ message: 'User not found' });
        const role = fromDbUserRole(user.role);
        req.user = {
            id: user.id,
            _id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone || "",
            role,
            branch: user.branchId || null,
            isAdmin: role === "admin" || role === "super_admin",
        };
        next();
    }
    catch (err) {
        res.status(401).json({ message: 'Token invalid' });
    }
};
