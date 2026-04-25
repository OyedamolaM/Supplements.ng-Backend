const CHOWDECK_RELAY_ENABLED = (process.env.CHOWDECK_RELAY_ENABLED || "false")
  .toString()
  .trim()
  .toLowerCase() === "true";
const CHOWDECK_RELAY_BASE_URL = (
  process.env.CHOWDECK_RELAY_BASE_URL || "https://api.chowdeck.com"
)
  .toString()
  .trim()
  .replace(/\/+$/, "");
const CHOWDECK_RELAY_API_KEY = (process.env.CHOWDECK_RELAY_API_KEY || "").toString().trim();
const CHOWDECK_RELAY_MERCHANT_REFERENCE = (
  process.env.CHOWDECK_RELAY_MERCHANT_REFERENCE || ""
)
  .toString()
  .trim();
const CHOWDECK_RELAY_ESTIMATE_PATH = (process.env.CHOWDECK_RELAY_ESTIMATE_PATH || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_CREATE_PATH = (
  process.env.CHOWDECK_RELAY_CREATE_PATH || "/merchant/{merchantReference}/delivery"
)
  .toString()
  .trim();
const CHOWDECK_RELAY_TRACK_PATH = (
  process.env.CHOWDECK_RELAY_TRACK_PATH || "/merchant/delivery/{reference}"
)
  .toString()
  .trim();
const CHOWDECK_RELAY_AMOUNT_IN_MINOR_UNIT = (
  process.env.CHOWDECK_RELAY_AMOUNT_IN_MINOR_UNIT || "true"
)
  .toString()
  .trim()
  .toLowerCase() === "true";
const CHOWDECK_RELAY_PICKUP_NAME = (process.env.CHOWDECK_RELAY_PICKUP_NAME || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_PHONE = (process.env.CHOWDECK_RELAY_PICKUP_PHONE || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_EMAIL = (process.env.CHOWDECK_RELAY_PICKUP_EMAIL || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_STREET = (process.env.CHOWDECK_RELAY_PICKUP_STREET || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_CITY = (process.env.CHOWDECK_RELAY_PICKUP_CITY || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_STATE = (process.env.CHOWDECK_RELAY_PICKUP_STATE || "")
  .toString()
  .trim();
const CHOWDECK_RELAY_PICKUP_COUNTRY = (
  process.env.CHOWDECK_RELAY_PICKUP_COUNTRY || "Nigeria"
)
  .toString()
  .trim();
const CHOWDECK_RELAY_ITEM_TYPE = (process.env.CHOWDECK_RELAY_ITEM_TYPE || "supplements")
  .toString()
  .trim();
const CHOWDECK_RELAY_LOCAL_ETA = (
  process.env.CHOWDECK_RELAY_LOCAL_ETA || "Same-day delivery"
)
  .toString()
  .trim();

const hasText = (value: any) => Boolean((value || "").toString().trim());

const normalizeText = (value: any) => (value || "").toString().trim();

const normalizeStreet = (address: any = {}) =>
  [address?.addressLine1 || address?.street, address?.addressLine2]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(", ");

const splitName = (fullName: any) => {
  const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Customer", lastName: "Order" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "Order" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
};

const asArray = (value: any) => (Array.isArray(value) ? value : []);

const pickFirst = (...values: any[]) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const withLeadingSlash = (value: string) => {
  if (!value) return value;
  return value.startsWith("/") ? value : `/${value}`;
};

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const toMinorCurrencyAmount = (value: any) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return CHOWDECK_RELAY_AMOUNT_IN_MINOR_UNIT ? Math.round(parsed * 100) : roundAmount(parsed);
};

const fromCurrencyAmount = (value: any) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!CHOWDECK_RELAY_AMOUNT_IN_MINOR_UNIT) return roundAmount(parsed);
  return roundAmount(parsed / 100);
};

const interpolatePath = (template: string, values: Record<string, any>) =>
  withLeadingSlash(template).replace(/\{(\w+)\}/g, (_match, token) =>
    encodeURIComponent(normalizeText(values[token]))
  );

const getPickupContact = () => ({
  fullName: CHOWDECK_RELAY_PICKUP_NAME,
  phone: CHOWDECK_RELAY_PICKUP_PHONE,
  email: CHOWDECK_RELAY_PICKUP_EMAIL,
  addressLine1: CHOWDECK_RELAY_PICKUP_STREET,
  city: CHOWDECK_RELAY_PICKUP_CITY,
  state: CHOWDECK_RELAY_PICKUP_STATE,
  country: CHOWDECK_RELAY_PICKUP_COUNTRY,
});

const buildContact = (contact: any = {}, fallbackEmail = "") => {
  const fullName = normalizeText(contact?.fullName || contact?.name || contact?.pretty_name);
  const { firstName, lastName } = splitName(fullName);
  const built = {
    first_name: firstName,
    last_name: lastName,
    phone: normalizeText(contact?.phone),
    street: normalizeStreet(contact),
    city: normalizeText(contact?.city),
    state: normalizeText(contact?.state),
    country: normalizeText(contact?.country || "Nigeria"),
    pretty_name: fullName || `${firstName} ${lastName}`.trim(),
  } as Record<string, any>;

  const email = normalizeText(contact?.email || fallbackEmail);
  if (email) built.email = email;
  return built;
};

const buildAddressNode = (address: any = {}, fallbackEmail = "") => {
  const contact = buildContact(address, fallbackEmail);
  return {
    street: contact.street,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    phone: contact.phone,
    pretty_name: contact.pretty_name,
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.first_name ? { first_name: contact.first_name } : {}),
    ...(contact.last_name ? { last_name: contact.last_name } : {}),
  } as Record<string, any>;
};

const buildAddressString = (address: any = {}) =>
  [
    normalizeStreet(address),
    normalizeText(address?.city),
    normalizeText(address?.state),
    normalizeText(address?.country || "Nigeria"),
  ]
    .filter(Boolean)
    .join(", ");

const getResultNodes = (payload: any) =>
  [payload, payload?.data, payload?.payload, payload?.delivery, payload?.result].filter(Boolean);

const extractFeeEntry = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const arrays = [
      node?.fees,
      node?.delivery_fees,
      node?.deliveryFees,
      node?.rate_cards,
      node?.rateCards,
    ];
    for (const entry of arrays.flatMap((value) => asArray(value))) {
      if (entry && typeof entry === "object") return entry;
    }
  }
  return null;
};

const extractChowdeckFeeId = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const feeId = pickFirst(
      node?.id,
      node?.fee_id,
      node?.feeId,
      node?.delivery_fee_id,
      node?.deliveryFeeId,
      node?.fee?.id,
      node?.fee?.fee_id
    );
    if (hasText(feeId)) return feeId.toString();
  }

  const feeEntry = extractFeeEntry(payload);
  const feeId = pickFirst(feeEntry?.fee_id, feeEntry?.feeId, feeEntry?.id);
  return hasText(feeId) ? feeId.toString() : null;
};

const extractChowdeckDeliveryPrice = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const amount = pickFirst(
      node?.total_amount,
      node?.delivery_amount,
      node?.totalAmount,
      node?.deliveryAmount,
      node?.delivery_price,
      node?.deliveryPrice,
      node?.total_price,
      node?.totalPrice,
      node?.price,
      node?.amount,
      node?.fee?.price,
      node?.fee?.amount
    );
    const parsed = fromCurrencyAmount(amount);
    if (parsed !== null) return parsed;
  }

  const feeEntry = extractFeeEntry(payload);
  const feeAmount = pickFirst(
    feeEntry?.delivery_price,
    feeEntry?.deliveryPrice,
    feeEntry?.price,
    feeEntry?.amount
  );
  return fromCurrencyAmount(feeAmount);
};

const extractChowdeckEta = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const eta = pickFirst(
      node?.estimated_delivery_time,
      node?.estimatedDeliveryTime,
      node?.estimated_delivery_window,
      node?.estimatedDeliveryWindow,
      node?.delivery_eta,
      node?.deliveryEta,
      node?.eta
    );
    if (hasText(eta)) return eta.toString().trim();
  }
  return null;
};

const extractChowdeckReference = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const reference = pickFirst(
      node?.reference,
      node?.delivery_reference,
      node?.deliveryReference,
      node?.id
    );
    if (hasText(reference)) return reference.toString();
  }
  return null;
};

const extractChowdeckStatus = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const status = pickFirst(
      node?.status,
      node?.delivery_status,
      node?.deliveryStatus,
      node?.state
    );
    if (hasText(status)) return status.toString();
  }
  return null;
};

const extractChowdeckTrackingUrl = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const url = pickFirst(
      node?.tracking_url,
      node?.trackingUrl,
      node?.tracking_url_public,
      node?.trackingUrlPublic
    );
    if (hasText(url)) return url.toString();
  }
  return null;
};

const extractChowdeckCurrency = (payload: any) => {
  const nodes = getResultNodes(payload);
  for (const node of nodes) {
    const currency = pickFirst(node?.currency, node?.currency_code, node?.currencyCode);
    if (hasText(currency)) return currency.toString();
  }
  return "NGN";
};

const buildEstimatePaths = () => {
  const customPath = normalizeText(CHOWDECK_RELAY_ESTIMATE_PATH);
  const candidates = customPath
    ? [customPath]
    : [
        "/merchant/{merchantReference}/delivery/fee",
        "/merchant/{merchantReference}/delivery/estimate",
        "/merchant/{merchantReference}/delivery-estimate",
        "/merchant/{merchantReference}/delivery-fee",
      ];

  return [...new Set(candidates.map((path) => interpolatePath(path, { merchantReference: CHOWDECK_RELAY_MERCHANT_REFERENCE })))];
};

const requestChowdeck = async (path: string, options: RequestInit = {}) => {
  if (!CHOWDECK_RELAY_API_KEY) {
    throw new Error("Chowdeck Relay API key is not configured");
  }

  const response = await fetch(`${CHOWDECK_RELAY_BASE_URL}${withLeadingSlash(path)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CHOWDECK_RELAY_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
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
      typeof data === "string" && data ? data : `Chowdeck request failed (${response.status})`
    );
    (error as any).status = response.status;
    (error as any).payload = data;
    throw error;
  }

  return data;
};

const buildDeliveryPayload = ({
  shippingAddress,
  customerEmail,
  feeId,
  reference,
  deliveryNote,
  estimatedOrderAmount,
  itemType,
}: {
  shippingAddress: any;
  customerEmail?: string;
  feeId?: any;
  reference?: any;
  deliveryNote?: any;
  estimatedOrderAmount?: any;
  itemType?: any;
}) => {
  const sourceContact = buildContact(getPickupContact(), CHOWDECK_RELAY_PICKUP_EMAIL);
  const destinationContact = buildContact(shippingAddress, customerEmail);
  const sourceAddress = buildAddressNode(getPickupContact(), CHOWDECK_RELAY_PICKUP_EMAIL);
  const destinationAddress = buildAddressNode(shippingAddress, customerEmail);
  const sourceAddressString = buildAddressString(getPickupContact());
  const destinationAddressString = buildAddressString(shippingAddress);
  const payload: Record<string, any> = {
    source_contact: sourceContact,
    destination_contact: destinationContact,
    sourceContact: sourceContact,
    destinationContact: destinationContact,
    sourceAddress,
    destinationAddress,
    sourceAddressString,
    destinationAddressString,
    source_address_string: sourceAddressString,
    destination_address_string: destinationAddressString,
    item_type: normalizeText(itemType || CHOWDECK_RELAY_ITEM_TYPE || "supplements"),
    itemType: normalizeText(itemType || CHOWDECK_RELAY_ITEM_TYPE || "supplements"),
    user_action: "sending",
    userAction: "sending",
  };

  if (hasText(feeId)) payload.fee_id = feeId.toString();
  if (hasText(reference)) payload.reference = reference.toString();
  if (hasText(deliveryNote)) payload.delivery_note = deliveryNote.toString();

  const normalizedOrderAmount = toMinorCurrencyAmount(estimatedOrderAmount);
  if (normalizedOrderAmount !== undefined) {
    payload.estimated_order_amount = normalizedOrderAmount;
  }

  return payload;
};

const isChowdeckRelayReady = () =>
  Boolean(
    CHOWDECK_RELAY_ENABLED &&
      CHOWDECK_RELAY_API_KEY &&
      CHOWDECK_RELAY_MERCHANT_REFERENCE &&
      CHOWDECK_RELAY_PICKUP_NAME &&
      CHOWDECK_RELAY_PICKUP_PHONE &&
      CHOWDECK_RELAY_PICKUP_STREET &&
      CHOWDECK_RELAY_PICKUP_CITY &&
      CHOWDECK_RELAY_PICKUP_STATE
  );

exports.isChowdeckRelayReady = isChowdeckRelayReady;

exports.getChowdeckRelayPickupState = () => CHOWDECK_RELAY_PICKUP_STATE || "";

exports.getChowdeckRelayLocalEta = () => CHOWDECK_RELAY_LOCAL_ETA || "Same-day delivery";

exports.extractChowdeckFeeId = extractChowdeckFeeId;
exports.parseChowdeckDeliveryPrice = extractChowdeckDeliveryPrice;
exports.extractChowdeckEta = extractChowdeckEta;
exports.extractChowdeckReference = extractChowdeckReference;
exports.extractChowdeckStatus = extractChowdeckStatus;
exports.extractChowdeckTrackingUrl = extractChowdeckTrackingUrl;

exports.fetchChowdeckDeliveryEstimate = async ({
  shippingAddress,
  customerEmail,
  reference,
  deliveryNote,
  estimatedOrderAmount,
  itemType,
}: {
  shippingAddress: any;
  customerEmail?: string;
  reference?: any;
  deliveryNote?: any;
  estimatedOrderAmount?: any;
  itemType?: any;
}) => {
  if (!isChowdeckRelayReady()) {
    throw new Error("Chowdeck Relay is not configured");
  }

  const payload = buildDeliveryPayload({
    shippingAddress,
    customerEmail,
    reference,
    deliveryNote,
    estimatedOrderAmount,
    itemType,
  });

  let lastError = null as any;
  for (const path of buildEstimatePaths()) {
    try {
      const raw = await requestChowdeck(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      return {
        raw,
        feeId: extractChowdeckFeeId(raw),
        amount: extractChowdeckDeliveryPrice(raw),
        eta: extractChowdeckEta(raw),
        currency: extractChowdeckCurrency(raw),
      };
    } catch (error) {
      lastError = error;
      const status = (error as any)?.status;
      if (status !== 404 && status !== 405) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Chowdeck delivery estimate failed");
};

exports.createChowdeckDelivery = async ({
  order,
  shippingAddress,
  user,
  feeId,
  deliveryNote,
  itemType,
}: {
  order: any;
  shippingAddress: any;
  user?: any;
  feeId: any;
  deliveryNote?: any;
  itemType?: any;
}) => {
  if (!isChowdeckRelayReady()) {
    throw new Error("Chowdeck Relay is not configured");
  }
  if (!hasText(feeId)) {
    throw new Error("Chowdeck delivery fee ID is required");
  }

  const payload = buildDeliveryPayload({
    shippingAddress,
    customerEmail: user?.email || "",
    feeId,
    reference: order?.id,
    deliveryNote,
    estimatedOrderAmount: order?.totalPrice,
    itemType,
  });

  const raw = await requestChowdeck(
    interpolatePath(CHOWDECK_RELAY_CREATE_PATH, {
      merchantReference: CHOWDECK_RELAY_MERCHANT_REFERENCE,
    }),
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );

  return {
    raw,
    reference: extractChowdeckReference(raw) || normalizeText(order?.id),
    status: extractChowdeckStatus(raw),
    trackingUrl: extractChowdeckTrackingUrl(raw),
  };
};

exports.trackChowdeckDelivery = async (reference: string) => {
  if (!reference) {
    throw new Error("Delivery reference is required");
  }

  return requestChowdeck(
    interpolatePath(CHOWDECK_RELAY_TRACK_PATH, {
      merchantReference: CHOWDECK_RELAY_MERCHANT_REFERENCE,
      reference,
    }),
    { method: "GET" }
  );
};
