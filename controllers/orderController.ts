const {
  prisma,
  newId,
  toLegacyOrder,
  legacyOrderStatusToDb,
} = require("../utils/prismaLegacy");
const { generateReceipt } = require("../utils/receiptGenerator");
const {
  sendBrevoEmail,
  buildOrderConfirmationEmail,
} = require("../services/emailService");
const { sendOrderStatusWhatsApp } = require("../services/whatsappService");
const {
  createFezOrder,
  trackFezOrder,
  fetchFezDeliveryCost,
  getFezDeliveryTimeEstimate,
  getFezLockersByState,
  checkFezLockerAvailability,
  getFezStates,
  getFezExportLocations,
  getFezExportDeliveryCost,
  createFezExportOrder,
} = require("../services/fezService");

const isProductAvailableForOnlinePurchase = (product) => {
  if (!product || !product.isActiveOnline) return false;
  if (Number(product.quantityAvailable || 0) > 0) return true;
  return (product.branchInventories || []).some(
    (entry) => entry?.branch?.isOnline && Number(entry.quantity || 0) > 0
  );
};

const normalizeAddressValue = (value) =>
  (value || "").toString().trim().toLowerCase();

const isSameAddress = (a, b) => {
  const fields = [
    "fullName",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "country",
    "postalCode",
    "phone",
  ];

  return fields.every(
    (field) => normalizeAddressValue(a[field]) === normalizeAddressValue(b[field])
  );
};

const FEZ_ENABLED = (process.env.FEZ_ENABLED || "").toString().trim().toLowerCase() === "true";
const FEZ_READY =
  FEZ_ENABLED &&
  (process.env.FEZ_USER_ID || "").toString().trim() &&
  (process.env.FEZ_PASSWORD || "").toString().trim();
const FEZ_AUTO_DISPATCH = (process.env.FEZ_AUTO_DISPATCH || "true").toString().trim().toLowerCase() === "true";
const FEZ_DEFAULT_WEIGHT_KG = 2;
const FEZ_PICKUP_STATE = (process.env.FEZ_PICKUP_STATE || "").toString().trim();

const hasText = (value: any) => Boolean((value || "").toString().trim());

const normalizeShippingWeight = (weight: any) => {
  const parsed = Number(weight);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return FEZ_DEFAULT_WEIGHT_KG;
};

const extractList = (payload: any, keys: string[]) => {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
};

const normalizeLookupValue = (value: any) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getExportLocationLabel = (location: any) =>
  (
    location?.name ||
    location?.country ||
    location?.location ||
    location?.label ||
    ""
  )
    .toString()
    .trim();

const getExportLocationId = (location: any) =>
  location?.id || location?.exportLocationId || location?.locationId || null;

const parseWeightNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseWeightBand = (weight: any) => {
  const min =
    parseWeightNumber(weight?.minWeight) ??
    parseWeightNumber(weight?.min_weight) ??
    parseWeightNumber(weight?.fromWeight) ??
    parseWeightNumber(weight?.from) ??
    parseWeightNumber(weight?.min);
  const max =
    parseWeightNumber(weight?.maxWeight) ??
    parseWeightNumber(weight?.max_weight) ??
    parseWeightNumber(weight?.toWeight) ??
    parseWeightNumber(weight?.to) ??
    parseWeightNumber(weight?.max);

  if (min !== null || max !== null) {
    return {
      min: min ?? 0,
      max: max ?? min ?? 0,
    };
  }

  const exact =
    parseWeightNumber(weight?.weight) ??
    parseWeightNumber(weight?.weightKg) ??
    parseWeightNumber(weight?.value);
  if (exact !== null) {
    return { min: 0, max: exact };
  }

  const label = (weight?.name || weight?.label || weight?.title || "").toString();
  const numbers = [...label.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  if (numbers.length >= 2) {
    return { min: numbers[0], max: numbers[numbers.length - 1] };
  }
  if (numbers.length === 1) {
    return { min: 0, max: numbers[0] };
  }

  return { min: null, max: null };
};

const getWeightId = (weight: any) => weight?.id || weight?.weightId || weight?.weight_id || null;

const resolveExportMeta = async ({
  country,
  exportLocationId,
  weightId,
  weightKg,
}: {
  country?: string;
  exportLocationId?: any;
  weightId?: any;
  weightKg?: any;
}) => {
  const response = await getFezExportLocations();
  const payload = response?.data || response || {};
  const exportLocations = extractList(payload, ["exportLocations", "locations"]);
  const exportWeights = extractList(payload, ["exportWeights", "weights"]);

  const normalizedCountry = normalizeLookupValue(country);
  let resolvedLocationId = exportLocationId || null;
  if (!resolvedLocationId && normalizedCountry) {
    const matchedLocation =
      exportLocations.find(
        (location) => normalizeLookupValue(getExportLocationLabel(location)) === normalizedCountry
      ) ||
      exportLocations.find((location) =>
        normalizeLookupValue(getExportLocationLabel(location)).includes(normalizedCountry)
      );
    resolvedLocationId = getExportLocationId(matchedLocation);
  }

  const normalizedWeightKg = normalizeShippingWeight(weightKg);
  let resolvedWeightId = weightId || null;
  if (!resolvedWeightId) {
    const weightedOptions = exportWeights
      .map((weight) => ({
        id: getWeightId(weight),
        ...parseWeightBand(weight),
      }))
      .filter((weight) => weight.id);

    const exactMatch = weightedOptions.find(
      (weight) =>
        weight.min !== null &&
        weight.max !== null &&
        normalizedWeightKg >= weight.min &&
        normalizedWeightKg <= weight.max
    );

    if (exactMatch?.id) {
      resolvedWeightId = exactMatch.id;
    } else {
      const nearestMatch = weightedOptions
        .filter((weight) => weight.max !== null && weight.max >= normalizedWeightKg)
        .sort((a, b) => (a.max ?? Number.MAX_SAFE_INTEGER) - (b.max ?? Number.MAX_SAFE_INTEGER))[0];
      resolvedWeightId = nearestMatch?.id || weightedOptions[0]?.id || null;
    }
  }

  return {
    exportLocationId: resolvedLocationId,
    weightId: resolvedWeightId,
    weightKg: normalizedWeightKg,
  };
};

const isValidShippingAddress = (shippingAddress: any, deliveryType: string, lockerId: any) => {
  if (!hasText(shippingAddress?.fullName) || !hasText(shippingAddress?.phone)) return false;
  const normalizedDeliveryType = (deliveryType || "").toString().trim().toLowerCase();
  const localDelivery = normalizedDeliveryType !== "export" && normalizedDeliveryType !== "international";

  if (localDelivery) {
    if (!hasText(shippingAddress?.state)) return false;
    if (hasText(lockerId)) return true;
    return hasText(shippingAddress?.addressLine1) && hasText(shippingAddress?.city);
  }

  return (
    hasText(shippingAddress?.country) &&
    hasText(shippingAddress?.addressLine1) &&
    hasText(shippingAddress?.city) &&
    hasText(shippingAddress?.postalCode)
  );
};

const parseShippingFee = (payload: any) => {
  if (payload === null || payload === undefined) return 0;
  if (typeof payload === "number") return Number.isFinite(payload) ? payload : 0;
  if (typeof payload === "string") {
    const parsed = Number(payload);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const totalCost = payload?.totalCost ?? payload?.total_cost;
  if (totalCost !== undefined && totalCost !== null) {
    const parsed = Number(totalCost);
    if (Number.isFinite(parsed)) return parsed;
  }
  const costValue = payload?.cost?.cost ?? payload?.Cost?.cost ?? payload?.cost;
  if (costValue !== undefined && costValue !== null) {
    const parsed = Number(costValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  const exportPrice = payload?.data?.price ?? payload?.price;
  if (exportPrice !== undefined && exportPrice !== null) {
    const parsed = Number(exportPrice);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const extractFezOrderNo = (payload: any, uniqueId: string) => {
  if (!payload) return null;
  if (payload?.orderNo) return payload.orderNo;
  if (payload?.orderNumber) return payload.orderNumber;
  if (payload?.orderNos?.[uniqueId]) return payload.orderNos[uniqueId];
  if (payload?.data?.orderNos?.[uniqueId]) return payload.data.orderNos[uniqueId];
  if (payload?.Response?.[uniqueId]) return payload.Response[uniqueId];
  if (Array.isArray(payload?.Response) && payload.Response.length) {
    return payload.Response[0]?.orderNo || payload.Response[0]?.orderNumber;
  }
  return null;
};

// =========================
// Fetch shipping quote (customer/guest)
// =========================
exports.getShippingQuote = async (req, res) => {
  try {
    const { state, pickUpState, weight, itemCount, locker } = req.body || {};
    const destinationState = (state || "").toString().trim();
    if (!destinationState) {
      return res.status(400).json({ message: "Destination state is required" });
    }

    const normalizedWeight = normalizeShippingWeight(weight);
    const payload: Record<string, any> = {
      state: destinationState,
      weight: normalizedWeight,
    };
    if (pickUpState) payload.pickUpState = pickUpState;
    if (locker !== undefined) payload.locker = Boolean(locker);

    if (!FEZ_READY) {
      return res.json({
        data: {
          totalCost: 0,
        },
        warning: "Shipping quote provider not configured",
        meta: {
          state: destinationState,
          pickUpState: pickUpState || null,
          weight: normalizedWeight,
        },
      });
    }

    const response = await fetchFezDeliveryCost(payload);
    res.json({
      ...response,
      meta: {
        state: destinationState,
        pickUpState: pickUpState || null,
        weight: normalizedWeight,
      },
    });
  } catch (err) {
    console.error("Shipping quote failed", err);
    res.status(500).json({ message: "Unable to fetch shipping quote", error: err.message });
  }
};

// =========================
// Delivery time estimate (customer/guest)
// =========================
exports.getDeliveryTimeEstimate = async (req, res) => {
  try {
    const { deliveryType, pickUpState, dropOffState, destinationCountry, country } = req.body || {};
    const normalizedType = (deliveryType || "local").toString().trim().toLowerCase();
    const destinationCountryValue = (destinationCountry || country || "").toString().trim();

    if (normalizedType === "export" || normalizedType === "international") {
      if (!destinationCountryValue) {
        return res.status(400).json({ message: "Destination country is required" });
      }
      return res.json({
        eta: "5-7 working days",
        message: "International ETA is a standard estimate",
        meta: { deliveryType: normalizedType, destinationCountry: destinationCountryValue },
      });
    }

    const dropOff = (dropOffState || "").toString().trim();
    if (!dropOff) {
      return res.status(400).json({ message: "Drop-off state is required" });
    }
    const payload = {
      delivery_type: normalizedType,
      pick_up_state: (pickUpState || FEZ_PICKUP_STATE || "").toString().trim(),
      drop_off_state: dropOff,
    };
    const response = await getFezDeliveryTimeEstimate(payload);
    res.json(response);
  } catch (err) {
    console.error("Delivery time estimate failed", err);
    res.status(500).json({ message: "Unable to fetch delivery time estimate", error: err.message });
  }
};

// =========================
// Fez states (customer/guest)
// =========================
exports.getShippingStates = async (_req, res) => {
  try {
    const response = await getFezStates();
    res.json(response);
  } catch (err) {
    console.error("States fetch failed", err);
    res.status(500).json({ message: "Unable to fetch states", error: err.message });
  }
};

// =========================
// Fez lockers (customer/guest)
// =========================
exports.getLockersByState = async (req, res) => {
  try {
    const state = (req.params.state || "").toString().trim();
    if (!state) return res.status(400).json({ message: "State is required" });
    const response = await getFezLockersByState(state);
    res.json(response);
  } catch (err) {
    console.error("Lockers fetch failed", err);
    res.status(500).json({ message: "Unable to fetch lockers", error: err.message });
  }
};

exports.checkLockerAvailability = async (req, res) => {
  try {
    const lockerId = (req.params.lockerId || "").toString().trim();
    if (!lockerId) return res.status(400).json({ message: "Locker ID is required" });
    const response = await checkFezLockerAvailability(lockerId);
    res.json(response);
  } catch (err) {
    console.error("Locker availability failed", err);
    res.status(500).json({ message: "Unable to fetch locker availability", error: err.message });
  }
};

// =========================
// Export helpers (customer/guest)
// =========================
exports.getExportLocations = async (_req, res) => {
  try {
    const response = await getFezExportLocations();
    res.json(response);
  } catch (err) {
    console.error("Export locations fetch failed", err);
    res.status(500).json({ message: "Unable to fetch export locations", error: err.message });
  }
};

exports.getExportDeliveryCost = async (req, res) => {
  try {
    const { exportLocationId, weightId, country, weightKg } = req.body || {};
    const resolved = await resolveExportMeta({ exportLocationId, weightId, country, weightKg });
    if (!resolved.exportLocationId) {
      return res.status(400).json({ message: "Destination country is required" });
    }
    if (!resolved.weightId) {
      return res.status(400).json({ message: "Could not resolve export weight band" });
    }
    const response = await getFezExportDeliveryCost({
      exportLocationId: resolved.exportLocationId,
      weightId: resolved.weightId,
    });
    res.json({
      ...response,
      meta: {
        country: country || null,
        weightKg: resolved.weightKg,
        exportLocationId: resolved.exportLocationId,
        weightId: resolved.weightId,
      },
    });
  } catch (err) {
    console.error("Export delivery cost failed", err);
    res.status(500).json({ message: "Unable to fetch export delivery cost", error: err.message });
  }
};
const COD_ENABLED = FEZ_ENABLED || (process.env.ALLOW_COD || "").toString().trim().toLowerCase() === "true";

const buildOrderItemSnapshot = (product) => ({
  purchaseDate: new Date(),
  packQuantitySnapshot: Number(product.packQuantity || 0),
  unitTypeSnapshot: product.unitType || "",
  recommendedDosageAmountSnapshot: Number(product.recommendedDosageAmount || 0),
  recommendedDosageUnitSnapshot: product.recommendedDosageUnit || "",
  recommendedFrequencyPerDaySnapshot: Number(product.recommendedFrequencyPerDay || 0),
  recommendedUsageTextSnapshot: product.recommendedUsageText || "",
  usageModeSnapshot:
    (product.usageMode || "FIXED").toString().toUpperCase() === "AS_NEEDED"
      ? "AS_NEEDED"
      : "FIXED",
  refillableSnapshot:
    product.refillable === undefined || product.refillable === null
      ? true
      : Boolean(product.refillable),
  reorderableSnapshot:
    product.reorderable === undefined || product.reorderable === null
      ? true
      : Boolean(product.reorderable),
  manualOverrideEnabled: false,
  dosageRecommendedByName: null,
  dosageRecommendedByRole: null,
  dosageRecommendedAt: null,
});

const formatShipping = (shippingAddress: any = {}) => ({
  shippingFullName: shippingAddress.fullName || null,
  shippingAddressLine1: shippingAddress.addressLine1 || null,
  shippingAddressLine2: shippingAddress.addressLine2 || null,
  shippingCity: shippingAddress.city || null,
  shippingState: shippingAddress.state || null,
  shippingCountry: shippingAddress.country || null,
  shippingPostalCode: shippingAddress.postalCode || null,
  shippingPhone: shippingAddress.phone || null,
});

const saveAddressIfNew = async (userId, shippingAddress) => {
  if (!shippingAddress) return;
  const addresses = await prisma.shippingAddress.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const hasAddress = addresses.some((address) => isSameAddress(address, shippingAddress));
  if (!hasAddress) {
    await prisma.shippingAddress.create({
      data: {
        id: newId(),
        userId,
        fullName: shippingAddress.fullName || "",
        addressLine1: shippingAddress.addressLine1 || "",
        addressLine2: shippingAddress.addressLine2 || "",
        city: shippingAddress.city || "",
        state: shippingAddress.state || "",
        country: shippingAddress.country || "",
        postalCode: shippingAddress.postalCode || "",
        phone: shippingAddress.phone || "",
        sortOrder: addresses.length,
      },
    });
  }
};

// =========================
// Create a new order
// =========================
exports.createOrder = async (req, res) => {
  try {
    if (req.user.role !== "customer") {
      return res.status(403).json({ message: "Only customers can place orders" });
    }
    const { products, shippingAddress, paymentMethod } = req.body;
    const shipping = shippingAddress || {};
    const deliveryType = (
      req.body?.deliveryType ||
      (normalizeAddressValue(shipping?.country) !== "nigeria" ? "export" : "local")
    )
      .toString()
      .trim()
      .toLowerCase();
    const lockerId = req.body?.lockerId;

    if (!products || products.length === 0) {
      return res.status(400).json({ message: "No products in order" });
    }

    const hasShipping = isValidShippingAddress(shippingAddress, deliveryType, lockerId);
    if (!hasShipping) {
      return res.status(400).json({ message: "Shipping address is required" });
    }

    const normalizedPaymentMethod = (paymentMethod || "Paystack")
      .toString()
      .trim();
    const paymentMethodLower = normalizedPaymentMethod.toLowerCase();
    if (paymentMethodLower.includes("cash") && !COD_ENABLED) {
      return res.status(400).json({
        message: "Cash on delivery is not available for online orders",
      });
    }
    const resolvedPaymentMethod = normalizedPaymentMethod || "Paystack";

    let subtotal = 0;
    let taxAmount = 0;
    const orderProducts = [];
    let itemCount = 0;

    let defaultTaxRate = await prisma.taxRate.findFirst({
      where: { isDefault: true },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!defaultTaxRate) {
      defaultTaxRate = await prisma.taxRate.findFirst({
        where: { effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
      });
    }

    const defaultRateValue = defaultTaxRate?.rate || 0;
    const taxRateCache = new Map();

    for (const item of products) {
      const productId = item.product || item.productId;
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          branchInventories: {
            where: { quantity: { gt: 0 } },
            select: {
              quantity: true,
              branch: { select: { isOnline: true } },
            },
          },
        },
      });
      if (!product) return res.status(404).json({ message: "Product not found" });
      if (product.deletedAt) {
        return res.status(400).json({ message: `${product.title} is no longer available` });
      }
      if (!isProductAvailableForOnlinePurchase(product)) {
        return res
          .status(400)
          .json({ message: `${product.title} is not available for online purchase` });
      }

      const quantity = Number(item.quantity) || 1;
      itemCount += quantity;
      const lineTotal = product.price * quantity;
      orderProducts.push({
        id: newId(),
        productId: product.id,
        title: product.title,
        price: product.price,
        quantity,
        ...buildOrderItemSnapshot(product),
      });

      subtotal += lineTotal;
      if ((product.taxCategory || "STANDARD").toUpperCase() === "STANDARD") {
        let rateValue = defaultRateValue;
        if (product.taxRateId) {
          const key = product.taxRateId;
          if (taxRateCache.has(key)) {
            rateValue = taxRateCache.get(key);
          } else {
            const rateDoc = await prisma.taxRate.findUnique({
              where: { id: key },
              select: { rate: true },
            });
            rateValue = rateDoc?.rate || defaultRateValue;
            taxRateCache.set(key, rateValue);
          }
        }
        taxAmount += (lineTotal * rateValue) / 100;
      }
    }

    const shippingQuote = req.body?.shippingQuote || null;
    const shippingEta = req.body?.shippingEta || null;
    let exportLocationId = req.body?.exportLocationId;
    let exportWeightId = req.body?.exportWeightId;
    let exportWeightKg = req.body?.exportWeightKg;
    if (deliveryType === "export" || deliveryType === "international") {
      const resolvedExportMeta = await resolveExportMeta({
        country: shipping?.country,
        exportLocationId,
        weightId: exportWeightId,
        weightKg: exportWeightKg,
      });
      exportLocationId = resolvedExportMeta.exportLocationId;
      exportWeightId = resolvedExportMeta.weightId;
      exportWeightKg = resolvedExportMeta.weightKg;
    }
    const shippingFee = parseShippingFee(req.body?.shippingFee ?? shippingQuote);
    const totalPrice = subtotal + taxAmount + (shippingFee || 0);
    const onlineBranch = await prisma.branch.findFirst({
      where: { isOnline: true },
      select: { id: true },
    });

    let order = await prisma.order.create({
      data: {
        id: newId(),
        userId: req.user.id,
        branchId: onlineBranch?.id || null,
        originBranchId: onlineBranch?.id || null,
        paymentMethod: resolvedPaymentMethod,
        deliveryStatus: paymentMethodLower.includes("cash") ? "CONFIRMED" : undefined,
        subtotal,
        taxAmount,
        discountAmount: 0,
        totalPrice,
        ...formatShipping(shippingAddress),
        items: { create: orderProducts },
        deliveryMeta: shippingQuote
          ? { shippingQuote, shippingFee, shippingEta, deliveryType, lockerId, exportLocationId, exportWeightId, exportWeightKg }
          : shippingFee || shippingEta
            ? { shippingFee, shippingEta, deliveryType, lockerId, exportLocationId, exportWeightId, exportWeightKg }
            : deliveryType || lockerId || exportLocationId || exportWeightId || exportWeightKg
              ? { deliveryType, lockerId, exportLocationId, exportWeightId, exportWeightKg }
              : undefined,
      },
      include: {
        items: true,
      },
    });

    const shouldSaveAddress = Boolean(req.body?.saveAddress);
    if (shouldSaveAddress) {
      await saveAddressIfNew(req.user.id, shippingAddress);
    }

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "customer_order_created",
          entityType: "order",
          entityId: order.id,
          branchId: onlineBranch?.id || null,
          message: "Customer placed online order",
        },
      })
      .catch(() => null);

    if (paymentMethodLower.includes("cash")) {
      const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
      const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
      const { subject, text, html } = buildOrderConfirmationEmail({
        name: req.user.name || "Customer",
        orderId: order.id,
        items: order.items || [],
        total: order.totalPrice || 0,
        paymentMethod: resolvedPaymentMethod,
        createdAt: order.createdAt,
        shippingAddress,
        viewUrl,
      });

      sendBrevoEmail({
        to: req.user.email,
        subject,
        text,
        html,
        senderKey: "orders",
      }).catch((err) => console.error("Order email failed", err));

      if (req.user?.phone) {
        sendOrderStatusWhatsApp({
          to: req.user.phone,
          orderId: order.id,
          status: "Confirmed",
        }).catch((err) => console.error("Order WhatsApp confirmation failed", err));
      }
    }

    const shouldDispatch =
      FEZ_ENABLED &&
      shippingAddress &&
      (req.body?.dispatchNow !== undefined
        ? Boolean(req.body.dispatchNow)
        : FEZ_AUTO_DISPATCH);

    if (shouldDispatch) {
      try {
        const isExport =
          deliveryType === "export" ||
          (shippingAddress?.country || "").toString().trim().toLowerCase() !== "nigeria";

        let fezResult = null;
        if (isExport) {
          if (!exportLocationId) {
            throw new Error("Export location is required");
          }
          const exportPayload = [
            {
              recipientAddress: [shipping.addressLine1, shipping.addressLine2, shipping.city]
                .filter(Boolean)
                .join(", "),
              recipientState: shipping.state || "",
              recipientName: shipping.fullName || req.user.name || "",
              recipientPhone: shipping.phone || req.user.phone || "",
              recipientEmail: req.user.email || "",
              uniqueID: order.id,
              BatchID: order.id,
              valueOfItem: (order.totalPrice || 0).toString(),
              weight: normalizeShippingWeight(req.body?.deliveryWeightKg || exportWeightKg),
              exportLocationId,
            },
          ];
          const exportResponse = await createFezExportOrder(exportPayload);
          const orderNo = extractFezOrderNo(exportResponse, order.id);
          fezResult = { orderNo, raw: exportResponse };
        } else {
          const fezPayloadOrder = {
            id: order.id,
            totalPrice: order.totalPrice,
            paymentMethod: order.paymentMethod,
            shippingAddress,
            user: {
              name: req.user.name,
              email: req.user.email,
              phone: req.user.phone,
            },
          };
          fezResult = await createFezOrder({
            order: fezPayloadOrder,
            context: {
              deliveryWeightKg: req.body?.deliveryWeightKg,
              lockerId,
            },
          });
        }

        if (fezResult?.orderNo) {
          order = await prisma.order.update({
            where: { id: order.id },
            data: {
              deliveryProvider: "FEZ",
              deliveryOrderNo: fezResult.orderNo,
              deliveryStatus: "PENDING_DISPATCH",
              orderStatus: "SHIPPED",
              deliveryMeta: {
                ...(order.deliveryMeta || {}),
                fez: fezResult.raw || undefined,
              },
            },
            include: { items: true },
          });
        }
      } catch (error) {
        console.error("Fez dispatch failed", error);
      }
    }

    res.status(201).json(toLegacyOrder(order));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Get logged in user's orders
// =========================
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: true } },
      },
    });
    res.json(orders.map((order) => toLegacyOrder(order)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Get a single order by ID
// =========================
exports.getOrderById = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { product: true } },
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(toLegacyOrder(order));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Update order (admin or user can update certain fields)
// =========================
exports.updateOrder = async (req, res) => {
  try {
    const { shippingAddress, paymentMethod, orderStatus } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, orderStatus: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const updateData: Record<string, any> = {};
    if (orderStatus && req.user.isAdmin) {
      updateData.orderStatus = legacyOrderStatusToDb(orderStatus);
    }

    if (order.orderStatus !== "DELIVERED") {
      if (shippingAddress) {
        Object.assign(updateData, formatShipping(shippingAddress));
      }
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        items: { include: { product: true } },
      },
    });
    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Get all orders (admin)
// =========================
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true },
        },
        items: { include: { product: true } },
      },
    });
    res.json(orders.map((order) => toLegacyOrder(order)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Get receipt (customer)
// =========================
exports.getReceipt = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        branch: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, title: true, price: true, images: true } },
          },
        },
      },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    await generateReceipt({
      res,
      order: toLegacyOrder(order),
      issuerName: "Online",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Track delivery (customer)
// =========================
exports.trackDelivery = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        userId: true,
        deliveryProvider: true,
        deliveryOrderNo: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!order.deliveryProvider || order.deliveryProvider.toUpperCase() !== "FEZ") {
      return res.status(400).json({ message: "Delivery provider not configured for this order" });
    }
    if (!order.deliveryOrderNo) {
      return res.status(400).json({ message: "No delivery tracking available for this order" });
    }

    const tracking = await trackFezOrder(order.deliveryOrderNo);
    res.json({
      provider: "FEZ",
      orderNo: order.deliveryOrderNo,
      tracking,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Cancel order (customer)
// =========================
exports.cancelOrder = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, orderStatus: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const status = (order.orderStatus || "").toUpperCase();
    if (status === "SHIPPED" || status === "DELIVERED") {
      return res.status(400).json({ message: "Order has already shipped and cannot be cancelled" });
    }

    if (status === "CANCELLED" || status === "RETURNED") {
      const existing = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { product: true } } },
      });
      return res.json(toLegacyOrder(existing));
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { orderStatus: "CANCELLED" },
      include: { items: { include: { product: true } } },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "customer_order_cancelled",
          entityType: "order",
          entityId: updated.id,
          branchId: updated.branchId || null,
          message: "Customer cancelled online order",
        },
      })
      .catch(() => null);

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Rate order (customer)
// =========================
exports.rateOrder = async (req, res) => {
  try {
    const rating = Number(req.body?.rating);
    const note = (req.body?.note || "").toString().trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true, orderStatus: true },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if ((order.orderStatus || "").toUpperCase() !== "DELIVERED") {
      return res.status(400).json({ message: "Only delivered orders can be rated" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        customerRating: rating,
        customerRatingNote: note,
        customerRatedAt: new Date(),
      },
      include: { items: { include: { product: true } } },
    });

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// =========================
// Confirm delivery (customer)
// =========================
exports.confirmDelivery = async (req, res) => {
  try {
    const inputOrderId = (req.body?.orderId || "").toString().trim();
    if (!inputOrderId || inputOrderId !== req.params.id) {
      return res.status(400).json({ message: "Order ID confirmation failed" });
    }

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        items: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    if ((order.orderStatus || "").toUpperCase() === "DELIVERED") {
      return res.json(toLegacyOrder(order));
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { orderStatus: "DELIVERED", deliveryStatus: "DELIVERED" },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
        items: true,
      },
    });

    prisma.activityLog
      .create({
        data: {
          id: newId(),
          userId: req.user.id,
          action: "order_delivered",
          entityType: "order",
          entityId: updated.id,
          branchId: updated.branchId || null,
          message: "Customer confirmed delivery",
        },
      })
      .catch(() => null);

    if (updated.user?.email) {
      const clientUrl = (process.env.CLIENT_URL || "").toString().trim().replace(/\/+$/, "");
      const viewUrl = clientUrl ? `${clientUrl}/dashboard/orders` : null;
      const statusEmail = buildOrderStatusEmail({
        name: updated.user.name || "Customer",
        orderId: updated.id,
        status: "Delivered",
        viewUrl,
      });
      sendBrevoEmail({
        to: updated.user.email,
        subject: statusEmail.subject,
        text: statusEmail.text,
        html: statusEmail.html,
        senderKey: "orders",
      }).catch((err) => console.error("Delivered email failed", err));
    }

    if (updated.user?.phone) {
      sendOrderStatusWhatsApp({
        to: updated.user.phone,
        orderId: updated.id,
        status: "Delivered",
      }).catch((err) => console.error("Delivered WhatsApp failed", err));
    }

    res.json(toLegacyOrder(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
