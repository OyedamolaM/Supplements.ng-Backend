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
  buildOrderStatusEmail,
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
const {
  isChowdeckRelayReady,
  getChowdeckRelayPickupState,
  getChowdeckRelayLocalEta,
  fetchChowdeckDeliveryEstimate,
  createChowdeckDelivery,
  trackChowdeckDelivery,
  extractChowdeckFeeId,
  parseChowdeckDeliveryPrice,
} = require("../services/chowdeckRelayService");
const {
  roundCurrency,
  claimFirstOrderNewsletterDiscount,
} = require("../services/newsletterService");
const {
  searchLocalAddresses,
  resolveLocalAddress,
} = require("../services/localAddressService");

const isProductAvailableForOnlinePurchase = (product) => {
  if (!product || !product.isActiveOnline) return false;
  if (Number(product.quantityAvailable || 0) > 0) return true;
  return (product.branchInventories || []).some(
    (entry) => entry?.branch?.isOnline && Number(entry.quantity || 0) > 0
  );
};

const normalizeAddressValue = (value) =>
  (value || "").toString().trim().toLowerCase();

const normalizeCoordinate = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hasCoordinates = (address: any = {}) =>
  normalizeCoordinate(address?.latitude ?? address?.lat) !== null &&
  normalizeCoordinate(address?.longitude ?? address?.lng ?? address?.lon) !== null;

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
const FEZ_DEFAULT_WEIGHT_KG = Number(process.env.FEZ_DEFAULT_WEIGHT_KG || 1);
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

const parseEstimatedDays = (payload: any) => {
  const candidates = [
    payload?.data?.eta,
    payload?.eta,
    payload?.message,
    payload?.description,
  ]
    .map((value) => (value || "").toString().trim())
    .filter(Boolean);

  for (const value of candidates) {
    const numbers = [...value.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) =>
      Number(match[1])
    );
    if (numbers.length) {
      return Math.max(...numbers);
    }
  }

  return 0;
};

const normalizeEtaUnit = (value: string) => {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized.includes("business")) return "business days";
  if (normalized.includes("working")) return "business days";
  if (normalized.includes("day")) return "business days";
  return "business days";
};

const parseEstimatedDaysRange = (payload: any) => {
  const candidates = [
    payload?.data?.eta,
    payload?.eta,
    payload?.message,
    payload?.description,
  ]
    .map((value) => (value || "").toString().trim())
    .filter(Boolean);

  for (const value of candidates) {
    const rangeMatch = value.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
      const min = rangeMatch[1];
      const max = rangeMatch[2];
      return `${min}-${max} ${normalizeEtaUnit(value)}`;
    }

    const singleMatch = value.match(/(\d+(?:\.\d+)?)/);
    if (singleMatch) {
      const days = singleMatch[1];
      const unit = normalizeEtaUnit(value);
      return `${days} ${days === "1" ? "business day" : unit}`;
    }
  }

  return "";
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

const asObject = (value: any) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeDeliveryType = (value: any) => {
  const normalized = (value || "local").toString().trim().toLowerCase();
  if (normalized === "international") return "export";
  return normalized;
};

const isInternationalCountry = (value: any) => {
  if (!hasText(value)) return false;
  return normalizeAddressValue(value) !== "nigeria";
};

const normalizeDeliveryMode = (value: any, lockerId: any, hubId: any) => {
  if (hasText(lockerId)) return "locker";
  if (hasText(hubId)) return "hub";

  const normalized = (value || "home").toString().trim().toLowerCase();
  if (["pickup", "locker", "hub", "home"].includes(normalized)) {
    return normalized;
  }
  return "home";
};

const getConfiguredPickupState = () =>
  (getChowdeckRelayPickupState() || FEZ_PICKUP_STATE || "").toString().trim();

const buildResolvedAddressMeta = (address: any = {}) => {
  const latitude = normalizeCoordinate(address?.latitude ?? address?.lat);
  const longitude = normalizeCoordinate(address?.longitude ?? address?.lng ?? address?.lon);
  if (latitude === null || longitude === null) return null;
  return {
    addressLine1: (address?.addressLine1 || "").toString().trim(),
    addressLine2: (address?.addressLine2 || "").toString().trim(),
    city: (address?.city || "").toString().trim(),
    state: (address?.state || "").toString().trim(),
    country: (address?.country || "").toString().trim(),
    postalCode: (address?.postalCode || "").toString().trim(),
    formattedAddress: (address?.formattedAddress || "").toString().trim(),
    latitude,
    longitude,
    provider: (address?.addressProvider || address?.provider || "").toString().trim(),
    providerPlaceId: (address?.providerPlaceId || "").toString().trim(),
  };
};

const resolveLocalShippingAddress = async (shippingAddress: any = {}) => {
  if (hasCoordinates(shippingAddress)) {
    return {
      ...shippingAddress,
      latitude: normalizeCoordinate(shippingAddress.latitude ?? shippingAddress.lat),
      longitude: normalizeCoordinate(shippingAddress.longitude ?? shippingAddress.lng ?? shippingAddress.lon),
      formattedAddress: (shippingAddress.formattedAddress || "").toString().trim(),
      addressProvider: (shippingAddress.addressProvider || shippingAddress.provider || "").toString().trim(),
      providerPlaceId: (shippingAddress.providerPlaceId || "").toString().trim(),
    };
  }

  const resolved = await resolveLocalAddress(shippingAddress);
  if (!resolved) {
    return null;
  }

  return {
    ...shippingAddress,
    addressLine1: shippingAddress.addressLine1 || resolved.addressLine1 || "",
    addressLine2: shippingAddress.addressLine2 || resolved.addressLine2 || "",
    city: shippingAddress.city || resolved.city || "",
    state: shippingAddress.state || resolved.state || "",
    country: shippingAddress.country || resolved.country || "Nigeria",
    postalCode: shippingAddress.postalCode || resolved.postalCode || "",
    formattedAddress: resolved.formattedAddress || shippingAddress.formattedAddress || "",
    latitude: normalizeCoordinate(resolved.latitude),
    longitude: normalizeCoordinate(resolved.longitude),
    addressProvider: resolved.provider || shippingAddress.addressProvider || "",
    providerPlaceId: resolved.providerPlaceId || shippingAddress.providerPlaceId || "",
  };
};

const buildShippingAddressFromPayload = (payload: any = {}) => {
  const shippingAddress = asObject(payload?.shippingAddress);
  return {
    fullName:
      payload?.fullName ||
      payload?.recipientName ||
      payload?.name ||
      shippingAddress.fullName ||
      shippingAddress.recipientName ||
      "",
    addressLine1:
      payload?.addressLine1 ||
      payload?.street ||
      payload?.address ||
      shippingAddress.addressLine1 ||
      shippingAddress.street ||
      "",
    addressLine2:
      payload?.addressLine2 ||
      shippingAddress.addressLine2 ||
      "",
    city:
      payload?.city ||
      shippingAddress.city ||
      "",
    state:
      payload?.state ||
      payload?.dropOffState ||
      shippingAddress.state ||
      "",
    country:
      payload?.country ||
      payload?.destinationCountry ||
      shippingAddress.country ||
      "Nigeria",
    postalCode:
      payload?.postalCode ||
      shippingAddress.postalCode ||
      "",
    phone:
      payload?.phone ||
      shippingAddress.phone ||
      "",
    email:
      payload?.email ||
      shippingAddress.email ||
      "",
    formattedAddress:
      payload?.formattedAddress ||
      shippingAddress.formattedAddress ||
      "",
    latitude:
      normalizeCoordinate(
        payload?.latitude ??
          payload?.lat ??
          shippingAddress.latitude ??
          shippingAddress.lat
      ),
    longitude:
      normalizeCoordinate(
        payload?.longitude ??
          payload?.lng ??
          payload?.lon ??
          shippingAddress.longitude ??
          shippingAddress.lng ??
          shippingAddress.lon
      ),
    addressProvider:
      payload?.addressProvider ||
      payload?.provider ||
      shippingAddress.addressProvider ||
      shippingAddress.provider ||
      "",
    providerPlaceId:
      payload?.providerPlaceId ||
      shippingAddress.providerPlaceId ||
      "",
  };
};

const resolveDeliveryLane = ({
  deliveryType,
  destinationType,
  destinationState,
  pickupState,
  destinationCountry,
}: {
  deliveryType?: any;
  destinationType?: any;
  destinationState?: any;
  pickupState?: any;
  destinationCountry?: any;
}) => {
  const normalizedType = normalizeDeliveryType(deliveryType);
  const normalizedDestinationType = (destinationType || "").toString().trim().toLowerCase();
  const normalizedCountry = normalizeLookupValue(destinationCountry || "Nigeria");

  if (
    normalizedType === "export" ||
    normalizedType === "international" ||
    normalizedDestinationType === "overseas" ||
    normalizedCountry !== "nigeria"
  ) {
    return "export";
  }

  const normalizedDestinationState = normalizeLookupValue(destinationState);
  const normalizedPickupState = normalizeLookupValue(pickupState);

  if (normalizedDestinationState && normalizedPickupState) {
    return normalizedDestinationState === normalizedPickupState ? "local" : "interstate";
  }

  if (normalizedDestinationType === "interstate") return "interstate";
  if (normalizedDestinationType === "local") return "local";
  return "local";
};

const isStrictLocalHomeDelivery = ({
  deliveryLane,
  deliveryMode,
}: {
  deliveryLane: string;
  deliveryMode: string;
}) => deliveryLane === "local" && deliveryMode === "home";

const CHOWDECK_LOCAL_UNAVAILABLE_MESSAGE =
  "Local home delivery is temporarily unavailable because Chowdeck is not configured";

const resolveDeliveryProvider = ({
  deliveryLane,
  deliveryMode,
  preferredProvider,
}: {
  deliveryLane: string;
  deliveryMode: string;
  preferredProvider?: any;
}) => {
  const preferred = (preferredProvider || "").toString().trim().toUpperCase();
  if (
    preferred === "CHOWDECK" &&
    isStrictLocalHomeDelivery({ deliveryLane, deliveryMode }) &&
    isChowdeckRelayReady()
  ) {
    return "CHOWDECK";
  }

  if (isStrictLocalHomeDelivery({ deliveryLane, deliveryMode }) && isChowdeckRelayReady()) {
    return "CHOWDECK";
  }

  return "FEZ";
};

const getLocalQuoteValidationError = (shippingAddress: any) => {
  if (!hasText(shippingAddress?.fullName)) return "Recipient full name is required";
  if (!hasText(shippingAddress?.phone)) return "Recipient phone number is required";
  if (!hasText(shippingAddress?.addressLine1)) return "Street address is required";
  if (!hasText(shippingAddress?.city)) return "Destination city is required";
  if (!hasText(shippingAddress?.state)) return "Destination state is required";
  return null;
};

const REFUND_TIMELINE_BUSINESS_DAYS = "3-5 business days";

const buildCancellationPreview = (order: any) => {
  const refundEligible = (order.paymentStatus || "").toUpperCase() === "PAID";
  const refund = refundEligible
    ? {
        eligible: true,
        status: "PENDING",
        amount: roundCurrency(order.totalPrice || 0),
        timeline: REFUND_TIMELINE_BUSINESS_DAYS,
        message:
          "This paid order will be refunded after cancellation. Refunds take 3-5 business days.",
      }
    : null;

  return {
    requiresConfirmation: true,
    orderId: order.id,
    refund,
    message: refundEligible
      ? "Confirm cancellation to stop this order and start the refund process."
      : "Confirm cancellation to stop this order.",
    warning: refundEligible
      ? "This paid order will be cancelled and the refund will take 3-5 business days once processed. Please confirm so this is not done by mistake."
      : "Cancelling this order cannot be undone from the app. Please confirm so this is not done by mistake.",
  };
};

const buildShippingAddressFromOrder = (order: any = {}) => ({
  fullName: order.shippingFullName || "",
  addressLine1: order.shippingAddressLine1 || "",
  addressLine2: order.shippingAddressLine2 || "",
  city: order.shippingCity || "",
  state: order.shippingState || "",
  country: order.shippingCountry || "",
  postalCode: order.shippingPostalCode || "",
  phone: order.shippingPhone || "",
  formattedAddress: order?.deliveryMeta?.resolvedAddress?.formattedAddress || "",
  latitude: order?.deliveryMeta?.resolvedAddress?.latitude ?? null,
  longitude: order?.deliveryMeta?.resolvedAddress?.longitude ?? null,
  addressProvider: order?.deliveryMeta?.resolvedAddress?.provider || "",
  providerPlaceId: order?.deliveryMeta?.resolvedAddress?.providerPlaceId || "",
});

const runDetachedTask = (label: string, task: () => Promise<any>) => {
  const runner = () =>
    Promise.resolve()
      .then(task)
      .catch((error) => console.error(label, error));

  if (typeof setImmediate === "function") {
    setImmediate(runner);
    return;
  }

  void runner();
};

const getDispatchContext = (order: any, overrides: Record<string, any> = {}) => {
  const deliveryMeta = asObject(order?.deliveryMeta);
  const shippingAddress = overrides.shippingAddress || buildShippingAddressFromOrder(order);
  const pickupState = (
    overrides.pickUpState ||
    deliveryMeta.pickUpState ||
    getConfiguredPickupState()
  )
    .toString()
    .trim();
  const requestedDeliveryType = normalizeDeliveryType(
    overrides.deliveryType ||
      deliveryMeta.deliveryType ||
      (isInternationalCountry(shippingAddress?.country) ? "export" : "local")
  );
  const lockerId = overrides.lockerId ?? deliveryMeta.lockerId ?? null;
  const hubId = overrides.hubId ?? deliveryMeta.hubId ?? null;
  const deliveryMode = normalizeDeliveryMode(
    overrides.deliveryMode || deliveryMeta.deliveryMode,
    lockerId,
    hubId
  );
  const deliveryLane = resolveDeliveryLane({
    deliveryType: requestedDeliveryType,
    destinationType: overrides.destinationType || deliveryMeta.destinationType || deliveryMeta.deliveryLane,
    destinationState: shippingAddress?.state,
    pickupState,
    destinationCountry: shippingAddress?.country,
  });
  const deliveryType =
    requestedDeliveryType === "export" &&
    deliveryLane !== "export" &&
    !isInternationalCountry(shippingAddress?.country)
      ? "local"
      : requestedDeliveryType;
  const deliveryProvider = resolveDeliveryProvider({
    deliveryLane,
    deliveryMode,
    preferredProvider:
      overrides.deliveryProvider ||
      deliveryMeta.deliveryProviderPreference ||
      order?.deliveryProvider,
  });
  const deliveryWeightKg = normalizeShippingWeight(
    overrides.deliveryWeightKg ?? deliveryMeta.deliveryWeightKg ?? deliveryMeta.exportWeightKg
  );
  const exportLocationId = overrides.exportLocationId ?? deliveryMeta.exportLocationId ?? null;
  const exportWeightId = overrides.exportWeightId ?? deliveryMeta.exportWeightId ?? null;
  const exportWeightKg = overrides.exportWeightKg ?? deliveryMeta.exportWeightKg ?? null;
  const deliveryFeeId =
    overrides.deliveryFeeId ??
    deliveryMeta.deliveryFeeId ??
    extractChowdeckFeeId(deliveryMeta.shippingQuote) ??
    null;

  return {
    deliveryMeta,
    shippingAddress,
    pickupState,
    deliveryType,
    deliveryMode,
    deliveryLane,
    deliveryProvider,
    lockerId,
    hubId,
    deliveryWeightKg,
    exportLocationId,
    exportWeightId,
    exportWeightKg,
    deliveryFeeId,
  };
};

const dispatchOrderToFez = async (
  order: any,
  overrides: Record<string, any> = {}
) => {
  if (!FEZ_ENABLED || !order?.id || order?.deliveryOrderNo) {
    return null;
  }

  const {
    deliveryMeta,
    shippingAddress,
    pickupState,
    deliveryType,
    deliveryMode,
    deliveryLane,
    lockerId,
    deliveryWeightKg,
  } = getDispatchContext(order, overrides);

  if (!isValidShippingAddress(shippingAddress, deliveryType, lockerId)) {
    return null;
  }

  let exportLocationId = overrides.exportLocationId ?? deliveryMeta.exportLocationId ?? null;
  let exportWeightId = overrides.exportWeightId ?? deliveryMeta.exportWeightId ?? null;
  let exportWeightKg = overrides.exportWeightKg ?? deliveryMeta.exportWeightKg ?? null;

  const user = overrides.user || order.user || {};
  const isExport =
    deliveryLane === "export" ||
    deliveryType === "export" ||
    deliveryType === "international" ||
    isInternationalCountry(shippingAddress?.country);

  let fezResult = null;
  if (isExport) {
    const resolvedExportMeta = await resolveExportMeta({
      country: shippingAddress?.country,
      exportLocationId,
      weightId: exportWeightId,
      weightKg: exportWeightKg ?? deliveryWeightKg,
    });

    exportLocationId = resolvedExportMeta.exportLocationId;
    exportWeightId = resolvedExportMeta.weightId;
    exportWeightKg = resolvedExportMeta.weightKg;

    if (!exportLocationId) {
      throw new Error("Export location is required");
    }

    const exportPayload = [
      {
        recipientAddress: [
          shippingAddress.addressLine1,
          shippingAddress.addressLine2,
          shippingAddress.city,
        ]
          .filter(Boolean)
          .join(", "),
        recipientState: shippingAddress.state || "",
        recipientName: shippingAddress.fullName || user.name || "",
        recipientPhone: shippingAddress.phone || user.phone || "",
        recipientEmail: user.email || "",
        uniqueID: order.id,
        BatchID: order.id,
        valueOfItem: (order.totalPrice || 0).toString(),
        weight: deliveryWeightKg,
        exportLocationId,
      },
    ];
    const exportResponse = await createFezExportOrder(exportPayload);
    fezResult = { orderNo: extractFezOrderNo(exportResponse, order.id), raw: exportResponse };
  } else {
    fezResult = await createFezOrder({
      order: {
        id: order.id,
        totalPrice: order.totalPrice,
        paymentMethod: order.paymentMethod,
        shippingAddress,
        user: {
          name: user.name || "",
          email: user.email || "",
          phone: user.phone || "",
        },
      },
      context: {
        deliveryWeightKg,
        lockerId,
      },
    });
  }

  if (!fezResult?.orderNo) {
    return null;
  }

  return prisma.order.update({
    where: { id: order.id },
    data: {
      deliveryProvider: "FEZ",
      deliveryOrderNo: fezResult.orderNo,
      deliveryStatus: "PENDING_DISPATCH",
      orderStatus: "SHIPPED",
      deliveryMeta: {
        ...deliveryMeta,
        deliveryType,
        deliveryMode,
        deliveryLane,
        pickUpState: pickupState || null,
        deliveryProviderPreference: "FEZ",
        lockerId,
        exportLocationId,
        exportWeightId,
        exportWeightKg,
        deliveryWeightKg,
        fez: fezResult.raw || undefined,
      },
    },
  });
};

const dispatchOrderToChowdeck = async (
  order: any,
  overrides: Record<string, any> = {}
) => {
  if (!order?.id || order?.deliveryOrderNo || !isChowdeckRelayReady()) {
    return null;
  }

  const {
    deliveryMeta,
    shippingAddress,
    pickupState,
    deliveryType,
    deliveryMode,
    deliveryLane,
    deliveryWeightKg,
    deliveryFeeId,
  } = getDispatchContext(order, overrides);

  if (deliveryLane !== "local" || deliveryMode !== "home") {
    return null;
  }

  if (!isValidShippingAddress(shippingAddress, "local", null)) {
    return null;
  }

  if (!deliveryFeeId) {
    throw new Error("Chowdeck delivery fee ID is required before dispatch");
  }

  const user = overrides.user || order.user || {};
  const chowdeckResult = await createChowdeckDelivery({
    order,
    shippingAddress,
    user,
    feeId: deliveryFeeId,
    deliveryNote: overrides.deliveryNote || `Supplements.ng order ${order.id}`,
  });

  return prisma.order.update({
    where: { id: order.id },
    data: {
      deliveryProvider: "CHOWDECK",
      deliveryOrderNo: chowdeckResult.reference || order.id,
      deliveryStatus: chowdeckResult.status || "PENDING_DISPATCH",
      orderStatus: "SHIPPED",
      deliveryTrackingUrl: chowdeckResult.trackingUrl || order.deliveryTrackingUrl || null,
      deliveryMeta: {
        ...deliveryMeta,
        deliveryType,
        deliveryMode,
        deliveryLane,
        pickUpState: pickupState || null,
        deliveryProviderPreference: "CHOWDECK",
        deliveryFeeId,
        deliveryWeightKg,
        chowdeck: chowdeckResult.raw || undefined,
      },
    },
  });
};

const queueOrderDeliveryDispatch = (order: any, overrides: Record<string, any> = {}) => {
  runDetachedTask(`Delivery dispatch failed for order ${order?.id || "unknown"}`, async () => {
    const latestOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true } },
      },
    });

    if (!latestOrder || latestOrder.deliveryOrderNo) {
      return null;
    }

    const dispatchContext = getDispatchContext(latestOrder, overrides);
    if (dispatchContext.deliveryProvider === "CHOWDECK") {
      return dispatchOrderToChowdeck(latestOrder, overrides);
    }

    return dispatchOrderToFez(latestOrder, overrides);
  });
};

exports.queueOrderDeliveryDispatch = queueOrderDeliveryDispatch;
exports.queueOrderFezDispatch = queueOrderDeliveryDispatch;

// =========================
// Search local Lagos delivery addresses
// =========================
exports.searchLocalDeliveryAddresses = async (req, res) => {
  try {
    const query = (req.query?.q || req.query?.query || "").toString().trim();
    if (query.length < 3) {
      return res.status(400).json({ message: "Search query must be at least 3 characters" });
    }

    const results = await searchLocalAddresses(query);
    res.json({ results });
  } catch (error: any) {
    console.error("Local address search failed", {
      message: error?.message,
      status: error?.status,
    });
    res.status(error?.status || 500).json({
      message: "Unable to search Lagos addresses right now",
      error: error?.message || "Local address search failed",
    });
  }
};

// =========================
// Fetch shipping quote (customer/guest)
// =========================
exports.getShippingQuote = async (req, res) => {
  try {
    console.log("🚀 1. Shipping quote request received");

    const payload = req.body || {};
    console.log("📦 Payload:", payload);

    const shippingAddress = buildShippingAddressFromPayload(payload);
    console.log("🏠 2. Shipping address built");

    const pickupState = (payload.pickUpState || getConfiguredPickupState() || "")
      .toString()
      .trim();

    const destinationState = (shippingAddress.state || payload.state || "")
      .toString()
      .trim();

    const locker = payload.locker;
    const hubId = payload.hubId;

    const deliveryMode = normalizeDeliveryMode(
      payload.type || payload.deliveryMode,
      locker,
      hubId
    );

    const deliveryType = normalizeDeliveryType(payload.deliveryType);

    const deliveryLane = resolveDeliveryLane({
      deliveryType,
      destinationType: payload.destinationType,
      destinationState,
      pickupState,
      destinationCountry: shippingAddress.country,
    });

    const normalizedWeight = normalizeShippingWeight(payload.weight);

    console.log("📍 3. Computed delivery lane:", deliveryLane);
    console.log("🚚 Delivery mode:", deliveryMode);

    if (!destinationState) {
      console.log("❌ Missing destination state");
      return res.status(400).json({ message: "Destination state is required" });
    }

    // CHOWDECK availability guard
    if (
      isStrictLocalHomeDelivery({ deliveryLane, deliveryMode }) &&
      !isChowdeckRelayReady()
    ) {
      console.log("⚠️ Chowdeck not ready");
      return res.status(503).json({
        message: CHOWDECK_LOCAL_UNAVAILABLE_MESSAGE,
        provider: "CHOWDECK",
      });
    }

    const provider = resolveDeliveryProvider({
      deliveryLane,
      deliveryMode,
    });

    console.log("🔎 4. Selected provider:", provider);

    /**
     * =========================
     * CHOWDECK FLOW
     * =========================
     */
    if (provider === "CHOWDECK") {
      console.log("🟡 Entering CHOWDECK flow");

      const validationError = getLocalQuoteValidationError(shippingAddress);
      if (validationError) {
        console.log("❌ Validation error:", validationError);
        return res.status(400).json({
          message: validationError,
          hint: "Local Chowdeck quotes require full name, phone, street address, city, and state",
        });
      }

      console.log("✅ Validation passed");

      const resolvedShippingAddress = await resolveLocalShippingAddress(
        shippingAddress
      );

      console.log("📍 5. Address resolved:", resolvedShippingAddress);

      if (!resolvedShippingAddress) {
        console.log("❌ Address resolution failed");
        return res.status(400).json({
          message:
            "Select a verified Lagos delivery address before quoting local delivery",
        });
      }

      console.log("🌐 6. Before Chowdeck API call");

      const estimate = await fetchChowdeckDeliveryEstimate({
        shippingAddress: resolvedShippingAddress,
        customerEmail:
          payload.email || resolvedShippingAddress.email || "",
        reference: payload.reference,
        deliveryNote: payload.deliveryNote,
        estimatedOrderAmount: payload.estimatedOrderAmount,
      });

      console.log("📡 7. After Chowdeck API response:", estimate);

      if (estimate.amount === null) {
        throw new Error("Chowdeck quote did not include a delivery price");
      }

      if (!estimate.feeId) {
        throw new Error("Chowdeck quote did not include a fee ID");
      }

      console.log("📤 8. Sending CHOWDECK response");

      return res.json({
        provider: "CHOWDECK",
        deliveryFeeId: estimate.feeId,
        shippingEta: estimate.eta || getChowdeckRelayLocalEta(),
        data: {
          totalCost: estimate.amount,
          feeId: estimate.feeId,
          eta: estimate.eta || getChowdeckRelayLocalEta(),
          currency: estimate.currency || "NGN",
        },
        quote: estimate.raw,
        meta: {
          state: destinationState,
          city: resolvedShippingAddress.city || null,
          pickUpState: pickupState || null,
          weight: normalizedWeight,
          lane: deliveryLane,
          provider: "CHOWDECK",
          resolvedAddress:
            buildResolvedAddressMeta(resolvedShippingAddress),
        },
      });
    }

    /**
     * =========================
     * FEZ FLOW
     * =========================
     */

    const quotePayload = {
      state: destinationState,
      weight: normalizedWeight,
    };

    if (pickupState) quotePayload.pickUpState = pickupState;
    if (locker !== undefined) quotePayload.locker = Boolean(locker);

    console.log("🟢 FEZ payload:", quotePayload);

    if (!FEZ_READY) {
      console.log("⚠️ FEZ not configured");
      return res.json({
        provider: "FEZ",
        data: { totalCost: 0 },
        warning: "Shipping quote provider not configured",
        meta: {
          state: destinationState,
          pickUpState: pickupState || null,
          weight: normalizedWeight,
          lane: deliveryLane,
          provider: "FEZ",
        },
      });
    }

    console.log("🌐 Calling FEZ API");

    const response = await fetchFezDeliveryCost(quotePayload);

    console.log("📡 FEZ response received");

    return res.json({
      provider: "FEZ",
      ...response,
      meta: {
        state: destinationState,
        pickUpState: pickupState || null,
        weight: normalizedWeight,
        lane: deliveryLane,
        provider: "FEZ",
      },
    });
  } catch (err) {
    const status = Number(
      err?.status ||
        err?.statusCode ||
        (err?.code === "CHOWDECK_TIMEOUT" ? 504 : 500)
    );

    console.error("🔥 Shipping quote failed", {
      status,
      message: err?.message,
      code: err?.code,
      payload:
        typeof err?.payload === "object" && err?.payload
          ? {
              status: err.payload?.status,
              message: err.payload?.message,
            }
          : err?.payload || null,
    });

    return res.status(status).json({
      message:
        status === 504
          ? "Shipping quote request timed out"
          : "Unable to fetch shipping quote",
      error: err.message,
    });
  }
};

// =========================
// Delivery time estimate (customer/guest)
// =========================
exports.getDeliveryTimeEstimate = async (req, res) => {
  try {
    const payload = req.body || {};
    const shippingAddress = buildShippingAddressFromPayload(payload);
    const normalizedType = normalizeDeliveryType(payload.deliveryType);
    const destinationCountryValue = (
      payload.destinationCountry ||
      payload.country ||
      shippingAddress.country ||
      ""
    )
      .toString()
      .trim();
    const pickupState = (payload.pickUpState || getConfiguredPickupState() || "").toString().trim();
    const dropOff = (payload.dropOffState || shippingAddress.state || "").toString().trim();
    const deliveryMode = normalizeDeliveryMode(
      payload.type || payload.deliveryMode,
      payload.lockerId || payload.locker,
      payload.hubId
    );
    const deliveryLane = resolveDeliveryLane({
      deliveryType: normalizedType,
      destinationType: payload.destinationType,
      destinationState: dropOff,
      pickupState,
      destinationCountry: destinationCountryValue || shippingAddress.country,
    });

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

    if (!dropOff) {
      return res.status(400).json({ message: "Drop-off state is required" });
    }

    if (
      resolveDeliveryProvider({
        deliveryLane,
        deliveryMode,
      }) === "CHOWDECK"
    ) {
      const validationError = getLocalQuoteValidationError(shippingAddress);
      if (!validationError) {
        try {
          const estimate = await fetchChowdeckDeliveryEstimate({
            shippingAddress,
            customerEmail: payload.email || shippingAddress.email || "",
            reference: payload.reference,
            deliveryNote: payload.deliveryNote,
            estimatedOrderAmount: payload.estimatedOrderAmount,
          });

          return res.json({
            provider: "CHOWDECK",
            eta: estimate.eta || getChowdeckRelayLocalEta(),
            message: "Local ETA returned by Chowdeck Relay",
            meta: {
              deliveryType: normalizedType,
              deliveryLane,
              destinationState: dropOff,
              pickUpState: pickupState || null,
            },
          });
        } catch (error) {
          console.error("Chowdeck delivery time estimate fallback", error);
        }
      }

      return res.json({
        provider: "CHOWDECK",
        eta: getChowdeckRelayLocalEta(),
        message: "Local ETA is a standard Chowdeck estimate",
        meta: {
          deliveryType: normalizedType,
          deliveryLane,
          destinationState: dropOff,
          pickUpState: pickupState || null,
        },
      });
    }

    const etaPayload = {
      delivery_type: normalizedType,
      pick_up_state: pickupState,
      drop_off_state: dropOff,
    };
    const response = await getFezDeliveryTimeEstimate(etaPayload);
    res.json({ provider: "FEZ", ...response });
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

exports.calculateDelivery = async (req, res) => {
  try {
    const {
      type,
      destinationType,
      hubId,
      lockerId,
      country,
      state,
      city,
      weight,
    } = req.body || {};
    const shippingAddress = buildShippingAddressFromPayload(req.body || {});

    const normalizedType = normalizeDeliveryMode(type, lockerId, hubId);
    const normalizedDestinationType = (destinationType || "local")
      .toString()
      .trim()
      .toLowerCase();
    const normalizedWeight = normalizeShippingWeight(weight);
    const pickupState = (getConfiguredPickupState() || "Lagos").toString().trim();

    if (!["pickup", "locker", "hub", "home"].includes(normalizedType)) {
      return res.status(400).json({ message: "Valid delivery type is required" });
    }

    if (!["local", "interstate", "overseas"].includes(normalizedDestinationType)) {
      return res
        .status(400)
        .json({ message: "Valid destination type is required" });
    }

    if (normalizedType === "pickup") {
      return res.json({
        fee: 0,
        currency: "NGN",
        estimatedDays: 0,
        estimatedDaysRange: "",
        meta: {
          type: normalizedType,
          destinationType: normalizedDestinationType,
          pickupState,
        },
      });
    }

    if (normalizedType === "locker" && !hasText(lockerId)) {
      return res.status(400).json({ message: "Locker selection is required" });
    }

    if (normalizedType === "hub" && !hasText(hubId)) {
      return res.status(400).json({ message: "Pickup hub selection is required" });
    }

    if (normalizedDestinationType === "overseas") {
      if (normalizedType !== "home") {
        return res
          .status(400)
          .json({ message: "Only home delivery supports overseas pricing" });
      }

      const resolvedExportMeta = await resolveExportMeta({
        country,
        weightKg: normalizedWeight,
      });

      if (!resolvedExportMeta.exportLocationId) {
        return res.status(400).json({ message: "Destination country is required" });
      }
      if (!resolvedExportMeta.weightId) {
        return res
          .status(400)
          .json({ message: "Could not resolve export weight band" });
      }

      const exportResponse = await getFezExportDeliveryCost({
        exportLocationId: resolvedExportMeta.exportLocationId,
        weightId: resolvedExportMeta.weightId,
      });

      return res.json({
        fee: roundCurrency(parseShippingFee(exportResponse)),
        currency:
          exportResponse?.currency ||
          exportResponse?.data?.currency ||
          "NGN",
        estimatedDays: 7,
        estimatedDaysRange: "5-7 business days",
        meta: {
          type: normalizedType,
          destinationType: normalizedDestinationType,
          country: country || null,
          city: city || null,
          weight: normalizedWeight,
          exportLocationId: resolvedExportMeta.exportLocationId,
          weightId: resolvedExportMeta.weightId,
        },
      });
    }

    const destinationState =
      (shippingAddress.state || state || "").toString().trim() ||
      (normalizedDestinationType === "local" ? pickupState : "");

    if (!destinationState) {
      return res.status(400).json({ message: "Destination state is required" });
    }

    const deliveryLane = resolveDeliveryLane({
      deliveryType: "local",
      destinationType: normalizedDestinationType,
      destinationState,
      pickupState,
      destinationCountry: shippingAddress.country || country,
    });

    if (
      resolveDeliveryProvider({
        deliveryLane,
        deliveryMode: normalizedType,
      }) === "CHOWDECK"
    ) {
      const localShippingAddress = {
        ...shippingAddress,
        state: destinationState,
        city: shippingAddress.city || city || "",
        country: shippingAddress.country || "Nigeria",
      };
      const validationError = getLocalQuoteValidationError(localShippingAddress);
      if (validationError) {
        return res.status(400).json({
          message: validationError,
          hint: "Local Chowdeck delivery calculation requires full name, phone, street address, city, and state",
        });
      }

      const resolvedLocalShippingAddress = await resolveLocalShippingAddress(localShippingAddress);
      if (!resolvedLocalShippingAddress) {
        return res.status(400).json({
          message: "Select a verified Lagos delivery address before calculating local delivery",
        });
      }

      const estimate = await fetchChowdeckDeliveryEstimate({
        shippingAddress: resolvedLocalShippingAddress,
        customerEmail: req.body?.email || resolvedLocalShippingAddress.email || "",
        reference: req.body?.reference,
        deliveryNote: req.body?.deliveryNote,
        estimatedOrderAmount: req.body?.estimatedOrderAmount,
      });

      if (estimate.amount === null) {
        throw new Error("Chowdeck quote did not include a delivery price");
      }
      if (!estimate.feeId) {
        throw new Error("Chowdeck quote did not include a fee ID");
      }

      const etaValue = estimate.eta || getChowdeckRelayLocalEta();

      return res.json({
        provider: "CHOWDECK",
        fee: roundCurrency(estimate.amount),
        deliveryFeeId: estimate.feeId,
        currency: estimate.currency || "NGN",
        estimatedDays: parseEstimatedDays({ eta: etaValue }),
        estimatedDaysRange: parseEstimatedDaysRange({ eta: etaValue }) || etaValue,
        shippingEta: etaValue,
        meta: {
          type: normalizedType,
          destinationType: deliveryLane,
          state: destinationState,
          city: resolvedLocalShippingAddress.city || null,
          weight: normalizedWeight,
          provider: "CHOWDECK",
          deliveryFeeId: estimate.feeId,
          resolvedAddress: buildResolvedAddressMeta(resolvedLocalShippingAddress),
        },
      });
    }

    const quotePayload: Record<string, any> = {
      state: destinationState,
      pickUpState: pickupState,
      weight: normalizedWeight,
    };

    if (normalizedType === "locker") {
      quotePayload.locker = true;
    }

    const quoteResponse = await fetchFezDeliveryCost(quotePayload);

    let estimatedDays = 0;
    let estimatedDaysRange = "";
    try {
      const etaResponse = await getFezDeliveryTimeEstimate({
        delivery_type: "local",
        pick_up_state: pickupState,
        drop_off_state: destinationState,
      });
      estimatedDays = parseEstimatedDays(etaResponse);
      estimatedDaysRange = parseEstimatedDaysRange(etaResponse);
    } catch (error) {
      console.error("Delivery calculate ETA fallback", error);
      estimatedDays = normalizedDestinationType === "local" ? 1 : 3;
      estimatedDaysRange =
        normalizedDestinationType === "local" ? "1 business day" : "3 business days";
    }

    return res.json({
      fee: roundCurrency(parseShippingFee(quoteResponse)),
      currency:
        quoteResponse?.currency ||
        quoteResponse?.data?.currency ||
        "NGN",
      estimatedDays,
      estimatedDaysRange,
      meta: {
        type: normalizedType,
        destinationType: deliveryLane,
        state: destinationState,
        city: city || null,
        weight: normalizedWeight,
        hubId: hubId || null,
        lockerId: lockerId || null,
        provider: "FEZ",
      },
    });
  } catch (err) {
    console.error("Delivery calculate failed", err);
    const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
    res
      .status(status)
      .json({ message: "Unable to calculate delivery", error: err.message });
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
        formattedAddress: shippingAddress.formattedAddress || "",
        latitude: normalizeCoordinate(shippingAddress.latitude),
        longitude: normalizeCoordinate(shippingAddress.longitude),
        addressProvider: shippingAddress.addressProvider || "",
        providerPlaceId: shippingAddress.providerPlaceId || "",
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
    let shipping = buildShippingAddressFromPayload(shippingAddress || {});
    const deliveryType = normalizeDeliveryType(
      req.body?.deliveryType ||
      (isInternationalCountry(shipping?.country) ? "export" : "local")
    );
    const lockerId = req.body?.lockerId;
    const hubId = req.body?.hubId;
    const pickupState = getConfiguredPickupState();
    const deliveryMode = normalizeDeliveryMode(req.body?.type || req.body?.deliveryMode, lockerId, hubId);
    const deliveryLane = resolveDeliveryLane({
      deliveryType,
      destinationType: req.body?.destinationType,
      destinationState: shipping?.state,
      pickupState,
      destinationCountry: shipping?.country,
    });
    const selectedDeliveryProvider = resolveDeliveryProvider({
      deliveryLane,
      deliveryMode,
      preferredProvider: req.body?.deliveryProvider,
    });

    if (isStrictLocalHomeDelivery({ deliveryLane, deliveryMode }) && !isChowdeckRelayReady()) {
      return res.status(503).json({
        message: CHOWDECK_LOCAL_UNAVAILABLE_MESSAGE,
      });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({ message: "No products in order" });
    }

    const hasShipping = isValidShippingAddress(shipping, deliveryType, lockerId);
    if (!hasShipping) {
      return res.status(400).json({ message: "Shipping address is required" });
    }

    if (selectedDeliveryProvider === "CHOWDECK" && isStrictLocalHomeDelivery({ deliveryLane, deliveryMode })) {
      const resolvedLocalShippingAddress = await resolveLocalShippingAddress(shipping);
      if (!resolvedLocalShippingAddress) {
        return res.status(400).json({
          message: "Select a verified Lagos delivery address before checkout",
        });
      }
      shipping = resolvedLocalShippingAddress;
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
    const deliveryWeightKg = normalizeShippingWeight(req.body?.deliveryWeightKg ?? exportWeightKg);
    const deliveryFeeId =
      req.body?.deliveryFeeId ||
      extractChowdeckFeeId(req.body?.shippingQuote) ||
      null;
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
    if (selectedDeliveryProvider === "CHOWDECK" && !deliveryFeeId) {
      return res.status(400).json({
        message: "Local Chowdeck deliveries require a delivery estimate before checkout",
      });
    }

    const resolvedShippingFee =
      req.body?.shippingFee !== undefined && req.body?.shippingFee !== null && req.body?.shippingFee !== ""
        ? parseShippingFee(req.body?.shippingFee)
        : selectedDeliveryProvider === "CHOWDECK"
          ? parseChowdeckDeliveryPrice(shippingQuote)
          : parseShippingFee(shippingQuote);

    if (selectedDeliveryProvider === "CHOWDECK" && resolvedShippingFee === null) {
      return res.status(400).json({
        message: "Local Chowdeck deliveries require a valid shipping quote before checkout",
      });
    }

    const shippingFee = roundCurrency(resolvedShippingFee ?? 0);
    const onlineBranch = await prisma.branch.findFirst({
      where: { isOnline: true },
      select: { id: true },
    });
    const normalizedUserEmail = (req.user.email || "").toString().trim().toLowerCase();
    const resolvedAddressMeta = buildResolvedAddressMeta(shipping);
    const baseDeliveryMeta = shippingQuote
      ? {
          shippingQuote,
          shippingFee,
          shippingEta,
          deliveryType,
          deliveryMode,
          deliveryLane,
          deliveryProviderPreference: selectedDeliveryProvider,
          pickUpState: pickupState || null,
          lockerId,
          hubId,
          deliveryFeeId,
          exportLocationId,
          exportWeightId,
          exportWeightKg,
          deliveryWeightKg,
          resolvedAddress: resolvedAddressMeta,
        }
      : shippingFee || shippingEta
        ? {
            shippingFee,
            shippingEta,
            deliveryType,
            deliveryMode,
            deliveryLane,
            deliveryProviderPreference: selectedDeliveryProvider,
            pickUpState: pickupState || null,
            lockerId,
            hubId,
            deliveryFeeId,
            exportLocationId,
            exportWeightId,
            exportWeightKg,
            deliveryWeightKg,
            resolvedAddress: resolvedAddressMeta,
          }
        : deliveryType ||
            lockerId ||
            hubId ||
            exportLocationId ||
            exportWeightId ||
            exportWeightKg ||
            deliveryWeightKg ||
            deliveryLane ||
            selectedDeliveryProvider
          ? {
              deliveryType,
              deliveryMode,
              deliveryLane,
              deliveryProviderPreference: selectedDeliveryProvider,
              pickUpState: pickupState || null,
              lockerId,
              hubId,
              deliveryFeeId,
              exportLocationId,
              exportWeightId,
              exportWeightKg,
              deliveryWeightKg,
              resolvedAddress: resolvedAddressMeta,
            }
          : undefined;

    let order = await prisma.$transaction(async (tx) => {
      const orderId = newId();
      const newsletterDiscount = await claimFirstOrderNewsletterDiscount(tx, {
        userId: req.user.id,
        email: normalizedUserEmail,
        subtotal,
        orderId,
      });
      const discountAmount = roundCurrency(newsletterDiscount.discountAmount || 0);
      const totalPrice = roundCurrency(
        Math.max(0, subtotal + taxAmount + (shippingFee || 0) - discountAmount)
      );
      const deliveryMeta =
        newsletterDiscount.eligible && discountAmount > 0
          ? {
              ...(baseDeliveryMeta || {}),
              promotion: {
                type: "NEWSLETTER_FIRST_ORDER",
                percent: newsletterDiscount.discountPercent,
              },
            }
          : baseDeliveryMeta;

      const createdOrder = await tx.order.create({
        data: {
          id: orderId,
          userId: req.user.id,
          branchId: onlineBranch?.id || null,
          originBranchId: onlineBranch?.id || null,
          deliveryProvider: selectedDeliveryProvider,
          paymentMethod: resolvedPaymentMethod,
          deliveryStatus: paymentMethodLower.includes("cash") ? "CONFIRMED" : undefined,
          subtotal,
          taxAmount,
          discountAmount,
          totalPrice,
          ...formatShipping(shipping),
          items: { create: orderProducts },
          deliveryMeta,
        },
        include: {
          items: true,
        },
      });

      return createdOrder;
    });

    const shouldSaveAddress = Boolean(req.body?.saveAddress);
    if (shouldSaveAddress) {
      await saveAddressIfNew(req.user.id, shipping);
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
        shippingAddress: shipping,
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
      (selectedDeliveryProvider === "CHOWDECK" ? isChowdeckRelayReady() : FEZ_ENABLED) &&
      shipping &&
      (req.body?.dispatchNow !== undefined
        ? Boolean(req.body.dispatchNow)
        : FEZ_AUTO_DISPATCH);

    if (shouldDispatch && paymentMethodLower.includes("cash")) {
      queueOrderDeliveryDispatch(order, {
        shippingAddress: shipping,
        deliveryType,
        deliveryMode,
        deliveryLane,
        deliveryProvider: selectedDeliveryProvider,
        pickUpState: pickupState,
        deliveryWeightKg,
        lockerId,
        hubId,
        deliveryFeeId,
        exportLocationId,
        exportWeightId,
        exportWeightKg,
        user: req.user,
      });
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

    const deliveryProvider = (order.deliveryProvider || "").toString().trim().toUpperCase();
    if (!deliveryProvider) {
      return res.status(400).json({ message: "Delivery provider not configured for this order" });
    }
    if (!["FEZ", "CHOWDECK"].includes(deliveryProvider)) {
      return res.status(400).json({ message: "Delivery tracking is not supported for this order" });
    }
    if (!order.deliveryOrderNo) {
      return res.status(400).json({ message: "No delivery tracking available for this order" });
    }

    const tracking =
      deliveryProvider === "CHOWDECK"
        ? await trackChowdeckDelivery(order.deliveryOrderNo)
        : await trackFezOrder(order.deliveryOrderNo);
    res.json({
      provider: deliveryProvider,
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
      select: {
        id: true,
        userId: true,
        branchId: true,
        orderStatus: true,
        paymentStatus: true,
        totalPrice: true,
        deliveryStatus: true,
        deliveryMeta: true,
      },
    });
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "Access denied" });
    }

    const status = (order.orderStatus || "").toUpperCase();
    const deliveryStatus = (order.deliveryStatus || "").toUpperCase();
    if (
      status === "SHIPPED" ||
      status === "DELIVERED" ||
      deliveryStatus === "IN_TRANSIT" ||
      deliveryStatus === "DELIVERED"
    ) {
      return res.status(400).json({
        message: "Order has already been dispatched and cannot be cancelled online",
      });
    }

    if (status === "CANCELLED" || status === "RETURNED") {
      const existing = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { product: true } } },
      });
      return res.json(toLegacyOrder(existing));
    }

    const confirmCancellation =
      req.body?.confirmCancellation === true || req.body?.confirmCancellation === "true";
    if (!confirmCancellation) {
      return res.status(200).json(buildCancellationPreview(order));
    }

    const now = new Date();
    const existingDeliveryMeta = asObject(order.deliveryMeta);
    const refundEligible = (order.paymentStatus || "").toUpperCase() === "PAID";
    const nextDeliveryMeta = {
      ...existingDeliveryMeta,
      cancellation: {
        confirmed: true,
        cancelledAt: now.toISOString(),
        cancelledBy: "customer",
      },
      ...(refundEligible
        ? {
            refund: {
              status: "PENDING",
              requestedAt: now.toISOString(),
              amount: roundCurrency(order.totalPrice || 0),
              timeline: REFUND_TIMELINE_BUSINESS_DAYS,
              reason: "Customer cancelled order before delivery",
            },
          }
        : {}),
    };

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        orderStatus: "CANCELLED",
        deliveryStatus: "CANCELLED",
        deliveryMeta: nextDeliveryMeta,
      },
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
          meta: refundEligible
            ? {
                refundStatus: "PENDING",
                refundTimeline: REFUND_TIMELINE_BUSINESS_DAYS,
              }
            : undefined,
        },
      })
      .catch(() => null);

    if (refundEligible) {
      prisma.activityLog
        .create({
          data: {
            id: newId(),
            userId: req.user.id,
            action: "refund_requested",
            entityType: "order",
            entityId: updated.id,
            branchId: updated.branchId || null,
            message: "Refund pending after customer cancellation",
            meta: {
              amount: roundCurrency(order.totalPrice || 0),
              timeline: REFUND_TIMELINE_BUSINESS_DAYS,
            },
          },
        })
        .catch(() => null);
    }

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
