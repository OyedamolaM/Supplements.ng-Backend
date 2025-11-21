const Order = require('../models/Order');
const Product = require('../models/Product');

exports.getAnalytics = async (req, res) => {
  try {
    const totalRevenueAgg = await Order.aggregate([
      { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" }, orderCount: { $sum: 1 } } }
    ]);

    const totalProducts = await Product.countDocuments();

    res.json({
      totalRevenue: totalRevenueAgg[0]?.totalRevenue || 0,
      totalOrders: totalRevenueAgg[0]?.orderCount || 0,
      totalProducts
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
