"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
exports.getAnalytics = async (req, res) => {
    try {
        // Total users
        const totalUsers = await User.countDocuments({ role: "customer" });
        // Total products
        const totalProducts = await Product.countDocuments();
        // Total revenue & order count
        const orderStats = await Order.aggregate([
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$totalPrice" },
                    totalOrders: { $sum: 1 }
                }
            }
        ]);
        const totalRevenue = orderStats[0]?.totalRevenue || 0;
        const totalOrders = orderStats[0]?.totalOrders || 0;
        // Recent 5 orders
        const recentOrders = await Order.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate("user", "name email phone");
        res.json({
            totalUsers,
            totalProducts,
            totalOrders,
            totalRevenue,
            recentOrders
        });
    }
    catch (err) {
        console.error("Admin Analytics Error:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};
