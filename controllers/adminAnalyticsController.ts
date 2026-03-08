const { prisma, toDbUserRole, toLegacyOrder } = require("../utils/prismaLegacy");

exports.getAnalytics = async (req, res) => {
  try {
    const totalUsers = await prisma.user.count({
      where: { role: toDbUserRole("customer") },
    });

    const totalProducts = await prisma.product.count();

    const orderStats = await prisma.order.aggregate({
      _sum: { totalPrice: true },
      _count: { _all: true },
    });

    const totalRevenue = orderStats._sum.totalPrice || 0;
    const totalOrders = orderStats._count._all || 0;

    const recentOrders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        branch: {
          select: { id: true, name: true, isOnline: true, address: true, phone: true, region: true },
        },
        items: true,
      },
    });

    res.json({
      totalUsers,
      totalProducts,
      totalOrders,
      totalRevenue,
      recentOrders: recentOrders.map((order) => toLegacyOrder(order)),
    });
  } catch (err) {
    console.error("Admin Analytics Error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

export {};
