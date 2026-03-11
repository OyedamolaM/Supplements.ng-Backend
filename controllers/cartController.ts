const { prisma, newId, toLegacyProduct, fromDbUserRole } = require("../utils/prismaLegacy");

const isProductAvailableForOnlinePurchase = (product) => {
  if (!product || !product.isActiveOnline) return false;
  if (Number(product.quantityAvailable || 0) > 0) return true;
  return (product.branchInventories || []).some(
    (entry) => entry?.branch?.isOnline && Number(entry.quantity || 0) > 0
  );
};

const buildCartResponse = (cartItems = []) => {
  const items = cartItems.map((item) => {
    const product = item.product ? toLegacyProduct(item.product) : null;
    const price = item.price ?? product?.price ?? 0;
    const quantity = item.quantity || 0;
    const productId = item.productId;
    return {
      id: item.id,
      product,
      productId,
      quantity,
      price,
      lineTotal: price * quantity,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const distinctCount = items.length;

  return { items, subtotal, itemCount, distinctCount };
};

const ensureCustomer = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { role: true },
  });
  const role = fromDbUserRole(user?.role);
  if (role !== "customer") {
    res.status(403).json({ message: "Only customers can use the cart" });
    return false;
  }
  return true;
};

exports.getCart = async (req, res) => {
  try {
    if (!(await ensureCustomer(req, res))) return;
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        cartItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(buildCartResponse(user.cartItems));
  } catch (err) {
    console.error("Cart fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.addToCart = async (req, res) => {
  try {
    if (!(await ensureCustomer(req, res))) return;
    const { productId, quantity } = req.body;
    const qty = Math.max(parseInt(quantity || 1, 10), 1);

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        price: true,
        deletedAt: true,
        isActiveOnline: true,
        quantityAvailable: true,
        branchInventories: {
          where: { quantity: { gt: 0 } },
          select: {
            quantity: true,
            branch: { select: { isOnline: true } },
          },
        },
      },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.deletedAt) {
      return res.status(400).json({ message: "Product is no longer available" });
    }
    if (!isProductAvailableForOnlinePurchase(product)) {
      return res.status(400).json({ message: "Product is not available for online purchase" });
    }

    const existing = await prisma.userCartItem.findUnique({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId,
        },
      },
      select: { id: true, quantity: true },
    });

    if (existing) {
      await prisma.userCartItem.update({
        where: { id: existing.id },
        data: {
          quantity: existing.quantity + qty,
          price: product.price,
        },
      });
    } else {
      await prisma.userCartItem.create({
        data: {
          id: newId(),
          userId: req.user.id,
          productId: product.id,
          quantity: qty,
          price: product.price,
        },
      });
    }

    const cartItems = await prisma.userCartItem.findMany({
      where: { userId: req.user.id },
      include: { product: true },
    });
    res.json(buildCartResponse(cartItems));
  } catch (err) {
    console.error("Add to cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateCartItem = async (req, res) => {
  try {
    if (!(await ensureCustomer(req, res))) return;
    const { productId } = req.params;
    const qty = parseInt(req.body.quantity, 10);

    if (Number.isNaN(qty)) {
      return res.status(400).json({ message: "Quantity is required" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        price: true,
        deletedAt: true,
        isActiveOnline: true,
        quantityAvailable: true,
        branchInventories: {
          where: { quantity: { gt: 0 } },
          select: {
            quantity: true,
            branch: { select: { isOnline: true } },
          },
        },
      },
    });
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.deletedAt) {
      return res.status(400).json({ message: "Product is no longer available" });
    }
    if (!isProductAvailableForOnlinePurchase(product)) {
      return res.status(400).json({ message: "Product is not available for online purchase" });
    }

    const item = await prisma.userCartItem.findUnique({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId,
        },
      },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ message: "Item not in cart" });

    if (qty <= 0) {
      await prisma.userCartItem.delete({
        where: { id: item.id },
      });
    } else {
      await prisma.userCartItem.update({
        where: { id: item.id },
        data: {
          quantity: qty,
          price: product.price,
        },
      });
    }

    const cartItems = await prisma.userCartItem.findMany({
      where: { userId: req.user.id },
      include: { product: true },
    });
    res.json(buildCartResponse(cartItems));
  } catch (err) {
    console.error("Update cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.removeFromCart = async (req, res) => {
  try {
    if (!(await ensureCustomer(req, res))) return;
    const { productId } = req.params;

    await prisma.userCartItem.deleteMany({
      where: {
        userId: req.user.id,
        productId,
      },
    });

    const cartItems = await prisma.userCartItem.findMany({
      where: { userId: req.user.id },
      include: { product: true },
    });
    res.json(buildCartResponse(cartItems));
  } catch (err) {
    console.error("Remove from cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.clearCart = async (req, res) => {
  try {
    if (!(await ensureCustomer(req, res))) return;

    await prisma.userCartItem.deleteMany({
      where: { userId: req.user.id },
    });

    res.json({ items: [], subtotal: 0, itemCount: 0 });
  } catch (err) {
    console.error("Clear cart error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
