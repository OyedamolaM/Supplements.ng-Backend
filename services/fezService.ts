const FEZ_BASE_URL =
  (process.env.FEZ_BASE_URL || "https://apisandbox.fezdelivery.co/v1")
    .toString()
    .trim()
    .replace(/\/+$/, "");
const FEZ_AUTH_TOKEN = (process.env.FEZ_AUTH_TOKEN || "").toString().trim();
const FEZ_SECRET_KEY = (process.env.FEZ_SECRET_KEY || "").toString().trim();
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
  token: FEZ_AUTH_TOKEN || null,
  secretKey: FEZ_SECRET_KEY || null,
  expiresAt: null,
};

const parseExpiry = (value: unknown) => {
  if (!value) return null;
  const parsed = new Date(value as any).getTime();
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
  payload?.token ||
  payload?.accessToken ||
  payload?.data?.authToken ||
  payload?.data?.token ||
  null;

const extractExpiry = (payload: any) =>
  parseExpiry(payload?.expireToken) ||
  parseExpiry(payload?.expiresAt) ||
  parseExpiry(payload?.data?.expireToken) ||
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
  const secretKey = extractSecretKey(data) || cachedToken.secretKey;
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
  if (cachedToken.token && cachedToken.expiresAt && cachedToken.expiresAt > now + 60 * 1000) {
    return cachedToken;
  }

  if (FEZ_AUTH_TOKEN) {
    cachedToken = {
      token: FEZ_AUTH_TOKEN,
      secretKey: cachedToken.secretKey || FEZ_SECRET_KEY || null,
      expiresAt: cachedToken.expiresAt,
    };
    return cachedToken;
  }

  if (FEZ_USER_ID && FEZ_PASSWORD) {
    return authenticateFez();
  }

  return cachedToken;
};

const buildHeaders = async () => {
  const auth = await getAuthContext();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth?.secretKey || FEZ_SECRET_KEY) {
    headers["secret-key"] = auth?.secretKey || FEZ_SECRET_KEY;
  }
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

const buildFezOrderPayload = (order, context = {}) => {
  const shipping = order?.shippingAddress || {};
  const pickupState = (process.env.FEZ_PICKUP_STATE || "").toString().trim();
  const pickupAddress = (process.env.FEZ_PICKUP_ADDRESS || "").toString().trim();
  const weight = normalizeWeight(context?.deliveryWeightKg || context?.weight);
  const paymentMethod = (order?.paymentMethod || "").toString().toLowerCase();
  const isCod = paymentMethod.includes("cash") || paymentMethod.includes("cod");
  const valueOfItem = Number(order?.totalPrice || 0);

  const senderOverrides =
    FEZ_THIRD_PARTY_SENDER &&
    (FEZ_SENDER_NAME || FEZ_SENDER_ADDRESS || FEZ_SENDER_PHONE)
      ? {
          thirdparty: "true",
          senderName: FEZ_SENDER_NAME || undefined,
          senderAddress: FEZ_SENDER_ADDRESS || undefined,
          senderPhone: FEZ_SENDER_PHONE || undefined,
        }
      : {};

  return {
    recipientAddress: [shipping.addressLine1, shipping.addressLine2, shipping.city]
      .filter(Boolean)
      .join(", "),
    recipientState: shipping.state || "",
    recipientName: shipping.fullName || order?.user?.name || "",
    recipientPhone: shipping.phone || order?.user?.phone || "",
    recipientEmail: order?.user?.email || "",
    uniqueID: order?.id,
    BatchID: order?.id,
    itemDescription: context?.itemDescription || "Supplements.ng order",
    additionalDetails: context?.additionalDetails || "",
    valueOfItem: valueOfItem ? valueOfItem.toString() : "0",
    weight,
    pickUpState: pickupState || undefined,
    pickUpAddress: pickupAddress || undefined,
    isItemCod: isCod,
    cashOnDeliveryAmount: isCod ? valueOfItem : undefined,
    fragile: context?.fragile ?? FEZ_FRAGILE_DEFAULT,
    ...senderOverrides,
  };
};

exports.createFezOrder = async ({ order, context = {} }) => {
  if (!order?.id) throw new Error("Order payload is required for Fez");

  const body = buildFezOrderPayload(order, context);
  const payload = Array.isArray(context?.batch)
    ? context.batch
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
