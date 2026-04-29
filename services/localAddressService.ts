const LOCAL_ADDRESS_SEARCH_ENABLED = (process.env.LOCAL_ADDRESS_SEARCH_ENABLED || "true")
  .toString()
  .trim()
  .toLowerCase() !== "false";
const LOCAL_ADDRESS_SEARCH_BASE_URL = (
  process.env.LOCAL_ADDRESS_SEARCH_BASE_URL || "https://nominatim.openstreetmap.org"
)
  .toString()
  .trim()
  .replace(/\/+$/, "");
const LOCAL_ADDRESS_SEARCH_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.LOCAL_ADDRESS_SEARCH_TIMEOUT_MS || 6000) || 6000
);
const LOCAL_ADDRESS_SEARCH_LIMIT = Math.max(
  1,
  Math.min(8, Number(process.env.LOCAL_ADDRESS_SEARCH_LIMIT || 5) || 5)
);
const LOCAL_ADDRESS_SEARCH_USER_AGENT = (
  process.env.LOCAL_ADDRESS_SEARCH_USER_AGENT || "SupplementsNG/1.0 (support@supplements.ng)"
)
  .toString()
  .trim();
const LOCAL_ROAD_DISTANCE_BASE_URL = (
  process.env.LOCAL_ROAD_DISTANCE_BASE_URL || "https://router.project-osrm.org"
)
  .toString()
  .trim()
  .replace(/\/+$/, "");
const LOCAL_ROAD_DISTANCE_PROFILE = (
  process.env.LOCAL_ROAD_DISTANCE_PROFILE || "driving"
)
  .toString()
  .trim()
  .replace(/^\/+|\/+$/g, "");
const LOCAL_ROAD_DISTANCE_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.LOCAL_ROAD_DISTANCE_TIMEOUT_MS || 8000) || 8000
);

const normalizeText = (value: any) => (value || "").toString().trim();

const hasText = (value: any) => Boolean(normalizeText(value));

const toFiniteNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const joinAddress = (...values: any[]) =>
  values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(", ");

const getPrimaryAddressLine = (address: any = {}, fallbackDisplayName = "") => {
  const houseNumber = normalizeText(address?.house_number);
  const road = normalizeText(address?.road || address?.pedestrian || address?.footway);
  const line = [houseNumber, road].filter(Boolean).join(" ").trim();
  if (line) return line;
  return (
    normalizeText(address?.building) ||
    normalizeText(address?.amenity) ||
    normalizeText(address?.shop) ||
    normalizeText(address?.office) ||
    normalizeText(address?.tourism) ||
    normalizeText(fallbackDisplayName.split(",")[0])
  );
};

const getSecondaryAddressLine = (address: any = {}) =>
  joinAddress(
    address?.suburb,
    address?.neighbourhood,
    address?.quarter,
    address?.residential,
    address?.city_district
  );

const getLocality = (address: any = {}) =>
  normalizeText(
    address?.city ||
      address?.town ||
      address?.village ||
      address?.municipality ||
      address?.county ||
      address?.suburb ||
      address?.city_district
  );

const buildQueryString = (parts: any[]) =>
  parts
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(", ");

const buildResult = (entry: any) => {
  const address = entry?.address || {};
  const displayName = normalizeText(entry?.display_name);
  const latitude = toFiniteNumber(entry?.lat);
  const longitude = toFiniteNumber(entry?.lon);
  if (latitude === null || longitude === null) return null;

  const addressLine1 = getPrimaryAddressLine(address, displayName);
  const addressLine2 = getSecondaryAddressLine(address);
  const city = getLocality(address) || "Lagos";
  const state = normalizeText(address?.state || "Lagos");
  const country = normalizeText(address?.country || "Nigeria");
  const postalCode = normalizeText(address?.postcode);
  const providerPlaceId =
    normalizeText(entry?.place_id) ||
    joinAddress(entry?.osm_type, entry?.osm_id) ||
    displayName;

  return {
    id: providerPlaceId,
    label: displayName || buildQueryString([addressLine1, addressLine2, city, state, country]),
    formattedAddress: displayName || buildQueryString([addressLine1, addressLine2, city, state, country]),
    addressLine1,
    addressLine2,
    city,
    state,
    country,
    postalCode,
    latitude,
    longitude,
    provider: "NOMINATIM",
    providerPlaceId,
    raw: entry,
  };
};

const dedupeResults = (results: any[]) => {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = [
      normalizeText(result?.formattedAddress),
      normalizeText(result?.providerPlaceId),
      result?.latitude,
      result?.longitude,
    ].join("|");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const requestAddressSearch = async (query: string, limit = LOCAL_ADDRESS_SEARCH_LIMIT) => {
  if (!LOCAL_ADDRESS_SEARCH_ENABLED) {
    throw new Error("Local address search is disabled");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_ADDRESS_SEARCH_TIMEOUT_MS);
  const url = new URL(`${LOCAL_ADDRESS_SEARCH_BASE_URL}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ng");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": LOCAL_ADDRESS_SEARCH_USER_AGENT,
      },
    });
    const text = await response.text().catch(() => "");
    const payload = text ? JSON.parse(text) : [];

    if (!response.ok) {
      const error = new Error(`Local address search failed (${response.status})`);
      (error as any).status = response.status;
      (error as any).payload = payload;
      throw error;
    }

    return Array.isArray(payload) ? payload : [];
  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Local address search timed out after ${LOCAL_ADDRESS_SEARCH_TIMEOUT_MS}ms`
      );
      (timeoutError as any).status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const searchLocalAddresses = async (query: string, limit = LOCAL_ADDRESS_SEARCH_LIMIT) => {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length < 3) return [];

  const scopedQuery = buildQueryString([normalizedQuery, "Lagos", "Nigeria"]);
  const payload = await requestAddressSearch(scopedQuery, limit);
  return dedupeResults(payload.map(buildResult).filter(Boolean));
};

const resolveLocalAddress = async (address: any) => {
  const latitude = toFiniteNumber(address?.latitude ?? address?.lat);
  const longitude = toFiniteNumber(address?.longitude ?? address?.lng ?? address?.lon);
  if (latitude !== null && longitude !== null) {
    return {
      formattedAddress: normalizeText(address?.formattedAddress),
      addressLine1: normalizeText(address?.addressLine1),
      addressLine2: normalizeText(address?.addressLine2),
      city: normalizeText(address?.city) || "Lagos",
      state: normalizeText(address?.state) || "Lagos",
      country: normalizeText(address?.country) || "Nigeria",
      postalCode: normalizeText(address?.postalCode),
      latitude,
      longitude,
      provider: normalizeText(address?.addressProvider || address?.provider) || "MANUAL",
      providerPlaceId: normalizeText(address?.providerPlaceId),
      raw: null,
    };
  }

  const query = buildQueryString([
    address?.formattedAddress,
    address?.addressLine1,
    address?.addressLine2,
    address?.city,
    address?.state || "Lagos",
    address?.country || "Nigeria",
  ]);
  if (!hasText(query)) return null;

  const results = await searchLocalAddresses(query, 1);
  return results[0] || null;
};

const fetchRoadDistanceKm = async ({
  from,
  to,
}: {
  from: { latitude: any; longitude: any };
  to: { latitude: any; longitude: any };
}) => {
  const fromLatitude = toFiniteNumber(from?.latitude);
  const fromLongitude = toFiniteNumber(from?.longitude);
  const toLatitude = toFiniteNumber(to?.latitude);
  const toLongitude = toFiniteNumber(to?.longitude);

  if (
    fromLatitude === null ||
    fromLongitude === null ||
    toLatitude === null ||
    toLongitude === null
  ) {
    throw new Error("Valid pickup and destination coordinates are required");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_ROAD_DISTANCE_TIMEOUT_MS);
  const coordinates = `${fromLongitude},${fromLatitude};${toLongitude},${toLatitude}`;
  const url = new URL(
    `${LOCAL_ROAD_DISTANCE_BASE_URL}/route/v1/${LOCAL_ROAD_DISTANCE_PROFILE}/${coordinates}`
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": LOCAL_ADDRESS_SEARCH_USER_AGENT,
      },
    });
    const text = await response.text().catch(() => "");
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok || payload?.code !== "Ok") {
      const error = new Error(
        payload?.message || `Road distance lookup failed (${response.status})`
      );
      (error as any).status = response.status || 502;
      (error as any).payload = payload;
      throw error;
    }

    const distanceMeters = toFiniteNumber(payload?.routes?.[0]?.distance);
    if (distanceMeters === null || distanceMeters < 0) {
      throw new Error("Road distance response did not include distance");
    }

    return {
      distanceKm: distanceMeters / 1000,
      distanceMeters,
      durationSeconds: toFiniteNumber(payload?.routes?.[0]?.duration),
      raw: payload,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        `Road distance lookup timed out after ${LOCAL_ROAD_DISTANCE_TIMEOUT_MS}ms`
      );
      (timeoutError as any).status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

exports.searchLocalAddresses = searchLocalAddresses;
exports.resolveLocalAddress = resolveLocalAddress;
exports.fetchRoadDistanceKm = fetchRoadDistanceKm;
