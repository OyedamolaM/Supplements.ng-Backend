const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Branch = require('../models/Branch');
const BranchInventory = require('../models/BranchInventory');
const ActivityLog = require('../models/ActivityLog');
const TaxRate = require('../models/TaxRate');
const InventoryMovement = require('../models/InventoryMovement');
const ApprovalRequest = require('../models/ApprovalRequest');
const { generateReceipt } = require('../utils/receiptGenerator');

const normalizeAddressValue = (value) =>
  (value || '').toString().trim().toLowerCase();

const isSameAddress = (a, b) => {
  const fields = [
    'fullName',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'country',
    'postalCode',
    'phone'
  ];

  return fields.every((field) =>
    normalizeAddressValue(a[field]) === normalizeAddressValue(b[field])
  );
};

// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
  try {
    const staffRoles = [
      'branch_manager',
      'accountant',
      'inventory_manager',
      'cashier',
      'staff'
    ];
    const filter = {};
    const onlineBranch = await Branch.findOne({ isOnline: true }).select("_id");

    if (req.query.branchId && ['super_admin', 'admin'].includes(req.user.role)) {
      filter.branch = req.query.branchId;
    } else if (staffRoles.includes(req.user.role) && req.user.branch) {
      if (onlineBranch?._id) {
        filter.$or = [
          { branch: req.user.branch },
          { branch: onlineBranch._id }
        ];
      } else {
        filter.branch = req.user.branch;
      }
    } else if (staffRoles.includes(req.user.role) && onlineBranch?._id) {
      filter.branch = onlineBranch._id;
    }

    // Fetch orders with user info
    const orders = await Order.find(filter)
      .populate('user', 'name email phone')
      .populate('branch', 'name isOnline');

    // No need to populate products.product — we rely on stored title & price snapshots
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Create order for a customer (admin)
// =========================
exports.createOrderForUser = async (req, res) => {
  try {
    const { customerId, products, shippingAddress, paymentMethod, branchId } = req.body;

    if (!customerId) {
      return res.status(400).json({ message: 'Customer is required' });
    }

    const customer = await User.findById(customerId);
    if (!customer || customer.role !== 'user') {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({ message: 'No products in order' });
    }

    const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
    const staffBranchId = req.user.branch;
    const resolvedBranchId = isAdmin ? branchId : staffBranchId;

    if (!resolvedBranchId) {
      return res.status(400).json({ message: 'Branch is required for this order' });
    }

    const branch = await Branch.findById(resolvedBranchId);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    if (branch.isOnline) {
      const requiredFields = [
        "fullName",
        "addressLine1",
        "city",
        "state",
        "country",
        "postalCode",
        "phone",
      ];
      const hasShipping = requiredFields.every(
        (field) => shippingAddress && shippingAddress[field]
      );
      if (!hasShipping) {
        return res.status(400).json({ message: "Shipping address is required" });
      }
    }

    let totalPrice = 0;
    const orderProducts = [];
    let subtotal = 0;
    let taxAmount = 0;
    let defaultTaxRate = await TaxRate.findOne({ isDefault: true }).sort({ effectiveFrom: -1 });
    if (!defaultTaxRate) {
      defaultTaxRate = await TaxRate.findOne({ effectiveFrom: { $lte: new Date() } }).sort({
        effectiveFrom: -1,
      });
    }
    const defaultRateValue = defaultTaxRate?.rate || 0;
    const taxRateCache = new Map();

    for (const item of products) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }

      const quantity = Number(item.quantity) || 1;
      const lineTotal = product.price * quantity;
      orderProducts.push({
        product: product._id,
        title: product.title,
        price: product.price,
        quantity
      });

      subtotal += lineTotal;
      if (product.taxCategory === "standard") {
        let rateValue = defaultRateValue;
        if (product.taxRate) {
          const key = product.taxRate.toString();
          if (taxRateCache.has(key)) {
            rateValue = taxRateCache.get(key);
          } else {
            const rateDoc = await TaxRate.findById(product.taxRate);
            rateValue = rateDoc?.rate || defaultRateValue;
            taxRateCache.set(key, rateValue);
          }
        }
        taxAmount += (lineTotal * rateValue) / 100;
      }
    }

    totalPrice = subtotal + taxAmount;
    let inventoryChecks = [];
    if (!branch.isOnline) {
      inventoryChecks = await Promise.all(
        orderProducts.map(async (item) => {
          const inventory = await BranchInventory.findOne({
            branch: resolvedBranchId,
            product: item.product
          });
          return { item, inventory };
        })
      );

      const outOfStock = inventoryChecks.find(
        ({ item, inventory }) => !inventory || inventory.quantity < item.quantity
      );

      if (outOfStock) {
        return res.status(400).json({
          message: `Insufficient stock for ${outOfStock.item.title}`
        });
      }
    }

    const order = await Order.create({
      user: customer._id,
      branch: resolvedBranchId,
      originBranch: resolvedBranchId,
      products: orderProducts,
      shippingAddress,
      paymentMethod: paymentMethod || 'Cash on Delivery',
      subtotal,
      taxAmount,
      discountAmount: 0,
      totalPrice,
      createdBy: req.user.id
    });

    if (!branch.isOnline) {
      await Promise.all(
        inventoryChecks.map(({ item, inventory }) =>
          BranchInventory.updateOne(
            { _id: inventory._id },
            { $inc: { quantity: -item.quantity } }
          )
        )
      );

      await Promise.all(
        orderProducts.map((item) =>
          InventoryMovement.create({
            branch: resolvedBranchId,
            product: item.product,
            type: "sale",
            quantityChange: -item.quantity,
            reason: "sale",
            referenceType: "order",
            referenceId: order._id,
            createdBy: req.user.id,
          })
        )
      );
    }

    ActivityLog.create({
      user: req.user.id,
      action: "sale_created",
      entityType: "order",
      entityId: order._id,
      branch: resolvedBranchId,
      message: "Created a sale order"
    }).catch(() => null);

    if (shippingAddress) {
      const hasAddress = customer.shippingAddresses?.some((address) =>
        isSameAddress(address, shippingAddress)
      );
      if (!hasAddress) {
        customer.shippingAddresses.push(shippingAddress);
        await customer.save();
      }
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('user', 'name email phone')
      .populate('branch', 'name isOnline');
    res.status(201).json(populatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Update order status (admin)
// =========================
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, orderStatus } = req.body;
    const nextStatus = status || orderStatus;

    const order = await Order.findById(req.params.id).populate('user', 'name email');

    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (!nextStatus) {
      return res.status(400).json({ message: 'Status is required' });
    }

    if (nextStatus === "Returned" && !["super_admin", "admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Not allowed to return orders" });
    }

    order.orderStatus = nextStatus; // "Processing", "Shipped", "Delivered", "Cancelled"
    await order.save({ validateBeforeSave: false });

    ActivityLog.create({
      user: req.user.id,
      action: "order_status_update",
      entityType: "order",
      entityId: order._id,
      branch: order.branch || null,
      message: `Order status updated to ${nextStatus}`
    }).catch(() => null);

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Claim online order for a branch
// =========================
exports.claimOnlineOrder = async (req, res) => {
  try {
    const { branchId } = req.body;
    const order = await Order.findById(req.params.id)
      .populate('branch', 'name isOnline');

    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.branch || !order.branch.isOnline) {
      return res.status(400).json({ message: 'Only online orders can be claimed' });
    }

    const isAdmin = ['super_admin', 'admin'].includes(req.user.role);
    const targetBranchId = isAdmin ? branchId : req.user.branch;

    if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch is required to claim order' });
    }

    const branch = await Branch.findById(targetBranchId);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    const inventoryChecks = await Promise.all(
      order.products.map(async (item) => {
        const inventory = await BranchInventory.findOne({
          branch: targetBranchId,
          product: item.product
        });
        return { item, inventory };
      })
    );

    const outOfStock = inventoryChecks.find(
      ({ item, inventory }) => !inventory || inventory.quantity < item.quantity
    );

    if (outOfStock) {
      return res.status(400).json({
        message: `Insufficient stock for ${outOfStock.item.title}`
      });
    }

    await Promise.all(
      inventoryChecks.map(({ item, inventory }) =>
        BranchInventory.updateOne(
          { _id: inventory._id },
          { $inc: { quantity: -item.quantity } }
        )
      )
    );

    order.branch = targetBranchId;
    await order.save({ validateBeforeSave: false });

    ActivityLog.create({
      user: req.user.id,
      action: "order_claimed",
      entityType: "order",
      entityId: order._id,
      branch: targetBranchId,
      message: "Claimed online order"
    }).catch(() => null);

    const populatedOrder = await Order.findById(order._id)
      .populate('user', 'name email phone')
      .populate('branch', 'name isOnline');

    res.json(populatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// =========================
// Return order (admin)
// =========================
exports.returnOrder = async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id)
      .populate("branch", "name isOnline");

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.orderStatus === "Returned") {
      return res.status(400).json({ message: "Order already returned" });
    }
    if (!reason) {
      return res.status(400).json({ message: "Return reason is required" });
    }

    const approvalThreshold = Number(process.env.REFUND_APPROVAL_THRESHOLD || 0);
    if (approvalThreshold > 0 && order.totalPrice >= approvalThreshold) {
      const approval = await ApprovalRequest.create({
        type: "refund",
        branch: order.branch?._id || null,
        requestedBy: req.user.id,
        reason,
        payload: { orderId: order._id },
      });
      order.orderStatus = "ReturnRequested";
      order.returnReason = reason;
      order.returnRequestedBy = req.user.id;
      await order.save({ validateBeforeSave: false });

      ActivityLog.create({
        user: req.user.id,
        action: "refund_requested",
        entityType: "order",
        entityId: order._id,
        branch: order.branch?._id || null,
        message: "Refund requires approval",
        meta: { approvalId: approval._id }
      }).catch(() => null);

      return res.status(202).json({ message: "Refund approval required", approvalId: approval._id });
    }

    if (order.branch && !order.branch.isOnline) {
      await Promise.all(
        order.products.map((item) =>
          BranchInventory.findOneAndUpdate(
            { branch: order.branch._id, product: item.product },
            { $inc: { quantity: item.quantity } },
            { upsert: true, new: true }
          )
        )
      );

      await Promise.all(
        order.products.map((item) =>
          InventoryMovement.create({
            branch: order.branch._id,
            product: item.product,
            type: "return",
            quantityChange: item.quantity,
            reason,
            referenceType: "order",
            referenceId: order._id,
            createdBy: req.user.id,
          })
        )
      );
    }

    order.orderStatus = "Returned";
    order.returnReason = reason;
    order.returnRequestedBy = req.user.id;
    order.returnApprovedBy = req.user.id;
    await order.save();

    ActivityLog.create({
      user: req.user.id,
      action: "order_returned",
      entityType: "order",
      entityId: order._id,
      branch: order.branch?._id || null,
      message: "Order returned"
    }).catch(() => null);

    const populatedOrder = await Order.findById(order._id)
      .populate("user", "name email phone")
      .populate("branch", "name isOnline");

    res.json(populatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Get receipt (admin/staff)
// =========================
exports.getReceipt = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("branch", "name isOnline");

    if (!order) return res.status(404).json({ message: "Order not found" });

    const staffRoles = [
      "branch_manager",
      "accountant",
      "inventory_manager",
      "cashier",
      "staff",
    ];

    if (staffRoles.includes(req.user.role)) {
      const staffBranch = req.user.branch?.toString();
      const orderBranch = order.branch?._id?.toString();
      if (staffBranch && orderBranch && staffBranch !== orderBranch) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    await generateReceipt({
      res,
      order,
      issuerName: req.user?.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
