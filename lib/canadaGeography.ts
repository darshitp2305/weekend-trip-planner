export type ProvinceOrTerritory = {
  code: string;
  name: string;
  aliases?: readonly string[];
};

type DepartureLocationConfig = {
  name: string;
  provinceCode: string;
  aliases?: readonly string[];
  routingOriginKey?: "edmonton" | "calgary";
  latitude?: number;
  longitude?: number;
};

export type DepartureLocation = DepartureLocationConfig;

export const PLANNER_COUNTRY_NAME = "Canada";
export const PLANNER_PRODUCT_LABEL = "Canada trip planner";

export const CANADIAN_PROVINCES_AND_TERRITORIES = [
  { code: "AB", name: "Alberta", aliases: ["AB"] },
  { code: "BC", name: "British Columbia", aliases: ["BC", "B.C."] },
  { code: "MB", name: "Manitoba", aliases: ["MB"] },
  { code: "NB", name: "New Brunswick", aliases: ["NB"] },
  { code: "NL", name: "Newfoundland and Labrador", aliases: ["NL", "Newfoundland"] },
  { code: "NS", name: "Nova Scotia", aliases: ["NS"] },
  { code: "NT", name: "Northwest Territories", aliases: ["NT", "NWT"] },
  { code: "NU", name: "Nunavut", aliases: ["NU"] },
  { code: "ON", name: "Ontario", aliases: ["ON"] },
  { code: "PE", name: "Prince Edward Island", aliases: ["PE", "PEI"] },
  { code: "QC", name: "Quebec", aliases: ["QC", "Quebec"] },
  { code: "SK", name: "Saskatchewan", aliases: ["SK"] },
  { code: "YT", name: "Yukon", aliases: ["YT", "Yukon Territory"] },
] as const satisfies readonly ProvinceOrTerritory[];

export const CANADIAN_DEPARTURE_LOCATIONS = [
  { name: "Vancouver", provinceCode: "BC", latitude: 49.2827, longitude: -123.1207 },
  { name: "Victoria", provinceCode: "BC", latitude: 48.4284, longitude: -123.3656 },
  { name: "Kelowna", provinceCode: "BC", latitude: 49.888, longitude: -119.496 },
  { name: "Kamloops", provinceCode: "BC", latitude: 50.6745, longitude: -120.3273 },
  { name: "Nanaimo", provinceCode: "BC", latitude: 49.1659, longitude: -123.9401 },
  { name: "Prince George", provinceCode: "BC", latitude: 53.9171, longitude: -122.7497 },
  {
    name: "Calgary",
    provinceCode: "AB",
    routingOriginKey: "calgary",
    latitude: 51.0447,
    longitude: -114.0719,
  },
  {
    name: "Edmonton",
    provinceCode: "AB",
    routingOriginKey: "edmonton",
    latitude: 53.5461,
    longitude: -113.4938,
  },
  {
    name: "Red Deer",
    provinceCode: "AB",
    routingOriginKey: "calgary",
    latitude: 52.2681,
    longitude: -113.8112,
  },
  {
    name: "Lethbridge",
    provinceCode: "AB",
    routingOriginKey: "calgary",
    latitude: 49.6956,
    longitude: -112.8451,
  },
  {
    name: "Medicine Hat",
    provinceCode: "AB",
    routingOriginKey: "calgary",
    latitude: 50.0405,
    longitude: -110.6761,
  },
  {
    name: "Grande Prairie",
    provinceCode: "AB",
    routingOriginKey: "edmonton",
    latitude: 55.1707,
    longitude: -118.7947,
  },
  {
    name: "Fort McMurray",
    provinceCode: "AB",
    routingOriginKey: "edmonton",
    latitude: 56.7268,
    longitude: -111.38,
  },
  {
    name: "Airdrie",
    provinceCode: "AB",
    routingOriginKey: "calgary",
    latitude: 51.2917,
    longitude: -114.0144,
  },
  {
    name: "St. Albert",
    provinceCode: "AB",
    aliases: ["St Albert"],
    routingOriginKey: "edmonton",
    latitude: 53.6305,
    longitude: -113.6256,
  },
  {
    name: "Sherwood Park",
    provinceCode: "AB",
    routingOriginKey: "edmonton",
    latitude: 53.5168,
    longitude: -113.3187,
  },
  { name: "Saskatoon", provinceCode: "SK", latitude: 52.1332, longitude: -106.67 },
  { name: "Regina", provinceCode: "SK", latitude: 50.4452, longitude: -104.6189 },
  { name: "Prince Albert", provinceCode: "SK", latitude: 53.2033, longitude: -105.7531 },
  { name: "Moose Jaw", provinceCode: "SK", latitude: 50.3938, longitude: -105.5519 },
  { name: "Winnipeg", provinceCode: "MB", latitude: 49.8951, longitude: -97.1384 },
  { name: "Brandon", provinceCode: "MB", latitude: 49.8485, longitude: -99.9501 },
  { name: "Toronto", provinceCode: "ON", latitude: 43.6532, longitude: -79.3832 },
  { name: "Ottawa", provinceCode: "ON", latitude: 45.4215, longitude: -75.6972 },
  { name: "Hamilton", provinceCode: "ON", latitude: 43.2557, longitude: -79.8711 },
  { name: "London", provinceCode: "ON", latitude: 42.9849, longitude: -81.2453 },
  { name: "Kitchener", provinceCode: "ON", latitude: 43.4516, longitude: -80.4925 },
  { name: "Waterloo", provinceCode: "ON", latitude: 43.4643, longitude: -80.5204 },
  { name: "Windsor", provinceCode: "ON", latitude: 42.3149, longitude: -83.0364 },
  { name: "Mississauga", provinceCode: "ON", latitude: 43.589, longitude: -79.6441 },
  { name: "Brampton", provinceCode: "ON", latitude: 43.7315, longitude: -79.7624 },
  { name: "Montreal", provinceCode: "QC", aliases: ["Montreal"], latitude: 45.5017, longitude: -73.5673 },
  { name: "Quebec City", provinceCode: "QC", aliases: ["Quebec City"], latitude: 46.8139, longitude: -71.208 },
  { name: "Laval", provinceCode: "QC", latitude: 45.6066, longitude: -73.7124 },
  { name: "Gatineau", provinceCode: "QC", latitude: 45.4765, longitude: -75.7013 },
  { name: "Sherbrooke", provinceCode: "QC", latitude: 45.4042, longitude: -71.8929 },
  {
    name: "Trois-Rivieres",
    provinceCode: "QC",
    aliases: ["Trois Rivieres"],
    latitude: 46.343,
    longitude: -72.5432,
  },
  { name: "Halifax", provinceCode: "NS", latitude: 44.6488, longitude: -63.5752 },
  { name: "Sydney", provinceCode: "NS", latitude: 46.1368, longitude: -60.1942 },
  { name: "Moncton", provinceCode: "NB", latitude: 46.0878, longitude: -64.7782 },
  { name: "Fredericton", provinceCode: "NB", latitude: 45.9636, longitude: -66.6431 },
  { name: "Saint John", provinceCode: "NB", latitude: 45.2733, longitude: -66.0633 },
  { name: "Charlottetown", provinceCode: "PE", latitude: 46.2382, longitude: -63.1311 },
  {
    name: "St. John's",
    provinceCode: "NL",
    aliases: ["St Johns", "Saint John's", "Saint Johns"],
    latitude: 47.5615,
    longitude: -52.7126,
  },
  { name: "Corner Brook", provinceCode: "NL", latitude: 48.95, longitude: -57.95 },
  { name: "Whitehorse", provinceCode: "YT", latitude: 60.7212, longitude: -135.0568 },
  { name: "Yellowknife", provinceCode: "NT", latitude: 62.454, longitude: -114.3718 },
  { name: "Iqaluit", provinceCode: "NU", latitude: 63.7467, longitude: -68.517 },
] as const satisfies readonly DepartureLocationConfig[];

export type StartCityName = (typeof CANADIAN_DEPARTURE_LOCATIONS)[number]["name"];

function normalizeLocationText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEPARTURE_LOCATION_LOOKUP = new Map(
  CANADIAN_DEPARTURE_LOCATIONS.flatMap((rawLocation) => {
    const location: DepartureLocationConfig = rawLocation;
    const entries = [[normalizeLocationText(location.name), location]] as const;
    const aliasEntries = (location.aliases ?? []).map(
      (alias) => [normalizeLocationText(alias), location] as const
    );

    return [...entries, ...aliasEntries];
  })
);

const PROVINCE_OR_TERRITORY_LOOKUP = new Set(
  CANADIAN_PROVINCES_AND_TERRITORIES.flatMap((region) => [
    normalizeLocationText(region.name),
    ...(region.aliases ?? []).map((alias) => normalizeLocationText(alias)),
  ])
);

export function getDepartureLocation(value?: string) {
  return DEPARTURE_LOCATION_LOOKUP.get(normalizeLocationText(value));
}

export function getCanadianGeographyPhrases() {
  return Array.from(
    new Set([
      "Canada",
      "Canadian",
      ...CANADIAN_PROVINCES_AND_TERRITORIES.flatMap((region) => [
        region.name,
        ...(region.aliases ?? []),
      ]),
      ...CANADIAN_DEPARTURE_LOCATIONS.flatMap((rawLocation) => {
        const location: DepartureLocationConfig = rawLocation;
        return [location.name, ...(location.aliases ?? [])];
      }),
    ])
  );
}

export function getProvinceNameByCode(code?: string) {
  return CANADIAN_PROVINCES_AND_TERRITORIES.find((region) => region.code === code)?.name;
}

export function isCanadianProvinceOrTerritory(value?: string) {
  return PROVINCE_OR_TERRITORY_LOOKUP.has(normalizeLocationText(value));
}
