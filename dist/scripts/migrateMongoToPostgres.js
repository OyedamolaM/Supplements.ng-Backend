"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongodb_1 = require("mongodb");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const now = () => new Date();
const toId = (value) => {
    if (value === null || value === undefined)
        return null;
    return String(value);
};
const toDate = (value, fallback) => {
    if (!value)
        return fallback || now();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return fallback || now();
    return parsed;
};
const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toInt = (value, fallback = 0) => {
    const parsed = parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const toStringArray = (value) => {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => (entry === null || entry === undefined ? "" : String(entry)))
        .filter((entry) => entry.length > 0);
};
const normalizeUserRole = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    const mapped = {
        customer: client_1.UserRole.CUSTOMER,
        super_admin: client_1.UserRole.SUPER_ADMIN,
        admin: client_1.UserRole.ADMIN,
        branch_manager: client_1.UserRole.BRANCH_MANAGER,
        accountant: client_1.UserRole.ACCOUNTANT,
        inventory_manager: client_1.UserRole.INVENTORY_MANAGER,
        cashier: client_1.UserRole.CASHIER,
        staff: client_1.UserRole.STAFF,
    };
    return mapped[key] || client_1.UserRole.CUSTOMER;
};
const normalizeTaxCategory = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    if (key === "exempt")
        return client_1.TaxCategory.EXEMPT;
    if (key === "zero")
        return client_1.TaxCategory.ZERO;
    return client_1.TaxCategory.STANDARD;
};
const normalizePaymentStatus = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    return key === "paid" ? client_1.PaymentStatus.PAID : client_1.PaymentStatus.PENDING;
};
const normalizeOrderStatus = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    const mapped = {
        processing: client_1.OrderStatus.PROCESSING,
        shipped: client_1.OrderStatus.SHIPPED,
        delivered: client_1.OrderStatus.DELIVERED,
        cancelled: client_1.OrderStatus.CANCELLED,
        returnrequested: client_1.OrderStatus.RETURN_REQUESTED,
        returned: client_1.OrderStatus.RETURNED,
    };
    return mapped[key] || client_1.OrderStatus.PROCESSING;
};
const normalizeInventoryMovementType = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    const mapped = {
        receipt: client_1.InventoryMovementType.RECEIPT,
        sale: client_1.InventoryMovementType.SALE,
        return: client_1.InventoryMovementType.RETURN,
        adjustment: client_1.InventoryMovementType.ADJUSTMENT,
    };
    return mapped[key] || client_1.InventoryMovementType.ADJUSTMENT;
};
const normalizeApprovalType = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    if (key === "refund")
        return client_1.ApprovalType.REFUND;
    return client_1.ApprovalType.INVENTORY_ADJUSTMENT;
};
const normalizeApprovalStatus = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    if (key === "approved")
        return client_1.ApprovalStatus.APPROVED;
    if (key === "rejected")
        return client_1.ApprovalStatus.REJECTED;
    return client_1.ApprovalStatus.PENDING;
};
const normalizeSupplierInvoiceStatus = (value) => {
    const key = String(value || "")
        .trim()
        .toLowerCase();
    const mapped = {
        unpaid: client_1.SupplierInvoiceStatus.UNPAID,
        partial: client_1.SupplierInvoiceStatus.PARTIAL,
        paid: client_1.SupplierInvoiceStatus.PAID,
        overdue: client_1.SupplierInvoiceStatus.OVERDUE,
    };
    return mapped[key] || client_1.SupplierInvoiceStatus.UNPAID;
};
const main = async () => {
    const args = new Set(process.argv.slice(2));
    const shouldReset = args.has("--reset");
    const dryRun = args.has("--dry-run");
    const mongoUri = process.env.MONGO_URI;
    const databaseUrl = process.env.DATABASE_URL;
    if (!mongoUri) {
        throw new Error("MONGO_URI is required");
    }
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required");
    }
    const adapter = new adapter_pg_1.PrismaPg({ connectionString: databaseUrl });
    const prisma = new client_1.PrismaClient({ adapter });
    const mongo = new mongodb_1.MongoClient(mongoUri);
    try {
        await mongo.connect();
        await prisma.$connect();
        const db = mongo.db();
        console.log("connected", {
            mongoDb: db.databaseName,
            reset: shouldReset,
            dryRun,
        });
        if (shouldReset && !dryRun) {
            console.log("resetting postgres tables");
            await prisma.$transaction([
                prisma.supplierInvoiceAttachment.deleteMany(),
                prisma.supplierInvoicePayment.deleteMany(),
                prisma.supplierInvoiceItem.deleteMany(),
                prisma.supplierInvoice.deleteMany(),
                prisma.orderItem.deleteMany(),
                prisma.userCartItem.deleteMany(),
                prisma.userWishlistItem.deleteMany(),
                prisma.shippingAddress.deleteMany(),
                prisma.activityLog.deleteMany(),
                prisma.approvalRequest.deleteMany(),
                prisma.inventoryMovement.deleteMany(),
                prisma.branchInventory.deleteMany(),
                prisma.supplier.deleteMany(),
                prisma.order.deleteMany(),
                prisma.product.deleteMany(),
                prisma.taxRate.deleteMany(),
                prisma.user.deleteMany(),
                prisma.branch.deleteMany(),
            ]);
        }
        const [branchesRaw, usersRaw, taxRatesRaw, productsRaw, ordersRaw, branchInventoryRaw, inventoryMovementRaw, activityLogRaw, approvalsRaw, suppliersRaw, supplierInvoicesRaw,] = await Promise.all([
            db.collection("branches").find({}).toArray(),
            db.collection("users").find({}).toArray(),
            db.collection("taxrates").find({}).toArray(),
            db.collection("products").find({}).toArray(),
            db.collection("orders").find({}).toArray(),
            db.collection("branchinventories").find({}).toArray(),
            db.collection("inventorymovements").find({}).toArray(),
            db.collection("activitylogs").find({}).toArray(),
            db.collection("approvalrequests").find({}).toArray(),
            db.collection("suppliers").find({}).toArray(),
            db.collection("supplierinvoices").find({}).toArray(),
        ]);
        const branchRows = branchesRaw.map((doc) => ({
            id: toId(doc._id),
            name: String(doc.name || ""),
            address: String(doc.address || ""),
            phone: String(doc.phone || ""),
            region: String(doc.region || ""),
            isOnline: Boolean(doc.isOnline),
            createdAt: toDate(doc.createdAt),
            updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
        }));
        const branchIds = new Set(branchRows.map((row) => row.id));
        const userRows = usersRaw.map((doc) => {
            const branchId = toId(doc.branch);
            return {
                id: toId(doc._id),
                name: String(doc.name || ""),
                phone: String(doc.phone || ""),
                email: String(doc.email || ""),
                password: String(doc.password || ""),
                role: normalizeUserRole(doc.role),
                branchId: branchId && branchIds.has(branchId) ? branchId : null,
                region: String(doc.region || ""),
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            };
        });
        const userIds = new Set(userRows.map((row) => row.id));
        const taxRateRows = taxRatesRaw.map((doc) => ({
            id: toId(doc._id),
            name: String(doc.name || ""),
            rate: toNumber(doc.rate),
            effectiveFrom: toDate(doc.effectiveFrom),
            isDefault: Boolean(doc.isDefault),
            createdAt: toDate(doc.createdAt),
            updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
        }));
        const taxRateIds = new Set(taxRateRows.map((row) => row.id));
        const productRows = productsRaw.map((doc) => {
            const taxRateId = toId(doc.taxRate);
            return {
                id: toId(doc._id),
                title: String(doc.title || ""),
                description: String(doc.description || ""),
                price: toNumber(doc.price),
                costPrice: toNumber(doc.costPrice),
                sellingPrice: toNumber(doc.sellingPrice, toNumber(doc.price)),
                expiryDate: doc.expiryDate ? toDate(doc.expiryDate) : null,
                stock: toInt(doc.stock),
                quantityAvailable: toInt(doc.quantityAvailable, toInt(doc.stock)),
                sku: String(doc.sku || ""),
                batchNumber: String(doc.batchNumber || ""),
                barcode: String(doc.barcode || ""),
                supplierName: String(doc.supplier || ""),
                reorderLevel: toInt(doc.reorderLevel),
                taxCategory: normalizeTaxCategory(doc.taxCategory),
                taxRateId: taxRateId && taxRateIds.has(taxRateId) ? taxRateId : null,
                dosageForm: String(doc.dosageForm || ""),
                strength: String(doc.strength || ""),
                packSize: String(doc.packSize || ""),
                manufacturer: String(doc.manufacturer || ""),
                images: toStringArray(doc.images),
                category: String(doc.category || "General"),
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            };
        });
        const productIds = new Set(productRows.map((row) => row.id));
        const orderRows = [];
        const orderItemRows = [];
        let skippedOrders = 0;
        let skippedOrderItems = 0;
        for (const doc of ordersRaw) {
            const id = toId(doc._id);
            const userId = toId(doc.user);
            if (!userId || !userIds.has(userId)) {
                skippedOrders += 1;
                continue;
            }
            const branchId = toId(doc.branch);
            const originBranchId = toId(doc.originBranch);
            const createdById = toId(doc.createdBy);
            const returnRequestedById = toId(doc.returnRequestedBy);
            const returnApprovedById = toId(doc.returnApprovedBy);
            const shippingAddress = doc.shippingAddress || {};
            orderRows.push({
                id,
                userId,
                branchId: branchId && branchIds.has(branchId) ? branchId : null,
                originBranchId: originBranchId && branchIds.has(originBranchId) ? originBranchId : null,
                paymentMethod: String(doc.paymentMethod || "Cash on Delivery"),
                paymentStatus: normalizePaymentStatus(doc.paymentStatus),
                orderStatus: normalizeOrderStatus(doc.orderStatus),
                subtotal: toNumber(doc.subtotal),
                taxAmount: toNumber(doc.taxAmount),
                discountAmount: toNumber(doc.discountAmount),
                totalPrice: toNumber(doc.totalPrice),
                createdById: createdById && userIds.has(createdById) ? createdById : null,
                returnReason: String(doc.returnReason || ""),
                returnRequestedById: returnRequestedById && userIds.has(returnRequestedById)
                    ? returnRequestedById
                    : null,
                returnApprovedById: returnApprovedById && userIds.has(returnApprovedById)
                    ? returnApprovedById
                    : null,
                shippingFullName: shippingAddress.fullName || null,
                shippingAddressLine1: shippingAddress.addressLine1 || null,
                shippingAddressLine2: shippingAddress.addressLine2 || null,
                shippingCity: shippingAddress.city || null,
                shippingState: shippingAddress.state || null,
                shippingCountry: shippingAddress.country || null,
                shippingPostalCode: shippingAddress.postalCode || null,
                shippingPhone: shippingAddress.phone || null,
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
            const items = Array.isArray(doc.products) ? doc.products : [];
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                const productId = toId(item.product);
                if (!productId || !productIds.has(productId)) {
                    skippedOrderItems += 1;
                    continue;
                }
                const itemId = toId(item._id) || `${id}_item_${index + 1}`;
                orderItemRows.push({
                    id: itemId,
                    orderId: id,
                    productId,
                    title: String(item.title || ""),
                    quantity: toInt(item.quantity, 1),
                    price: toNumber(item.price),
                });
            }
        }
        const orderIds = new Set(orderRows.map((row) => row.id));
        const branchInventoryRows = [];
        let skippedBranchInventory = 0;
        for (const doc of branchInventoryRaw) {
            const id = toId(doc._id);
            const branchId = toId(doc.branch);
            const productId = toId(doc.product);
            if (!branchId || !productId || !branchIds.has(branchId) || !productIds.has(productId)) {
                skippedBranchInventory += 1;
                continue;
            }
            branchInventoryRows.push({
                id,
                branchId,
                productId,
                quantity: toInt(doc.quantity),
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
        }
        const inventoryMovementRows = [];
        let skippedInventoryMovements = 0;
        for (const doc of inventoryMovementRaw) {
            const id = toId(doc._id);
            const branchId = toId(doc.branch);
            const productId = toId(doc.product);
            const createdById = toId(doc.createdBy);
            if (!branchId || !productId || !branchIds.has(branchId) || !productIds.has(productId)) {
                skippedInventoryMovements += 1;
                continue;
            }
            inventoryMovementRows.push({
                id,
                branchId,
                productId,
                type: normalizeInventoryMovementType(doc.type),
                quantityChange: toInt(doc.quantityChange),
                reason: String(doc.reason || ""),
                referenceType: String(doc.referenceType || ""),
                referenceId: toId(doc.referenceId),
                createdById: createdById && userIds.has(createdById) ? createdById : null,
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
        }
        const activityLogRows = [];
        let skippedActivityLogs = 0;
        for (const doc of activityLogRaw) {
            const id = toId(doc._id);
            const userId = toId(doc.user);
            const branchId = toId(doc.branch);
            if (!userId || !userIds.has(userId)) {
                skippedActivityLogs += 1;
                continue;
            }
            activityLogRows.push({
                id,
                userId,
                action: String(doc.action || ""),
                entityType: String(doc.entityType || ""),
                entityId: toId(doc.entityId),
                branchId: branchId && branchIds.has(branchId) ? branchId : null,
                message: String(doc.message || ""),
                meta: doc.meta || {},
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
        }
        const approvalRows = [];
        let skippedApprovals = 0;
        for (const doc of approvalsRaw) {
            const id = toId(doc._id);
            const requestedById = toId(doc.requestedBy);
            const approvedById = toId(doc.approvedBy);
            const branchId = toId(doc.branch);
            if (!requestedById || !userIds.has(requestedById)) {
                skippedApprovals += 1;
                continue;
            }
            approvalRows.push({
                id,
                type: normalizeApprovalType(doc.type),
                status: normalizeApprovalStatus(doc.status),
                branchId: branchId && branchIds.has(branchId) ? branchId : null,
                requestedById,
                approvedById: approvedById && userIds.has(approvedById) ? approvedById : null,
                reason: String(doc.reason || ""),
                payload: doc.payload || {},
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
        }
        const supplierRows = suppliersRaw.map((doc) => {
            const id = toId(doc._id);
            const branchId = toId(doc.branch);
            const createdById = toId(doc.createdBy);
            return {
                id,
                name: String(doc.name || ""),
                contactName: String(doc.contactName || ""),
                phone: String(doc.phone || ""),
                email: String(doc.email || ""),
                address: String(doc.address || ""),
                paymentTerms: String(doc.paymentTerms || ""),
                bankName: String(doc.bankName || ""),
                accountName: String(doc.accountName || ""),
                accountNumber: String(doc.accountNumber || ""),
                notes: String(doc.notes || ""),
                balance: toNumber(doc.balance),
                branchId: branchId && branchIds.has(branchId) ? branchId : null,
                createdById: createdById && userIds.has(createdById) ? createdById : null,
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            };
        });
        const supplierIds = new Set(supplierRows.map((row) => row.id));
        const supplierInvoiceRows = [];
        const supplierInvoiceItemRows = [];
        const supplierInvoicePaymentRows = [];
        const supplierInvoiceAttachmentRows = [];
        let skippedSupplierInvoices = 0;
        let skippedSupplierInvoiceItems = 0;
        for (const doc of supplierInvoicesRaw) {
            const id = toId(doc._id);
            const supplierId = toId(doc.supplier);
            const branchId = toId(doc.branch);
            const createdById = toId(doc.createdBy);
            if (!supplierId ||
                !branchId ||
                !supplierIds.has(supplierId) ||
                !branchIds.has(branchId)) {
                skippedSupplierInvoices += 1;
                continue;
            }
            supplierInvoiceRows.push({
                id,
                supplierId,
                branchId,
                invoiceNumber: String(doc.invoiceNumber || ""),
                reference: String(doc.reference || ""),
                dateSupplied: toDate(doc.dateSupplied),
                dueDate: doc.dueDate ? toDate(doc.dueDate) : null,
                subtotal: toNumber(doc.subtotal),
                tax: toNumber(doc.tax),
                total: toNumber(doc.total),
                amountPaid: toNumber(doc.amountPaid),
                balance: toNumber(doc.balance),
                status: normalizeSupplierInvoiceStatus(doc.status),
                notes: String(doc.notes || ""),
                createdById: createdById && userIds.has(createdById) ? createdById : null,
                createdAt: toDate(doc.createdAt),
                updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
            });
            const items = Array.isArray(doc.items) ? doc.items : [];
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                const productId = toId(item.product);
                if (!productId || !productIds.has(productId)) {
                    skippedSupplierInvoiceItems += 1;
                    continue;
                }
                supplierInvoiceItemRows.push({
                    id: toId(item._id) || `${id}_supplier_item_${index + 1}`,
                    invoiceId: id,
                    productId,
                    description: String(item.description || ""),
                    quantity: toInt(item.quantity),
                    unitCost: toNumber(item.unitCost),
                    total: toNumber(item.total),
                });
            }
            const payments = Array.isArray(doc.payments) ? doc.payments : [];
            for (let index = 0; index < payments.length; index += 1) {
                const payment = payments[index];
                supplierInvoicePaymentRows.push({
                    id: toId(payment._id) || `${id}_payment_${index + 1}`,
                    invoiceId: id,
                    amount: toNumber(payment.amount),
                    method: String(payment.method || ""),
                    reference: String(payment.reference || ""),
                    note: String(payment.note || ""),
                    date: toDate(payment.date),
                });
            }
            const attachments = Array.isArray(doc.attachments) ? doc.attachments : [];
            for (let index = 0; index < attachments.length; index += 1) {
                const attachment = attachments[index];
                if (!attachment?.url)
                    continue;
                supplierInvoiceAttachmentRows.push({
                    id: toId(attachment._id) || `${id}_attachment_${index + 1}`,
                    invoiceId: id,
                    url: String(attachment.url),
                    publicId: String(attachment.publicId || ""),
                    fileName: String(attachment.fileName || ""),
                    mimeType: String(attachment.mimeType || ""),
                });
            }
        }
        const shippingAddressRows = [];
        const wishlistRows = [];
        const cartRows = [];
        for (const doc of usersRaw) {
            const userId = toId(doc._id);
            if (!userIds.has(userId))
                continue;
            const addresses = Array.isArray(doc.shippingAddresses)
                ? doc.shippingAddresses
                : [];
            for (let index = 0; index < addresses.length; index += 1) {
                const address = addresses[index];
                shippingAddressRows.push({
                    id: toId(address?._id) || `${userId}_address_${index + 1}`,
                    userId,
                    fullName: String(address?.fullName || ""),
                    addressLine1: String(address?.addressLine1 || ""),
                    addressLine2: String(address?.addressLine2 || ""),
                    city: String(address?.city || ""),
                    state: String(address?.state || ""),
                    country: String(address?.country || ""),
                    postalCode: String(address?.postalCode || ""),
                    phone: String(address?.phone || ""),
                    sortOrder: index,
                    createdAt: toDate(address?.createdAt, toDate(doc.createdAt)),
                });
            }
            const wishlist = Array.isArray(doc.wishlist) ? doc.wishlist : [];
            for (const value of wishlist) {
                const productId = toId(value);
                if (!productId || !productIds.has(productId))
                    continue;
                wishlistRows.push({
                    id: `${userId}_wishlist_${productId}`,
                    userId,
                    productId,
                    createdAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
                });
            }
            const cart = Array.isArray(doc.cart) ? doc.cart : [];
            for (let index = 0; index < cart.length; index += 1) {
                const item = cart[index];
                const productId = toId(item?.product);
                if (!productId || !productIds.has(productId))
                    continue;
                cartRows.push({
                    id: toId(item?._id) || `${userId}_cart_${productId}_${index + 1}`,
                    userId,
                    productId,
                    quantity: toInt(item?.quantity, 1),
                    price: toNumber(item?.price),
                    createdAt: toDate(item?.createdAt, toDate(doc.createdAt)),
                    updatedAt: toDate(item?.updatedAt, toDate(doc.updatedAt, toDate(doc.createdAt))),
                });
            }
        }
        const tableSummary = {
            branch: branchRows.length,
            user: userRows.length,
            taxRate: taxRateRows.length,
            product: productRows.length,
            order: orderRows.length,
            orderItem: orderItemRows.length,
            branchInventory: branchInventoryRows.length,
            inventoryMovement: inventoryMovementRows.length,
            activityLog: activityLogRows.length,
            approvalRequest: approvalRows.length,
            supplier: supplierRows.length,
            supplierInvoice: supplierInvoiceRows.length,
            supplierInvoiceItem: supplierInvoiceItemRows.length,
            supplierInvoicePayment: supplierInvoicePaymentRows.length,
            supplierInvoiceAttachment: supplierInvoiceAttachmentRows.length,
            shippingAddress: shippingAddressRows.length,
            userWishlistItem: wishlistRows.length,
            userCartItem: cartRows.length,
        };
        const skippedSummary = {
            skippedOrders,
            skippedOrderItems,
            skippedBranchInventory,
            skippedInventoryMovements,
            skippedActivityLogs,
            skippedApprovals,
            skippedSupplierInvoices,
            skippedSupplierInvoiceItems,
        };
        console.log("prepared rows", tableSummary);
        console.log("skipped rows", skippedSummary);
        if (!dryRun) {
            await prisma.$transaction([
                prisma.branch.createMany({ data: branchRows, skipDuplicates: true }),
                prisma.user.createMany({ data: userRows, skipDuplicates: true }),
                prisma.taxRate.createMany({ data: taxRateRows, skipDuplicates: true }),
                prisma.product.createMany({ data: productRows, skipDuplicates: true }),
                prisma.order.createMany({ data: orderRows, skipDuplicates: true }),
                prisma.orderItem.createMany({ data: orderItemRows, skipDuplicates: true }),
                prisma.branchInventory.createMany({
                    data: branchInventoryRows,
                    skipDuplicates: true,
                }),
                prisma.inventoryMovement.createMany({
                    data: inventoryMovementRows,
                    skipDuplicates: true,
                }),
                prisma.activityLog.createMany({ data: activityLogRows, skipDuplicates: true }),
                prisma.approvalRequest.createMany({
                    data: approvalRows,
                    skipDuplicates: true,
                }),
                prisma.supplier.createMany({ data: supplierRows, skipDuplicates: true }),
                prisma.supplierInvoice.createMany({
                    data: supplierInvoiceRows,
                    skipDuplicates: true,
                }),
                prisma.supplierInvoiceItem.createMany({
                    data: supplierInvoiceItemRows,
                    skipDuplicates: true,
                }),
                prisma.supplierInvoicePayment.createMany({
                    data: supplierInvoicePaymentRows,
                    skipDuplicates: true,
                }),
                prisma.supplierInvoiceAttachment.createMany({
                    data: supplierInvoiceAttachmentRows,
                    skipDuplicates: true,
                }),
                prisma.shippingAddress.createMany({
                    data: shippingAddressRows,
                    skipDuplicates: true,
                }),
                prisma.userWishlistItem.createMany({
                    data: wishlistRows,
                    skipDuplicates: true,
                }),
                prisma.userCartItem.createMany({ data: cartRows, skipDuplicates: true }),
            ]);
            console.log("migration complete");
        }
        else {
            console.log("dry run complete no writes");
        }
    }
    finally {
        await mongo.close();
        await prisma.$disconnect();
    }
};
main().catch((error) => {
    console.error("migration failed", error);
    process.exit(1);
});
