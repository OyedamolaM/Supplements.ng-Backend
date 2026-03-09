const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");

exports.getWishlist = async (req, res) => {
  try {
    const items = await prisma.userWishlistItem.findMany({
      where: { userId: req.user.id },
      include: { product: true },
    });
    res.json(items.map((item) => toLegacyProduct(item.product)));
  } catch (err) {
    console.error("Wishlist fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.addToWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;
    if (!productId) return res.status(400).json({ message: "Product is required" });

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });

    await prisma.userWishlistItem.upsert({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
      create: {
        id: newId(),
        userId,
        productId,
      },
      update: {},
    });

    res.json({ message: "Added to wishlist" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.removeFromWishlist = async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.productId;
    if (!productId) return res.status(400).json({ message: "Product is required" });

    await prisma.userWishlistItem.deleteMany({
      where: {
        userId,
        productId,
      },
    });

    res.json({ message: "Removed from wishlist" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};
