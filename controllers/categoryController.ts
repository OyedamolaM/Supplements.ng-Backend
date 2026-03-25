const { prisma, newId } = require("../utils/prismaLegacy");

const normalizeCategoryName = (value) => (value || "").toString().trim();

const toCategoryKey = (name: string) => {
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
  } catch (error) {
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
    const imageUrl = req.file?.path || "";
    const existingByKey = await prisma.category.findUnique({ where: { key } });
    const existingByName = existingByKey
      ? null
      : await prisma.category.findFirst({
          where: {
            name: {
              equals: name,
              mode: "insensitive",
            },
          },
        });
    const existing = existingByKey || existingByName;
    if (existing) {
      if (imageUrl && existing.imageUrl !== imageUrl) {
        const updated = await prisma.category.update({
          where: { id: existing.id },
          data: { imageUrl },
        });
        return res.status(200).json(toLegacyCategory(updated));
      }
      return res.status(200).json(toLegacyCategory(existing));
    }

    const category = await prisma.category.create({
      data: {
        id: newId(),
        name,
        key,
        imageUrl,
      },
    });

    res.status(201).json(toLegacyCategory(category));
  } catch (error) {
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

    const nextData: any = {};
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
    } else if (removeImage) {
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

      const productsWithOldCategory = await prisma.product.findMany({
        where: {
          categories: {
            has: category.name,
          },
        },
        select: {
          id: true,
          categories: true,
        },
      });

      if (productsWithOldCategory.length > 0) {
        await prisma.$transaction(
          productsWithOldCategory.map((product) => {
            const existingCategories = Array.isArray(product.categories) ? product.categories : [];
            const nextCategories = existingCategories.map((value) =>
              value === category.name ? updated.name : value
            );
            return prisma.product.update({
              where: { id: product.id },
              data: {
                categories: nextCategories,
              },
            });
          })
        );
      }
    }

    res.json(toLegacyCategory(updated));
  } catch (error) {
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

    const productsWithOldCategory = await prisma.product.findMany({
      where: {
        categories: {
          has: category.name,
        },
      },
      select: {
        id: true,
        categories: true,
        category: true,
      },
    });

    if (productsWithOldCategory.length > 0) {
        await prisma.$transaction(
          productsWithOldCategory.map((product) => {
            const existingCategories = Array.isArray(product.categories) ? product.categories : [];
            const replaced = existingCategories.map((value) => (value === category.name ? "General" : value));
            const normalized = replaced
              .map((value) => (value || "").toString().trim())
              .filter(Boolean);
            const unique = Array.from(
              new Map(normalized.map((value) => [value.toLowerCase(), value])).values()
            );
            const nextCategories = unique.length > 0 ? unique : ["General"];
            const nextPrimaryCategory =
              product.category === category.name ? "General" : product.category || nextCategories[0] || "General";
            return prisma.product.update({
              where: { id: product.id },
              data: {
              category: nextPrimaryCategory,
              categories: nextCategories,
            },
          });
        })
      );
    }

    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.syncFromProducts = async (req, res) => {
  try {
    await ensureGeneralCategory();

    const existing = await prisma.category.findMany({
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((item) => item.key));

    const products = await prisma.product.findMany({
      select: {
        category: true,
        categories: true,
      },
    });

    const seen = new Map<string, string>();
    const candidates = new Map<string, string>();
    products.forEach((product) => {
      const rawValues =
        Array.isArray(product?.categories) && product.categories.length
          ? product.categories
          : [product?.category];

      rawValues.forEach((value) => {
        const raw = normalizeCategoryName(value);
        const name = raw || "General";
        const key = toCategoryKey(name);
        if (!seen.has(key)) {
          seen.set(key, name);
        }
        if (!existingKeys.has(key)) {
          candidates.set(key, name);
        }
      });
    });

    if (candidates.size === 0) {
      return res.json({ created: 0, found: seen.size });
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

    res.json({ created: result.count || 0, found: seen.size });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.toCategoryKey = toCategoryKey;
exports.normalizeCategoryName = normalizeCategoryName;
exports.ensureGeneralCategory = ensureGeneralCategory;
exports.toLegacyCategory = toLegacyCategory;
