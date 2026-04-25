const FEZ_BASE_URL =
  (process.env.FEZ_BASE_URL || "https://apisandbox.fezdelivery.co/v1")
    .toString()
    .trim()
    .replace(/\/+$/, "");
const FEZ_USER_ID = (process.env.FEZ_USER_ID || "").toString().trim();
const FEZ_PASSWORD = (process.env.FEZ_PASSWORD || "").toString().trim();
const FEZ_ORDER_CREATE_PATH = (process.env.FEZ_ORDER_CREATE_PATH || "/order")
  .toString()
  .trim();
const FEZ_ORDER_TRACK_PATH = (process.env.FEZ_ORDER_TRACK_PATH || "/order/track")
  .toString()
  .trim();
const FEZ_DEFAULT_WEIGHT_KG = Number(process.env.FEZ_DEFAULT_WEIGHT_KG || 1);
const FEZ_FRAGILE_DEFAULT = (process.env.FEZ_FRAGILE_DEFAULT || "false")
  .toString()
  .trim()
  .toLowerCase() === "true";
const FEZ_THIRD_PARTY_SENDER = (process.env.FEZ_THIRD_PARTY_SENDER || "false")
  .toString()
  .trim()
  .toLowerCase() === "true";
const FEZ_SENDER_NAME = (process.env.FEZ_SENDER_NAME || "").toString().trim();
const FEZ_SENDER_ADDRESS = (process.env.FEZ_SENDER_ADDRESS || "").toString().trim();
const FEZ_SENDER_PHONE = (process.env.FEZ_SENDER_PHONE || "").toString().trim();

let cachedToken: {
  token: string | null;
  secretKey: string | null;
  expiresAt: number | null;
} = {
  token: null,
  secretKey: null,
  expiresAt: null,
};

const parseExpiry = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  const raw = value.toString().trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 2_000_000_000 ? numeric : numeric * 1000;
  }
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (match) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    const ts = new Date(iso).getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const extractSecretKey = (payload: any) => {
  if (!payload) return null;
  return (
    payload?.secretKey ||
    payload?.secret_key ||
    payload?.secret ||
    payload?.["secret-key"] ||
    payload?.orgDetails?.secretKey ||
    payload?.orgDetails?.secret_key ||
    payload?.orgDetails?.["secret-key"] ||
    null
  );
};

const extractToken = (payload: any) =>
  payload?.authToken ||
  payload?.authDetails?.authToken ||
  payload?.authDetails?.token ||
  payload?.token ||
  payload?.accessToken ||
  payload?.data?.authToken ||
  payload?.data?.authDetails?.authToken ||
  payload?.data?.authDetails?.token ||
  payload?.data?.token ||
  null;

const extractExpiry = (payload: any) =>
  parseExpiry(payload?.expireToken) ||
  parseExpiry(payload?.authDetails?.expireToken) ||
  parseExpiry(payload?.expiresAt) ||
  parseExpiry(payload?.data?.expireToken) ||
  parseExpiry(payload?.data?.authDetails?.expireToken) ||
  null;

const authenticateFez = async () => {
  if (!FEZ_USER_ID || !FEZ_PASSWORD) {
    return null;
  }

  const response = await fetch(`${FEZ_BASE_URL}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: FEZ_USER_ID, password: FEZ_PASSWORD }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Fez auth failed: ${body || response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  const token = extractToken(data);
  if (!token) {
    throw new Error("Fez auth failed: missing auth token");
  }
  const secretKey = extractSecretKey(data) || cachedToken.secretKey;
  if (!secretKey) {
    throw new Error("Fez auth failed: missing secret key");
  }
  const expiresAt = extractExpiry(data);
  cachedToken = {
    token: token || null,
    secretKey: secretKey || null,
    expiresAt,
  };
  return cachedToken;
};

const getAuthContext = async () => {
  const now = Date.now();
  if (
    cachedToken.token &&
    (!cachedToken.expiresAt || cachedToken.expiresAt > now + 60 * 1000)
  ) {
    return cachedToken;
  }

  if (FEZ_USER_ID && FEZ_PASSWORD) {
    return authenticateFez();
  }

  throw new Error("Fez credentials missing: set FEZ_USER_ID and FEZ_PASSWORD");
};

const buildHeaders = async () => {
  const auth = await getAuthContext();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!auth?.token) {
    throw new Error("Fez auth token missing");
  }
  if (!auth?.secretKey) {
    throw new Error("Fez secret key missing");
  }
  headers.Authorization = `Bearer ${auth.token}`;
  headers["secret-key"] = auth.secretKey;
  return headers;
};

const requestFez = async (path: string, options: RequestInit = {}) => {
  const headers = await buildHeaders();
  const response = await fetch(`${FEZ_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string" && data ? data : `Fez request failed (${response.status})`
    );
    (error as any).status = response.status;
    (error as any).payload = data;
    throw error;
  }
  return data;
};

const normalizeWeight = (value: any) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return FEZ_DEFAULT_WEIGHT_KG || 1;
};

const normalizeText = (value: any) => {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
};

const normalizeLookupValue = (value: any) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const extractStateId = (state: any) =>
  state?.id || state?.stateId || state?.state_id || state?.code || null;

const extractStateLabel = (state: any) =>
  state?.state || state?.name || state?.label || state?.title || "";

const resolveCreatePath = () => {
  if (!FEZ_ORDER_CREATE_PATH.startsWith("/")) {
    return `/${FEZ_ORDER_CREATE_PATH}`;
  }
  return FEZ_ORDER_CREATE_PATH;
};

const resolveTrackPath = (orderNumber: string) => {
  if (!orderNumber) return null;
  const basePath = FEZ_ORDER_TRACK_PATH || "/order/track";
  if (basePath.includes(":orderNumber")) {
    return basePath.replace(":orderNumber", encodeURIComponent(orderNumber));
  }
  if (basePath.endsWith("/")) {
    return `${basePath}${encodeURIComponent(orderNumber)}`;
  }
  return `${basePath}/${encodeURIComponent(orderNumber)}`;
};

const extractOrderNumber = (payload: any, uniqueId: string) => {
  if (!payload) return null;
  if (payload?.orderNumber) return payload.orderNumber;
  if (payload?.orderNo) return payload.orderNo;
  if (payload?.orderNo?.[uniqueId]) return payload.orderNo[uniqueId];
  if (payload?.orderNos?.[uniqueId]) return payload.orderNos[uniqueId];
  if (payload?.data?.orderNos?.[uniqueId]) return payload.data.orderNos[uniqueId];
  if (payload?.Response?.[uniqueId]) return payload.Response[uniqueId];
  if (Array.isArray(payload?.Response) && payload.Response.length) {
    return payload.Response[0]?.orderNo || payload.Response[0]?.orderNumber;
  }
  return null;
};

const buildFezOrderPayload = (order: any, context: any = {}) => {
  const shipping = order?.shippingAddress || {};
  const pickupState = (process.env.FEZ_PICKUP_STATE || "").toString().trim();
  const pickupAddress = (process.env.FEZ_PICKUP_ADDRESS || "").toString().trim();
  const weight = normalizeWeight(context?.deliveryWeightKg || context?.weight);
  const paymentMethod = (order?.paymentMethod || "").toString().toLowerCase();
  const isCod = paymentMethod.includes("cash") || paymentMethod.includes("cod");
  const valueOfItem = Number(order?.totalPrice || 0);
  const custToken = context?.custToken || context?.customerToken;
  const waybillNumber = context?.waybillNumber;
  const pickUpDate = context?.pickUpDate;
  const lockerID = context?.lockerID || context?.lockerId;
  const batchId = context?.batchId || order?.id;
  const additionalDetails = context?.additionalDetails || "";
  const itemDescription = context?.itemDescription || "Supplements.ng order";

  const contextThirdParty = Boolean(context?.thirdparty || context?.thirdParty);
  const contextSenderName = context?.senderName || context?.sender_name;
  const contextSenderAddress = context?.senderAddress || context?.sender_address;
  const contextSenderPhone = context?.senderPhone || context?.sender_phone;

  const senderOverrides =
    (contextThirdParty && (contextSenderName || contextSenderAddress || contextSenderPhone)) ||
    (FEZ_THIRD_PARTY_SENDER && (FEZ_SENDER_NAME || FEZ_SENDER_ADDRESS || FEZ_SENDER_PHONE))
      ? {
          thirdparty: "true",
          senderName: contextSenderName || FEZ_SENDER_NAME || undefined,
          senderAddress: contextSenderAddress || FEZ_SENDER_ADDRESS || undefined,
          senderPhone: contextSenderPhone || FEZ_SENDER_PHONE || undefined,
        }
      : {};

  const recipientAddress = [shipping.addressLine1, shipping.addressLine2, shipping.city]
    .map(normalizeText)
    .filter(Boolean)
    .join(", ");

  return {
    recipientAddress,
    recipientState: shipping.state || "",
    recipientName: shipping.fullName || order?.user?.name || "",
    recipientPhone: shipping.phone || order?.user?.phone || "",
    recipientEmail: order?.user?.email || "",
    uniqueID: order?.id,
    BatchID: batchId,
    CustToken: custToken || undefined,
    itemDescription,
    additionalDetails,
    valueOfItem: valueOfItem ? valueOfItem.toString() : "0",
    weight,
    pickUpState: pickupState || undefined,
    pickUpAddress: pickupAddress || undefined,
    waybillNumber: waybillNumber || undefined,
    pickUpDate: pickUpDate || undefined,
    isItemCod: isCod,
    cashOnDeliveryAmount: isCod ? valueOfItem : undefined,
    fragile: context?.fragile ?? FEZ_FRAGILE_DEFAULT,
    lockerID: lockerID || undefined,
    ...senderOverrides,
  };
};

type FezOrderContext = {
  batch?: any[];
  batchId?: string;
  [key: string]: any;
};

exports.createFezOrder = async ({ order, context = {} as FezOrderContext }: { order: any; context?: FezOrderContext }) => {
  if (!order?.id) throw new Error("Order payload is required for Fez");

  const body = buildFezOrderPayload(order, context);
  if (!body.recipientAddress && !body.lockerID) {
    throw new Error("Recipient address is required for Fez dispatch");
  }
  const payload = Array.isArray(context?.batch)
    ? context.batch.map((entry) => buildFezOrderPayload(entry, { ...context, batchId: context?.batchId }))
    : [body];

  const response = await requestFez(resolveCreatePath(), {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const orderNo = extractOrderNumber(response, order.id);

  return { orderNo, raw: response };
};

exports.trackFezOrder = async (orderNumber: string) => {
  const path = resolveTrackPath(orderNumber);
  if (!path) throw new Error("Order number is required");
  const response = await requestFez(path, { method: "GET" });
  return response;
};

exports.fetchFezDeliveryCost = async (payload: any) => {
  return requestFez("/order/cost", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.createFezOrderFromPayload = async (payload: any) => {
  if (!payload) throw new Error("Fez order payload is required");
  return requestFez("/order", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.updateFezOrder = async (payload: any) => {
  if (!payload) throw new Error("Fez update payload is required");
  return requestFez("/order", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};

exports.deleteFezOrder = async (payload: any) => {
  if (!payload) throw new Error("Fez delete payload is required");
  return requestFez("/order", {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
};

exports.getFezOrder = async (orderId: string) => {
  if (!orderId) throw new Error("Order ID is required");
  return requestFez(`/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
};

exports.searchFezOrders = async (payload: any) => {
  return requestFez("/orders/search", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
};

exports.searchFezOrderByWaybill = async (waybillNumber: string) => {
  if (!waybillNumber) throw new Error("Waybill number is required");
  return requestFez(`/orders/search/${encodeURIComponent(waybillNumber)}`, {
    method: "GET",
  });
};

exports.getFezOrderStatsWithDateRange = async (payload: any) => {
  return requestFez("/orders/statsWithDateRange", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
};

exports.getFezDeliveryTimeEstimate = async (payload: any) => {
  return requestFez("/delivery-time-estimate", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
};

exports.getFezPickupHubs = async (stateId: string) => {
  if (!stateId) throw new Error("State ID is required");
  let resolvedStateId = stateId.toString().trim();

  if (!/^\d+$/.test(resolvedStateId)) {
    const statesPayload = await requestFez("/states", { method: "GET" });
    const states =
      statesPayload?.states ||
      statesPayload?.data?.states ||
      statesPayload?.data ||
      [];

    const normalizedInput = normalizeLookupValue(resolvedStateId);
    const matchedState = (Array.isArray(states) ? states : []).find((entry: any) => {
      const label = normalizeLookupValue(extractStateLabel(entry));
      return label === normalizedInput || label.includes(normalizedInput);
    });

    const matchedStateId = extractStateId(matchedState);
    if (!matchedStateId) {
      const error = new Error("Valid FEZ state ID is required");
      (error as any).status = 400;
      throw error;
    }

    resolvedStateId = matchedStateId.toString().trim();
  }

  return requestFez(`/hubs/${encodeURIComponent(resolvedStateId)}`, { method: "GET" });
};

exports.getFezStates = async () => {
  return requestFez("/states", { method: "GET" });
};

exports.getFezLockersByState = async (state: string) => {
  if (!state) throw new Error("State is required");
  return requestFez(`/Lockers/${encodeURIComponent(state)}`, { method: "GET" });
};

exports.createFezImportOrder = async (payload: any) => {
  if (!payload) throw new Error("Fez import payload is required");
  return requestFez("/orders/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.createFezExportOrder = async (payload: any) => {
  if (!payload) throw new Error("Fez export payload is required");
  return requestFez("/orders/export", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.getFezImportDeliveryCost = async (payload: any) => {
  return requestFez("/orders/import-price", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
};

exports.getFezExportDeliveryCost = async (payload: any) => {
  return requestFez("/orders/export-price", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
};

exports.getFezImportLocations = async () => {
  return requestFez("/orders/import-locations", { method: "GET" });
};

exports.getFezExportLocations = async () => {
  return requestFez("/orders/export-locations", { method: "GET" });
};

exports.getFezImportItemCategories = async () => {
  return requestFez("/orders/item-categories", { method: "GET" });
};

exports.createFezUser = async (payload: any) => {
  if (!payload) throw new Error("Fez user payload is required");
  return requestFez("/user", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.getFezUsers = async () => {
  return requestFez("/users", { method: "GET" });
};

exports.registerFezOrderWebhook = async (payload: { webhook: string }) => {
  if (!payload?.webhook) throw new Error("Webhook URL is required");
  return requestFez("/webhooks/store", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.checkFezLockerAvailability = async (lockerId: string) => {
  if (!lockerId) throw new Error("Locker ID is required");
  return requestFez(`/LockerAvailability/${encodeURIComponent(lockerId)}`, {
    method: "GET",
  });
};

exports.deleteFezUser = async (userId: string) => {
  if (!userId) throw new Error("User ID is required");
  return requestFez(`/user/${encodeURIComponent(userId)}/delete`, {
    method: "POST",
  });
};

exports.logoutFez = async (payload: { user_id?: string } = {}) => {
  return requestFez("/user/logout", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.changeFezPassword = async (payload: {
  user_id: string;
  oldPassword: string;
  newPassword: string;
}) => {
  return requestFez("/user/changePassword", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

exports.authenticateFez = async () => {
  return authenticateFez();
};
