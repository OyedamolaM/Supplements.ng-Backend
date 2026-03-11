import { randomUUID } from "crypto";
import { UserRole } from "@prisma/client";

const prismaModule = require("../config/prisma");

const prisma = prismaModule.prisma || prismaModule.default || prismaModule;

const roleToDbMap = {
  customer: UserRole.CUSTOMER,
  super_admin: UserRole.SUPER_ADMIN,
  admin: UserRole.ADMIN,
  branch_manager: UserRole.BRANCH_MANAGER,
  accountant: UserRole.ACCOUNTANT,
  inventory_manager: UserRole.INVENTORY_MANAGER,
  cashier: UserRole.CASHIER,
  staff: UserRole.STAFF,
} as const;

const roleFromDbMap: Record<UserRole, string> = {
  [UserRole.CUSTOMER]: "customer",
  [UserRole.SUPER_ADMIN]: "super_admin",
  [UserRole.ADMIN]: "admin",
  [UserRole.BRANCH_MANAGER]: "branch_manager",
  [UserRole.ACCOUNTANT]: "accountant",
  [UserRole.INVENTORY_MANAGER]: "inventory_manager",
  [UserRole.CASHIER]: "cashier",
  [UserRole.STAFF]: "staff",
};

const toDbUserRole = (role: string | null | undefined): UserRole => {
  const key = (role || "customer").toString().trim().toLowerCase() as keyof typeof roleToDbMap;
  return roleToDbMap[key] || UserRole.CUSTOMER;
};

const fromDbUserRole = (role: UserRole | null | undefined): string => {
  if (!role) return "customer";
  return roleFromDbMap[role] || "customer";
};

const toLegacyBranch = (branch: any) => {
  if (!branch) return null;
  return {
    _id: branch.id,
    id: branch.id,
    name: branch.name,
    address: branch.address,
    phone: branch.phone,
    region: branch.region,
    isOnline: branch.isOnline,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
};

const toLegacyProduct = (product: any) => {
  if (!product) return null;
  return {
    _id: product.id,
    id: product.id,
    title: product.title,
    description: product.description,
    isActiveOnline: Boolean(product.isActiveOnline),
    price: product.price,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    expiryDate: product.expiryDate,
    stock: product.stock,
    quantityAvailable: product.quantityAvailable,
    sku: product.sku,
    batchNumber: product.batchNumber,
    barcode: product.barcode,
    supplier: product.supplierName,
    reorderLevel: product.reorderLevel,
    taxCategory: product.taxCategory?.toLowerCase?.() || "standard",
    taxRate: product.taxRateId || null,
    dosageForm: product.dosageForm,
    strength: product.strength,
    packSize: product.packSize,
    manufacturer: product.manufacturer,
    images: product.images || [],
    category: product.category,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

const toLegacyUser = (user: any) => {
  if (!user) return null;
  const shippingAddresses = Array.isArray(user.shippingAddresses)
    ? user.shippingAddresses
    : [];

  return {
    _id: user.id,
    id: user.id,
    name: user.name,
    phone: user.phone || "",
    email: user.email,
    role: fromDbUserRole(user.role),
    branch: user.branch ? toLegacyBranch(user.branch) : user.branchId || null,
    region: user.region || "",
    shippingAddresses: shippingAddresses.map((address: any) => ({
      _id: address.id,
      id: address.id,
      fullName: address.fullName,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 || "",
      city: address.city,
      state: address.state,
      country: address.country,
      postalCode: address.postalCode,
      phone: address.phone,
    })),
    wishlist: user.wishlistItems
      ? user.wishlistItems.map((item: any) => item.productId)
      : undefined,
    isAdmin:
      fromDbUserRole(user.role) === "admin" ||
      fromDbUserRole(user.role) === "super_admin",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const toLegacyOrder = (order: any) => {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    _id: order.id,
    id: order.id,
    user: order.user
      ? {
          _id: order.user.id,
          id: order.user.id,
          name: order.user.name,
          email: order.user.email,
          phone: order.user.phone || "",
          role: fromDbUserRole(order.user.role),
        }
      : order.userId,
    branch: order.branch ? toLegacyBranch(order.branch) : order.branchId || null,
    originBranch: order.originBranch ? toLegacyBranch(order.originBranch) : order.originBranchId || null,
    products: items.map((item: any) => ({
      _id: item.id,
      id: item.id,
      product: item.product ? toLegacyProduct(item.product) : item.productId,
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
    shippingAddress: {
      fullName: order.shippingFullName || "",
      addressLine1: order.shippingAddressLine1 || "",
      addressLine2: order.shippingAddressLine2 || "",
      city: order.shippingCity || "",
      state: order.shippingState || "",
      country: order.shippingCountry || "",
      postalCode: order.shippingPostalCode || "",
      phone: order.shippingPhone || "",
    },
    paymentMethod: order.paymentMethod,
    paymentStatus: (order.paymentStatus || "PENDING").toLowerCase(),
    orderStatus:
      (order.orderStatus || "PROCESSING")
        .toLowerCase()
        .replace("return_requested", "ReturnRequested")
        .replace("processing", "Processing")
        .replace("shipped", "Shipped")
        .replace("delivered", "Delivered")
        .replace("cancelled", "Cancelled")
        .replace("returned", "Returned"),
    subtotal: order.subtotal || 0,
    taxAmount: order.taxAmount || 0,
    discountAmount: order.discountAmount || 0,
    totalPrice: order.totalPrice,
    createdBy: order.createdById || null,
    returnReason: order.returnReason || "",
    returnRequestedBy: order.returnRequestedById || null,
    returnApprovedBy: order.returnApprovedById || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

const legacyOrderStatusToDb = (status: string | null | undefined) => {
  const key = (status || "").toString().trim().toLowerCase();
  if (key === "shipped") return "SHIPPED";
  if (key === "delivered") return "DELIVERED";
  if (key === "cancelled") return "CANCELLED";
  if (key === "returnrequested") return "RETURN_REQUESTED";
  if (key === "returned") return "RETURNED";
  return "PROCESSING";
};

const legacyPaymentStatusToDb = (status: string | null | undefined) => {
  const key = (status || "").toString().trim().toLowerCase();
  if (key === "paid") return "PAID";
  return "PENDING";
};

module.exports = {
  prisma,
  newId: randomUUID,
  toDbUserRole,
  fromDbUserRole,
  toLegacyBranch,
  toLegacyUser,
  toLegacyProduct,
  toLegacyOrder,
  legacyOrderStatusToDb,
  legacyPaymentStatusToDb,
};

export {};
