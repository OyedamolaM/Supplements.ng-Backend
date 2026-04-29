const fs = require("fs");
const path = require("path");

const LOCAL_DELIVERY_AREAS_PATH = (
  process.env.LOCAL_DELIVERY_AREAS_PATH ||
  path.join(process.cwd(), "data", "lagosDeliveryAreas.json")
).toString();

const normalizeText = (value: any) => (value || "").toString().trim();

const normalizeComparable = (value: any) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toFiniteNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const uniqueParts = (parts: any[]) =>
  Array.from(new Set(parts.map(normalizeText).filter(Boolean)));

const buildLabel = (area: any) =>
  uniqueParts([area?.name, area?.lga, area?.state || "Lagos", area?.country || "Nigeria"]).join(", ");

const normalizeArea = (entry: any) => {
  const latitude = toFiniteNumber(entry?.latitude ?? entry?.lat);
  const longitude = toFiniteNumber(entry?.longitude ?? entry?.lng ?? entry?.lon);
  const name = normalizeText(entry?.name || entry?.label || entry?.area);
  if (!name || latitude === null || longitude === null) return null;

  const osmType = normalizeText(entry?.osmType || entry?.osm_type);
  const osmId = normalizeText(entry?.osmId || entry?.osm_id);
  const providerPlaceId =
    normalizeText(entry?.providerPlaceId) ||
    normalizeText(entry?.id) ||
    uniqueParts(["osm", osmType, osmId]).join(":") ||
    `${normalizeComparable(name).replace(/\s+/g, "-")}:${latitude}:${longitude}`;
  const id = normalizeText(entry?.id) || providerPlaceId;
  const state = normalizeText(entry?.state) || "Lagos";
  const country = normalizeText(entry?.country) || "Nigeria";
  const city = normalizeText(entry?.city) || name;
  const lga = normalizeText(entry?.lga || entry?.localGovernment || entry?.localGovernmentArea);
  const label = normalizeText(entry?.label) || buildLabel({ name, lga, state, country });

  return {
    id,
    name,
    label,
    addressLine1: name,
    addressLine2: lga,
    city,
    lga,
    state,
    country,
    formattedAddress:
      normalizeText(entry?.formattedAddress) || uniqueParts([name, lga, state, country]).join(", "),
    latitude,
    longitude,
    provider: "OSM_AREA",
    providerPlaceId,
    placeType: normalizeText(entry?.placeType || entry?.place_type || entry?.type),
    osmType,
    osmId,
    raw: entry?.raw || null,
  };
};

let cachedAreas: any[] | null = null;

const loadLocalDeliveryAreas = () => {
  if (cachedAreas) return cachedAreas;

  let payload: any = [];
  try {
    const raw = fs.readFileSync(LOCAL_DELIVERY_AREAS_PATH, "utf8");
    payload = JSON.parse(raw);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      console.error("Unable to load local delivery areas", {
        path: LOCAL_DELIVERY_AREAS_PATH,
        message: error?.message,
      });
    }
  }

  const source = Array.isArray(payload) ? payload : payload?.areas || [];
  const seen = new Set<string>();
  cachedAreas = (Array.isArray(source) ? source : [])
    .map(normalizeArea)
    .filter(Boolean)
    .filter((area: any) => {
      const key = [
        normalizeComparable(area.name),
        normalizeComparable(area.lga),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left: any, right: any) => left.name.localeCompare(right.name));

  return cachedAreas;
};

const getLocalDeliveryAreas = () => loadLocalDeliveryAreas();

const scoreAreaMatch = (area: any, normalizedQuery: string) => {
  if (!normalizedQuery) return 0;

  const name = normalizeComparable(area?.name);
  const label = normalizeComparable(area?.label);
  const city = normalizeComparable(area?.city);
  const lga = normalizeComparable(area?.lga);
  const formattedAddress = normalizeComparable(area?.formattedAddress);
  const tokens = normalizedQuery.split(" ").filter(Boolean);

  let score = -1;

  if (name === normalizedQuery) score = Math.max(score, 400);
  if (label === normalizedQuery) score = Math.max(score, 360);
  if (city === normalizedQuery) score = Math.max(score, 330);
  if (lga === normalizedQuery) score = Math.max(score, 320);

  if (name.startsWith(normalizedQuery)) score = Math.max(score, 300);
  if (label.startsWith(normalizedQuery)) score = Math.max(score, 260);
  if (city.startsWith(normalizedQuery)) score = Math.max(score, 240);
  if (lga.startsWith(normalizedQuery)) score = Math.max(score, 220);

  const haystack = [name, label, city, lga, formattedAddress].join(" ");
  if (haystack.includes(normalizedQuery)) score = Math.max(score, 180);

  let tokenScore = 0;
  for (const token of tokens) {
    if (name.includes(token)) tokenScore += 60;
    else if (city.includes(token)) tokenScore += 48;
    else if (lga.includes(token)) tokenScore += 42;
    else if (label.includes(token) || formattedAddress.includes(token)) tokenScore += 36;
    else return -1;
  }

  score = Math.max(score, tokenScore);
  if (score < 0) return -1;

  return score - Math.min(name.length, 80) / 100;
};

const searchLocalDeliveryAreas = ({
  query = "",
  limit = 80,
}: {
  query?: any;
  limit?: any;
} = {}) => {
  const normalizedQuery = normalizeComparable(query);
  const max = Math.max(1, Math.min(1000, Number(limit) || 80));
  const areas = getLocalDeliveryAreas();

  if (!normalizedQuery) return areas.slice(0, max);
  return areas
    .map((area: any) => ({
      area,
      score: scoreAreaMatch(area, normalizedQuery),
    }))
    .filter((entry: any) => entry.score >= 0)
    .sort((left: any, right: any) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.area.name.localeCompare(right.area.name);
    })
    .map((entry: any) => entry.area)
    .slice(0, max);
};

const findLocalDeliveryArea = (value: any) => {
  const lookup = normalizeComparable(value);
  if (!lookup) return null;

  return (
    getLocalDeliveryAreas().find((area: any) =>
      [
        area.id,
        area.providerPlaceId,
        area.name,
        area.label,
        area.formattedAddress,
      ].some((candidate) => normalizeComparable(candidate) === lookup)
    ) || null
  );
};

const buildLocalDeliveryAreaAddress = (area: any, overrides: any = {}) => {
  const normalized = normalizeArea(area);
  if (!normalized) return null;

  const addressLine1 = normalizeText(overrides?.addressLine1) || normalized.addressLine1;
  const addressLine2 = normalizeText(overrides?.addressLine2) || normalized.addressLine2;
  const city = normalizeText(overrides?.city) || normalized.city || normalized.name;
  const state = normalizeText(overrides?.state) || normalized.state || "Lagos";
  const country = normalizeText(overrides?.country) || normalized.country || "Nigeria";
  const formattedAddress =
    normalizeText(overrides?.formattedAddress) ||
    uniqueParts([addressLine1, addressLine2, city, state, country]).join(", ");

  return {
    ...overrides,
    addressLine1,
    addressLine2,
    city,
    state,
    country,
    formattedAddress,
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    addressProvider: "OSM_AREA",
    provider: "OSM_AREA",
    providerPlaceId: normalized.providerPlaceId,
    localDeliveryAreaId: normalized.id,
    localDeliveryAreaName: normalized.name,
    lga: normalized.lga,
  };
};

const resolveLocalDeliveryAreaAddress = (shippingAddress: any = {}) => {
  const deliveryArea = shippingAddress?.deliveryArea || {};
  const area =
    normalizeArea(deliveryArea) ||
    findLocalDeliveryArea(
      shippingAddress?.localDeliveryAreaId ||
        shippingAddress?.areaId ||
        deliveryArea?.id ||
        deliveryArea?.providerPlaceId ||
        shippingAddress?.localDeliveryAreaName ||
        shippingAddress?.areaName
    );

  if (!area) return null;
  return buildLocalDeliveryAreaAddress(area, shippingAddress);
};

const clearLocalDeliveryAreaCache = () => {
  cachedAreas = null;
};

exports.getLocalDeliveryAreas = getLocalDeliveryAreas;
exports.searchLocalDeliveryAreas = searchLocalDeliveryAreas;
exports.findLocalDeliveryArea = findLocalDeliveryArea;
exports.buildLocalDeliveryAreaAddress = buildLocalDeliveryAreaAddress;
exports.resolveLocalDeliveryAreaAddress = resolveLocalDeliveryAreaAddress;
exports.clearLocalDeliveryAreaCache = clearLocalDeliveryAreaCache;
