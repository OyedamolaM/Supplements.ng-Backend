"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { protect, requireRole } = require('../middleware/authMiddleware');
const { getAllOrders, updateOrderStatus, updateOrderItemDosage, createOrderForUser, claimOnlineOrder, returnOrder, getReceipt, dispatchFezOrder } = require('../controllers/adminOrderController');
const orderReadRoles = [
    'super_admin',
    'admin',
    'branch_manager',
    'accountant',
    'inventory_manager',
    'cashier',
    'staff'
];
const orderManageRoles = ['super_admin', 'admin', 'branch_manager', 'cashier'];
const orderDosageRoles = ['super_admin', 'admin', 'branch_manager', 'staff'];
// Get all orders (admin/staff)
router.get('/', protect, requireRole(orderReadRoles), getAllOrders);
// Create order for a customer (admin/staff)
router.post('/', protect, requireRole(orderManageRoles), createOrderForUser);
// Update order status (admin/staff)
router.put('/:id', protect, requireRole(orderManageRoles), updateOrderStatus);
// Update dosage for an order item (admin/staff)
router.put('/:id/items/:itemId/dosage', protect, requireRole(orderDosageRoles), updateOrderItemDosage);
// Claim online order for branch
router.post('/:id/claim', protect, requireRole(orderManageRoles), claimOnlineOrder);
// Dispatch order to Fez
router.post('/:id/dispatch', protect, requireRole(orderManageRoles), dispatchFezOrder);
// Return order (admin/super admin)
router.post('/:id/return', protect, requireRole(['super_admin', 'admin']), returnOrder);
// Get receipt (admin/staff)
router.get('/:id/receipt', protect, requireRole(orderReadRoles), getReceipt);
module.exports = router;
