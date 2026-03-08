"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const mongodb_1 = require("mongodb");
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const main = async () => {
    const mongoUri = process.env.MONGO_URI;
    const databaseUrl = process.env.DATABASE_URL;
    if (!mongoUri)
        throw new Error("MONGO_URI is required");
    if (!databaseUrl)
        throw new Error("DATABASE_URL is required");
    const mongo = new mongodb_1.MongoClient(mongoUri);
    const prisma = new client_1.PrismaClient({
        adapter: new adapter_pg_1.PrismaPg({ connectionString: databaseUrl }),
    });
    try {
        await mongo.connect();
        await prisma.$connect();
        const db = mongo.db();
        const [branchesCount, usersCount, taxRatesCount, productsCount, ordersCount, branchInventoryCount, inventoryMovementsCount, activityLogsCount, approvalsCount, suppliersCount, supplierInvoicesCount, usersRaw, ordersRaw, supplierInvoicesRaw,] = await Promise.all([
            db.collection("branches").countDocuments(),
            db.collection("users").countDocuments(),
            db.collection("taxrates").countDocuments(),
            db.collection("products").countDocuments(),
            db.collection("orders").countDocuments(),
            db.collection("branchinventories").countDocuments(),
            db.collection("inventorymovements").countDocuments(),
            db.collection("activitylogs").countDocuments(),
            db.collection("approvalrequests").countDocuments(),
            db.collection("suppliers").countDocuments(),
            db.collection("supplierinvoices").countDocuments(),
            db.collection("users").find({}, { projection: { shippingAddresses: 1, wishlist: 1, cart: 1 } }).toArray(),
            db.collection("orders").find({}, { projection: { products: 1 } }).toArray(),
            db
                .collection("supplierinvoices")
                .find({}, { projection: { items: 1, payments: 1, attachments: 1 } })
                .toArray(),
        ]);
        const mongoShippingAddresses = usersRaw.reduce((sum, user) => sum + (Array.isArray(user.shippingAddresses) ? user.shippingAddresses.length : 0), 0);
        const mongoWishlistItems = usersRaw.reduce((sum, user) => sum + (Array.isArray(user.wishlist) ? user.wishlist.length : 0), 0);
        const mongoCartItems = usersRaw.reduce((sum, user) => sum + (Array.isArray(user.cart) ? user.cart.length : 0), 0);
        const mongoOrderItems = ordersRaw.reduce((sum, order) => sum + (Array.isArray(order.products) ? order.products.length : 0), 0);
        const mongoSupplierInvoiceItems = supplierInvoicesRaw.reduce((sum, invoice) => sum + (Array.isArray(invoice.items) ? invoice.items.length : 0), 0);
        const mongoSupplierInvoicePayments = supplierInvoicesRaw.reduce((sum, invoice) => sum + (Array.isArray(invoice.payments) ? invoice.payments.length : 0), 0);
        const mongoSupplierInvoiceAttachments = supplierInvoicesRaw.reduce((sum, invoice) => sum + (Array.isArray(invoice.attachments) ? invoice.attachments.length : 0), 0);
        const [pgBranches, pgUsers, pgTaxRates, pgProducts, pgOrders, pgBranchInventory, pgInventoryMovements, pgActivityLogs, pgApprovals, pgSuppliers, pgSupplierInvoices, pgShippingAddresses, pgWishlistItems, pgCartItems, pgOrderItems, pgSupplierInvoiceItems, pgSupplierInvoicePayments, pgSupplierInvoiceAttachments,] = await Promise.all([
            prisma.branch.count(),
            prisma.user.count(),
            prisma.taxRate.count(),
            prisma.product.count(),
            prisma.order.count(),
            prisma.branchInventory.count(),
            prisma.inventoryMovement.count(),
            prisma.activityLog.count(),
            prisma.approvalRequest.count(),
            prisma.supplier.count(),
            prisma.supplierInvoice.count(),
            prisma.shippingAddress.count(),
            prisma.userWishlistItem.count(),
            prisma.userCartItem.count(),
            prisma.orderItem.count(),
            prisma.supplierInvoiceItem.count(),
            prisma.supplierInvoicePayment.count(),
            prisma.supplierInvoiceAttachment.count(),
        ]);
        const rows = [
            { key: "branches", mongo: branchesCount, postgres: pgBranches },
            { key: "users", mongo: usersCount, postgres: pgUsers },
            { key: "tax rates", mongo: taxRatesCount, postgres: pgTaxRates },
            { key: "products", mongo: productsCount, postgres: pgProducts },
            { key: "orders", mongo: ordersCount, postgres: pgOrders },
            { key: "order items", mongo: mongoOrderItems, postgres: pgOrderItems },
            { key: "branch inventory", mongo: branchInventoryCount, postgres: pgBranchInventory },
            { key: "inventory movements", mongo: inventoryMovementsCount, postgres: pgInventoryMovements },
            { key: "activity logs", mongo: activityLogsCount, postgres: pgActivityLogs },
            { key: "approvals", mongo: approvalsCount, postgres: pgApprovals },
            { key: "suppliers", mongo: suppliersCount, postgres: pgSuppliers },
            { key: "supplier invoices", mongo: supplierInvoicesCount, postgres: pgSupplierInvoices },
            { key: "supplier invoice items", mongo: mongoSupplierInvoiceItems, postgres: pgSupplierInvoiceItems },
            {
                key: "supplier invoice payments",
                mongo: mongoSupplierInvoicePayments,
                postgres: pgSupplierInvoicePayments,
            },
            {
                key: "supplier invoice attachments",
                mongo: mongoSupplierInvoiceAttachments,
                postgres: pgSupplierInvoiceAttachments,
            },
            { key: "shipping addresses", mongo: mongoShippingAddresses, postgres: pgShippingAddresses },
            { key: "wishlist items", mongo: mongoWishlistItems, postgres: pgWishlistItems },
            { key: "cart items", mongo: mongoCartItems, postgres: pgCartItems },
        ];
        let failed = false;
        console.log("parity report");
        for (const row of rows) {
            const status = row.mongo === row.postgres ? "ok" : "mismatch";
            if (status === "mismatch")
                failed = true;
            console.log(`${status.padEnd(9)} ${row.key.padEnd(28)} mongo=${String(row.mongo).padEnd(8)} postgres=${row.postgres}`);
        }
        if (failed) {
            process.exitCode = 1;
            console.error("parity check failed");
        }
        else {
            console.log("parity check passed");
        }
    }
    finally {
        await mongo.close();
        await prisma.$disconnect();
    }
};
main().catch((error) => {
    console.error("validation failed", error);
    process.exit(1);
});
