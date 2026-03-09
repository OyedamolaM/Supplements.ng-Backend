const { prisma, newId } = require("../utils/prismaLegacy");

const toLegacyTaxRate = (rate) => ({
  _id: rate.id,
  id: rate.id,
  name: rate.name,
  rate: rate.rate,
  effectiveFrom: rate.effectiveFrom,
  isDefault: rate.isDefault,
  createdAt: rate.createdAt,
  updatedAt: rate.updatedAt,
});

exports.listTaxRates = async (req, res) => {
  try {
    const rates = await prisma.taxRate.findMany({
      orderBy: { effectiveFrom: "desc" },
    });
    res.json(rates.map(toLegacyTaxRate));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createTaxRate = async (req, res) => {
  try {
    const { name, rate, effectiveFrom, isDefault } = req.body;
    if (!name || rate === undefined || !effectiveFrom) {
      return res
        .status(400)
        .json({ message: "Name, rate, and effective date are required" });
    }

    if (isDefault) {
      await prisma.taxRate.updateMany({ data: { isDefault: false } });
    }

    const taxRate = await prisma.taxRate.create({
      data: {
        id: newId(),
        name,
        rate: Number(rate),
        effectiveFrom: new Date(effectiveFrom),
        isDefault: Boolean(isDefault),
      },
    });
    res.status(201).json(toLegacyTaxRate(taxRate));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateTaxRate = async (req, res) => {
  try {
    const { isDefault } = req.body;
    if (isDefault) {
      await prisma.taxRate.updateMany({ data: { isDefault: false } });
    }

    const data = { ...req.body };
    if (data.effectiveFrom !== undefined) {
      data.effectiveFrom = new Date(data.effectiveFrom);
    }

    const taxRate = await prisma.taxRate.update({
      where: { id: req.params.id },
      data,
    });
    if (!taxRate) return res.status(404).json({ message: "Tax rate not found" });
    res.json(toLegacyTaxRate(taxRate));
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Tax rate not found" });
    }
    res.status(500).json({ message: error.message });
  }
};
