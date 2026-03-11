"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, newId, toLegacyProduct } = require("../utils/prismaLegacy");
const normalizeTaxCategory = (value) => {
    const key = (value || "standard").toString().trim().toLowerCase();
    if (key === "exempt")
        return "EXEMPT";
    if (key === "zero")
        return "ZERO";
    return "STANDARD";
};
const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === "")
        return fallback;
    if (typeof value === "boolean")
        return value;
    const normalized = value.toString().trim().toLowerCase();
    return ["true", "1", "yes", "on"].includes(normalized);
};
const buildPublicProductWhere = (search = "") => {
    const filters = [
        { isActiveOnline: true },
        {
            OR: [
                { quantityAvailable: { gt: 0 } },
                {
                    branchInventories: {
                        some: {
                            quantity: { gt: 0 },
                            branch: { isOnline: true },
                        },
                    },
                },
            ],
        },
    ];
    const normalizedSearch = search.toString().trim();
    if (normalizedSearch) {
        filters.push({
            title: {
                contains: normalizedSearch,
                mode: "insensitive",
            },
        });
    }
    return { AND: filters };
};
// =========================
// LIST PRODUCTS (PUBLIC)
// =========================
exports.list = async (req, res) => {
    const { search = "" } = req.query;
    const includeAllProducts = req.query.visibility?.toString().trim().toLowerCase() === "all";
    const where = includeAllProducts
        ? search
            ? {
                title: {
                    contains: search.toString(),
                    mode: "insensitive",
                },
            }
            : {}
        : buildPublicProductWhere(search);
    const products = await prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
    });
    res.json(products.map((product) => toLegacyProduct(product)));
};
// =========================
// GET ONE PRODUCT
// =========================
exports.getOne = async (req, res) => {
    const includeAllProducts = req.query.visibility?.toString().trim().toLowerCase() === "all";
    const publicWhere = buildPublicProductWhere();
    const product = includeAllProducts
        ? await prisma.product.findUnique({
            where: { id: req.params.id },
        })
        : await prisma.product.findFirst({
            where: {
                id: req.params.id,
                AND: publicWhere.AND,
            },
        });
    if (!product)
        return res.status(404).json({ message: "Product not found" });
    res.json(toLegacyProduct(product));
};
// =========================
// CREATE PRODUCT (ADMIN)
// WITH IMAGE UPLOAD
// =========================
exports.create = async (req, res) => {
    try {
        const { title, description, price, stock, category, costPrice, sellingPrice, expiryDate, quantityAvailable, sku, batchNumber, barcode, supplier, reorderLevel, taxCategory, taxRate, dosageForm, strength, packSize, manufacturer, isActiveOnline, } = req.body;
        const normalizedSellingPrice = sellingPrice !== undefined && sellingPrice !== ""
            ? Number(sellingPrice)
            : Number(price);
        const normalizedQuantity = quantityAvailable !== undefined && quantityAvailable !== ""
            ? Number(quantityAvailable)
            : Number(stock);
        const images = req.files ? req.files.map((file) => file.path) : [];
        const product = await prisma.product.create({
            data: {
                id: newId(),
                title,
                description: description || "",
                price: Number.isFinite(normalizedSellingPrice) ? normalizedSellingPrice : 0,
                costPrice: Number(costPrice || 0),
                sellingPrice: Number.isFinite(normalizedSellingPrice) ? normalizedSellingPrice : 0,
                expiryDate: expiryDate ? new Date(expiryDate) : null,
                stock: Number.isFinite(normalizedQuantity) ? normalizedQuantity : 0,
                quantityAvailable: Number.isFinite(normalizedQuantity) ? normalizedQuantity : 0,
                sku: sku || "",
                batchNumber: batchNumber || "",
                barcode: barcode || "",
                supplierName: supplier || "",
                reorderLevel: Number(reorderLevel || 0),
                taxCategory: normalizeTaxCategory(taxCategory),
                taxRateId: taxRate || null,
                dosageForm: dosageForm || "",
                strength: strength || "",
                packSize: packSize || "",
                manufacturer: manufacturer || "",
                isActiveOnline: normalizeBoolean(isActiveOnline, true),
                category: category || "General",
                images,
            },
        });
        res.status(201).json(toLegacyProduct(product));
        if (req.user?.id) {
            prisma.activityLog
                .create({
                data: {
                    id: newId(),
                    userId: req.user.id,
                    action: "product_created",
                    entityType: "product",
                    entityId: product.id,
                    branchId: req.user?.branch || null,
                    message: "Created product",
                },
            })
                .catch(() => null);
        }
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
};
// =========================
// UPDATE PRODUCT (ADMIN)
// =========================
exports.update = async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map((file) => file.path);
        }
        if (updateData.taxRate === "") {
            updateData.taxRate = null;
        }
        const existing = await prisma.product.findUnique({
            where: { id: req.params.id },
        });
        if (!existing)
            return res.status(404).json({ message: "Product not found" });
        const nextSellingPrice = updateData.sellingPrice !== undefined
            ? Number(updateData.sellingPrice)
            : existing.sellingPrice;
        const nextCostPrice = updateData.costPrice !== undefined
            ? Number(updateData.costPrice)
            : existing.costPrice;
        const priceChanged = Number(existing.sellingPrice || existing.price || 0) !==
            Number(nextSellingPrice || 0) ||
            Number(existing.costPrice || 0) !== Number(nextCostPrice || 0);
        if (priceChanged && !updateData.changeReason) {
            return res
                .status(400)
                .json({ message: "Change reason is required for price updates" });
        }
        const priceChangeReason = priceChanged ? updateData.changeReason : null;
        delete updateData.changeReason;
        if (updateData.sellingPrice !== undefined) {
            const normalized = Number(updateData.sellingPrice);
            updateData.price = normalized;
            updateData.sellingPrice = normalized;
        }
        if (updateData.quantityAvailable !== undefined) {
            const normalized = Number(updateData.quantityAvailable);
            updateData.stock = normalized;
            updateData.quantityAvailable = normalized;
        }
        if (updateData.taxCategory !== undefined) {
            updateData.taxCategory = normalizeTaxCategory(updateData.taxCategory);
        }
        if (updateData.taxRate !== undefined) {
            updateData.taxRateId = updateData.taxRate || null;
            delete updateData.taxRate;
        }
        if (updateData.supplier !== undefined) {
            updateData.supplierName = updateData.supplier || "";
            delete updateData.supplier;
        }
        if (updateData.isActiveOnline !== undefined) {
            updateData.isActiveOnline = normalizeBoolean(updateData.isActiveOnline, existing.isActiveOnline);
        }
        const product = await prisma.product.update({
            where: { id: req.params.id },
            data: updateData,
        });
        res.json(toLegacyProduct(product));
        if (req.user?.id) {
            prisma.activityLog
                .create({
                data: {
                    id: newId(),
                    userId: req.user.id,
                    action: "product_updated",
                    entityType: "product",
                    entityId: product.id,
                    branchId: req.user?.branch || null,
                    message: "Updated product",
                    meta: priceChangeReason ? { reason: priceChangeReason } : {},
                },
            })
                .catch(() => null);
        }
    }
    catch (err) {
        res.status(500).json({ message: err.message });
    }
};
// =========================
// DELETE PRODUCT (ADMIN)
// =========================
exports.remove = async (req, res) => {
    try {
        const product = await prisma.product.findUnique({
            where: { id: req.params.id },
            select: { id: true, title: true },
        });
        if (!product)
            return res.status(404).json({ message: "Product not found" });
        const [orderReferences, inventoryHistoryReferences, supplierInvoiceReferences] = await Promise.all([
            prisma.orderItem.count({
                where: { productId: req.params.id },
            }),
            prisma.inventoryMovement.count({
                where: { productId: req.params.id },
            }),
            prisma.supplierInvoiceItem.count({
                where: { productId: req.params.id },
            }),
        ]);
        const blockers = [];
        if (orderReferences > 0)
            blockers.push("orders");
        if (inventoryHistoryReferences > 0)
            blockers.push("inventory history");
        if (supplierInvoiceReferences > 0)
            blockers.push("supplier invoices");
        if (blockers.length > 0) {
            return res.status(400).json({
                message: `Product cannot be deleted because it is linked to ${blockers.join(", ")}. Mark it inactive online instead.`,
            });
        }
        await prisma.product.delete({
            where: { id: req.params.id },
        });
        if (req.user?.id) {
            prisma.activityLog
                .create({
                data: {
                    id: newId(),
                    userId: req.user.id,
                    action: "product_deleted",
                    entityType: "product",
                    entityId: product.id,
                    branchId: req.user?.branch || null,
                    message: `Deleted product ${product.title}`,
                },
            })
                .catch(() => null);
        }
        res.json({ message: "Product removed" });
    }
    catch (err) {
        if (err.code === "P2003") {
            return res.status(400).json({
                message: "Product cannot be deleted because related records still exist. Mark it inactive online instead.",
            });
        }
        res.status(500).json({ message: err.message });
    }
};
