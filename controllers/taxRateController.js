const TaxRate = require("../models/TaxRate");

exports.listTaxRates = async (req, res) => {
  try {
    const rates = await TaxRate.find().sort({ effectiveFrom: -1 });
    res.json(rates);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createTaxRate = async (req, res) => {
  try {
    const { name, rate, effectiveFrom, isDefault } = req.body;
    if (!name || rate === undefined || !effectiveFrom) {
      return res.status(400).json({ message: "Name, rate, and effective date are required" });
    }

    if (isDefault) {
      await TaxRate.updateMany({}, { $set: { isDefault: false } });
    }

    const taxRate = await TaxRate.create({
      name,
      rate: Number(rate),
      effectiveFrom,
      isDefault: Boolean(isDefault),
    });
    res.status(201).json(taxRate);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateTaxRate = async (req, res) => {
  try {
    const { isDefault } = req.body;
    if (isDefault) {
      await TaxRate.updateMany({}, { $set: { isDefault: false } });
    }
    const taxRate = await TaxRate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!taxRate) return res.status(404).json({ message: "Tax rate not found" });
    res.json(taxRate);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
