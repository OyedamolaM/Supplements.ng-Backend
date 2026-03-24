"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { prisma, newId } = require("../utils/prismaLegacy");
const normalizeCategoryName = (value) => (value || "").toString().trim();
const toCategoryKey = (name) => {
    const normalized = normalizeCategoryName(name).toLowerCase();
    const key = normalized
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "");
    return key || "general";
};
const toLegacyCategory = (category) => ({
    _id: category.id,
    id: category.id,
    name: category.name,
    key: category.key,
    imageUrl: category.imageUrl || "",
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
});
const ensureGeneralCategory = async () => {
    const key = "general";
    return prisma.category.upsert({
        where: { key },
        update: {},
        create: {
            id: newId(),
            key,
            name: "General",
            imageUrl: "",
        },
    });
};
exports.list = async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: { name: "asc" },
        });
        res.json(categories.map(toLegacyCategory));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.create = async (req, res) => {
    try {
        const name = normalizeCategoryName(req.body?.name);
        if (!name) {
            return res.status(400).json({ message: "Category name is required" });
        }
        const key = toCategoryKey(name);
        const existing = await prisma.category.findUnique({ where: { key } });
        if (existing) {
            return res.status(409).json({ message: "Category already exists" });
        }
        const imageUrl = req.file?.path || "";
        const category = await prisma.category.create({
            data: {
                id: newId(),
                name,
                key,
                imageUrl,
            },
        });
        res.status(201).json(toLegacyCategory(category));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.update = async (req, res) => {
    try {
        const category = await prisma.category.findUnique({
            where: { id: req.params.id },
        });
        if (!category) {
            return res.status(404).json({ message: "Category not found" });
        }
        const nextData = {};
        const removeImage = req.body?.removeImage === true || req.body?.removeImage === "true";
        const nameProvided = req.body?.name !== undefined;
        const nextName = nameProvided ? normalizeCategoryName(req.body?.name) : "";
        const nextKey = nameProvided ? toCategoryKey(nextName) : "";
        if (nameProvided) {
            if (!nextName) {
                return res.status(400).json({ message: "Category name cannot be empty" });
            }
            if (nextKey !== category.key) {
                const keyExists = await prisma.category.findUnique({ where: { key: nextKey } });
                if (keyExists) {
                    return res.status(409).json({ message: "Another category already uses that name" });
                }
                nextData.key = nextKey;
            }
            nextData.name = nextName;
        }
        if (req.file?.path) {
            nextData.imageUrl = req.file.path;
        }
        else if (removeImage) {
            nextData.imageUrl = "";
        }
        const updated = await prisma.category.update({
            where: { id: req.params.id },
            data: nextData,
        });
        if (nameProvided && category.name !== updated.name) {
            await prisma.product.updateMany({
                where: { category: category.name },
                data: { category: updated.name },
            });
        }
        res.json(toLegacyCategory(updated));
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.remove = async (req, res) => {
    try {
        const category = await prisma.category.findUnique({
            where: { id: req.params.id },
        });
        if (!category) {
            return res.status(404).json({ message: "Category not found" });
        }
        if (category.key === "general") {
            return res.status(400).json({ message: "General category cannot be deleted" });
        }
        await ensureGeneralCategory();
        await prisma.product.updateMany({
            where: { category: category.name },
            data: { category: "General" },
        });
        await prisma.category.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.syncFromProducts = async (req, res) => {
    try {
        await ensureGeneralCategory();
        const groups = await prisma.product.groupBy({
            by: ["category"],
            _count: { _all: true },
        });
        const existing = await prisma.category.findMany({
            select: { key: true },
        });
        const existingKeys = new Set(existing.map((item) => item.key));
        const candidates = new Map();
        groups.forEach((group) => {
            const raw = normalizeCategoryName(group.category);
            const name = raw || "General";
            const key = toCategoryKey(name);
            if (!existingKeys.has(key)) {
                candidates.set(key, name);
            }
        });
        if (candidates.size === 0) {
            return res.json({ created: 0, found: groups.length });
        }
        const data = Array.from(candidates.entries()).map(([key, name]) => ({
            id: newId(),
            key,
            name,
            imageUrl: "",
        }));
        const result = await prisma.category.createMany({
            data,
            skipDuplicates: true,
        });
        res.json({ created: result.count || 0, found: groups.length });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.toCategoryKey = toCategoryKey;
exports.normalizeCategoryName = normalizeCategoryName;
exports.ensureGeneralCategory = ensureGeneralCategory;
exports.toLegacyCategory = toLegacyCategory;
