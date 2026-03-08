import "dotenv/config";
import { MongoClient } from "mongodb";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ApprovalStatus,
  ApprovalType,
  InventoryMovementType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  SupplierInvoiceStatus,
  TaxCategory,
  UserRole,
} from "@prisma/client";

type AnyDoc = Record<string, any>;

const now = () => new Date();

const toId = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  return String(value);
};

const toDate = (value: any, fallback?: Date): Date => {
  if (!value) return fallback || now();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback || now();
  return parsed;
};

const toNumber = (value: any, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toInt = (value: any, fallback = 0): number => {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toStringArray = (value: any): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry === null || entry === undefined ? "" : String(entry)))
    .filter((entry) => entry.length > 0);
};

const normalizeUserRole = (value: any): UserRole => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  const mapped: Record<string, UserRole> = {
    customer: UserRole.CUSTOMER,
    super_admin: UserRole.SUPER_ADMIN,
    admin: UserRole.ADMIN,
    branch_manager: UserRole.BRANCH_MANAGER,
    accountant: UserRole.ACCOUNTANT,
    inventory_manager: UserRole.INVENTORY_MANAGER,
    cashier: UserRole.CASHIER,
    staff: UserRole.STAFF,
  };
  return mapped[key] || UserRole.CUSTOMER;
};

const normalizeTaxCategory = (value: any): TaxCategory => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "exempt") return TaxCategory.EXEMPT;
  if (key === "zero") return TaxCategory.ZERO;
  return TaxCategory.STANDARD;
};

const normalizePaymentStatus = (value: any): PaymentStatus => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return key === "paid" ? PaymentStatus.PAID : PaymentStatus.PENDING;
};

const normalizeOrderStatus = (value: any): OrderStatus => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  const mapped: Record<string, OrderStatus> = {
    processing: OrderStatus.PROCESSING,
    shipped: OrderStatus.SHIPPED,
    delivered: OrderStatus.DELIVERED,
    cancelled: OrderStatus.CANCELLED,
    returnrequested: OrderStatus.RETURN_REQUESTED,
    returned: OrderStatus.RETURNED,
  };
  return mapped[key] || OrderStatus.PROCESSING;
};

const normalizeInventoryMovementType = (value: any): InventoryMovementType => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  const mapped: Record<string, InventoryMovementType> = {
    receipt: InventoryMovementType.RECEIPT,
    sale: InventoryMovementType.SALE,
    return: InventoryMovementType.RETURN,
    adjustment: InventoryMovementType.ADJUSTMENT,
  };
  return mapped[key] || InventoryMovementType.ADJUSTMENT;
};

const normalizeApprovalType = (value: any): ApprovalType => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "refund") return ApprovalType.REFUND;
  return ApprovalType.INVENTORY_ADJUSTMENT;
};

const normalizeApprovalStatus = (value: any): ApprovalStatus => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "approved") return ApprovalStatus.APPROVED;
  if (key === "rejected") return ApprovalStatus.REJECTED;
  return ApprovalStatus.PENDING;
};

const normalizeSupplierInvoiceStatus = (value: any): SupplierInvoiceStatus => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  const mapped: Record<string, SupplierInvoiceStatus> = {
    unpaid: SupplierInvoiceStatus.UNPAID,
    partial: SupplierInvoiceStatus.PARTIAL,
    paid: SupplierInvoiceStatus.PAID,
    overdue: SupplierInvoiceStatus.OVERDUE,
  };
  return mapped[key] || SupplierInvoiceStatus.UNPAID;
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

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  const mongo = new MongoClient(mongoUri);

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

    const [
      branchesRaw,
      usersRaw,
      taxRatesRaw,
      productsRaw,
      ordersRaw,
      branchInventoryRaw,
      inventoryMovementRaw,
      activityLogRaw,
      approvalsRaw,
      suppliersRaw,
      supplierInvoicesRaw,
    ] = await Promise.all([
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

    const branchRows = branchesRaw.map((doc: AnyDoc) => ({
      id: toId(doc._id)!,
      name: String(doc.name || ""),
      address: String(doc.address || ""),
      phone: String(doc.phone || ""),
      region: String(doc.region || ""),
      isOnline: Boolean(doc.isOnline),
      createdAt: toDate(doc.createdAt),
      updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
    }));

    const branchIds = new Set(branchRows.map((row) => row.id));

    const userRows = usersRaw.map((doc: AnyDoc) => {
      const branchId = toId(doc.branch);
      return {
        id: toId(doc._id)!,
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

    const taxRateRows = taxRatesRaw.map((doc: AnyDoc) => ({
      id: toId(doc._id)!,
      name: String(doc.name || ""),
      rate: toNumber(doc.rate),
      effectiveFrom: toDate(doc.effectiveFrom),
      isDefault: Boolean(doc.isDefault),
      createdAt: toDate(doc.createdAt),
      updatedAt: toDate(doc.updatedAt, toDate(doc.createdAt)),
    }));
    const taxRateIds = new Set(taxRateRows.map((row) => row.id));

    const productRows = productsRaw.map((doc: AnyDoc) => {
      const taxRateId = toId(doc.taxRate);
      return {
        id: toId(doc._id)!,
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

    const orderRows: Prisma.OrderCreateManyInput[] = [];
    const orderItemRows: Prisma.OrderItemCreateManyInput[] = [];
    let skippedOrders = 0;
    let skippedOrderItems = 0;

    for (const doc of ordersRaw) {
      const id = toId(doc._id)!;
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
        originBranchId:
          originBranchId && branchIds.has(originBranchId) ? originBranchId : null,
        paymentMethod: String(doc.paymentMethod || "Cash on Delivery"),
        paymentStatus: normalizePaymentStatus(doc.paymentStatus),
        orderStatus: normalizeOrderStatus(doc.orderStatus),
        subtotal: toNumber(doc.subtotal),
        taxAmount: toNumber(doc.taxAmount),
        discountAmount: toNumber(doc.discountAmount),
        totalPrice: toNumber(doc.totalPrice),
        createdById: createdById && userIds.has(createdById) ? createdById : null,
        returnReason: String(doc.returnReason || ""),
        returnRequestedById:
          returnRequestedById && userIds.has(returnRequestedById)
            ? returnRequestedById
            : null,
        returnApprovedById:
          returnApprovedById && userIds.has(returnApprovedById)
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

    const branchInventoryRows: Prisma.BranchInventoryCreateManyInput[] = [];
    let skippedBranchInventory = 0;
    for (const doc of branchInventoryRaw) {
      const id = toId(doc._id)!;
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

    const inventoryMovementRows: Prisma.InventoryMovementCreateManyInput[] = [];
    let skippedInventoryMovements = 0;
    for (const doc of inventoryMovementRaw) {
      const id = toId(doc._id)!;
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

    const activityLogRows: Prisma.ActivityLogCreateManyInput[] = [];
    let skippedActivityLogs = 0;
    for (const doc of activityLogRaw) {
      const id = toId(doc._id)!;
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

    const approvalRows: Prisma.ApprovalRequestCreateManyInput[] = [];
    let skippedApprovals = 0;
    for (const doc of approvalsRaw) {
      const id = toId(doc._id)!;
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

    const supplierRows = suppliersRaw.map((doc: AnyDoc) => {
      const id = toId(doc._id)!;
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

    const supplierInvoiceRows: Prisma.SupplierInvoiceCreateManyInput[] = [];
    const supplierInvoiceItemRows: Prisma.SupplierInvoiceItemCreateManyInput[] = [];
    const supplierInvoicePaymentRows: Prisma.SupplierInvoicePaymentCreateManyInput[] = [];
    const supplierInvoiceAttachmentRows: Prisma.SupplierInvoiceAttachmentCreateManyInput[] = [];
    let skippedSupplierInvoices = 0;
    let skippedSupplierInvoiceItems = 0;

    for (const doc of supplierInvoicesRaw) {
      const id = toId(doc._id)!;
      const supplierId = toId(doc.supplier);
      const branchId = toId(doc.branch);
      const createdById = toId(doc.createdBy);
      if (
        !supplierId ||
        !branchId ||
        !supplierIds.has(supplierId) ||
        !branchIds.has(branchId)
      ) {
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
        if (!attachment?.url) continue;
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

    const shippingAddressRows: Prisma.ShippingAddressCreateManyInput[] = [];
    const wishlistRows: Prisma.UserWishlistItemCreateManyInput[] = [];
    const cartRows: Prisma.UserCartItemCreateManyInput[] = [];

    for (const doc of usersRaw) {
      const userId = toId(doc._id)!;
      if (!userIds.has(userId)) continue;

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
        if (!productId || !productIds.has(productId)) continue;
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
        if (!productId || !productIds.has(productId)) continue;
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
    } else {
      console.log("dry run complete no writes");
    }
  } finally {
    await mongo.close();
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error("migration failed", error);
  process.exit(1);
});
