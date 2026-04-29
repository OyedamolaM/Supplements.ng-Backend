const fs = require("fs");
const path = require("path");

const OVERPASS_URL = (
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter"
).replace(/\/+$/, "");
const OUTPUT_PATH = path.join(process.cwd(), "data", "lagosDeliveryAreas.json");
const BBOX = "6.35,2.65,6.80,3.85";
const PLACE_PATTERN = "^(city|town|village|suburb|neighbourhood|quarter|locality|hamlet)$";

const query = `
[out:json][timeout:120];
(
  node["name"]["place"~"${PLACE_PATTERN}"](${BBOX});
  way["name"]["place"~"${PLACE_PATTERN}"](${BBOX});
  relation["name"]["place"~"${PLACE_PATTERN}"](${BBOX});
  way["name"]["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10|11)$"](${BBOX});
  relation["name"]["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10|11)$"](${BBOX});
);
out center tags;
`;

const normalizeText = (value: any) => (value || "").toString().trim();

const normalizeKey = (value: any) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const slug = (value: any) =>
  normalizeKey(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const toNumber = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getCoordinate = (element: any, key: "lat" | "lon") =>
  toNumber(element?.[key]) ?? toNumber(element?.center?.[key]);

const getLga = (tags: any = {}) =>
  normalizeText(
    tags["addr:lga"] ||
      tags.lga ||
      tags.local_government ||
      tags.local_government_area ||
      tags["is_in:local_government_area"] ||
      tags["is_in:lga"]
  );

const normalizeElement = (element: any) => {
  const tags = element?.tags || {};
  const name = normalizeText(tags.name);
  const latitude = getCoordinate(element, "lat");
  const longitude = getCoordinate(element, "lon");
  if (!name || latitude === null || longitude === null) return null;

  const lga = getLga(tags);
  const placeType = normalizeText(tags.place || tags.boundary || `admin_level_${tags.admin_level || ""}`);
  const osmType = normalizeText(element.type);
  const osmId = normalizeText(element.id);
  const id = `osm-area:${slug(name)}:${osmType}:${osmId}`;

  return {
    id,
    name,
    label: [name, lga, "Lagos", "Nigeria"].filter(Boolean).join(", "),
    addressLine1: name,
    addressLine2: lga,
    city: name,
    lga,
    state: "Lagos",
    country: "Nigeria",
    formattedAddress: [name, lga, "Lagos", "Nigeria"].filter(Boolean).join(", "),
    latitude,
    longitude,
    provider: "OSM_AREA",
    providerPlaceId: `osm:${osmType}:${osmId}`,
    placeType,
    osmType,
    osmId,
  };
};

const main = async () => {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/json",
      "User-Agent": "SupplementsNG/1.0 (support@supplements.ng)",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.remark || `Overpass request failed (${response.status})`);
  }

  const seen = new Set<string>();
  const areas = (Array.isArray(payload?.elements) ? payload.elements : [])
    .map(normalizeElement)
    .filter(Boolean)
    .filter((area: any) => {
      const key = [normalizeKey(area.name), normalizeKey(area.lga)].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left: any, right: any) => left.name.localeCompare(right.name));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "OpenStreetMap Overpass API",
        query,
        count: areas.length,
        areas,
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${areas.length} Lagos delivery areas to ${OUTPUT_PATH}`);
};

main().catch((error: any) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
