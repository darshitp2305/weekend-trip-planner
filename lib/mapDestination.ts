/**
 * Helper module for map destination concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  Destination,
  DriveTimeConfidence,
  DriveTimeSource,
  RawDestination,
  StyleScores,
  TripInput,
  TripStyle,
} from "./types";
import { getDepartureLocation } from "./canadaGeography";
import { formatDisplayText } from "./displayText";
import { normalizeTripImageSet } from "./tripImages";
import { getPlanningHubForStartCity } from "./startCities";

function getHiddenGemSignal(raw: RawDestination): number {
  const text = [
    raw.name,
    raw.region,
    raw.home_base_city,
    ...(raw.vibes ?? []),
    ...(raw.anchor_experiences ?? []).map((item) => item.title),
    ...(raw.anchor_experiences ?? []).map((item) => item.description ?? ""),
    ...(raw.neighborhoods ?? []).map((item) => item.name),
    ...(raw.neighborhoods ?? []).map((item) => item.reason),
  ]
    .join(" ")
    .toLowerCase();

  const strongKeywords = [
    "hidden",
    "quiet",
    "small town",
    "local",
    "scenic",
    "heritage",
    "charming",
    "quaint",
    "badlands",
    "canyon",
    "lesser-known",
    "underrated",
  ];

  const weakKeywords = ["downtown", "nightlife", "city", "popular", "busy"];

  const strongCount = strongKeywords.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0
  );
  const weakCount = weakKeywords.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0
  );

  return strongCount - weakCount;
}

function getMustSeeSignal(raw: RawDestination): number {
  const text = [
    raw.name,
    raw.region,
    raw.home_base_city,
    ...(raw.vibes ?? []),
    ...(raw.anchor_experiences ?? []).map((item) => item.title),
    ...(raw.anchor_experiences ?? []).map((item) => item.description ?? ""),
    ...(raw.neighborhoods ?? []).map((item) => item.name),
    ...(raw.neighborhoods ?? []).map((item) => item.reason),
  ]
    .join(" ")
    .toLowerCase();

  const strongKeywords = [
    "iconic",
    "famous",
    "landmark",
    "landmarks",
    "must see",
    "must-see",
    "bucket list",
    "classic",
    "sightseeing",
    "viewpoint",
    "lookout",
    "museum",
    "historic",
    "gondola",
    "hot springs",
    "waterfall",
    "canyon",
    "popular",
  ];

  const weakKeywords = [
    "hidden",
    "lesser-known",
    "lesser known",
    "underrated",
    "under the radar",
    "quiet",
  ];

  const strongCount = strongKeywords.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0
  );
  const weakCount = weakKeywords.reduce(
    (count, keyword) => count + (text.includes(keyword) ? 1 : 0),
    0
  );

  return strongCount - weakCount;
}

function deriveTripStylesFromScores(styleScores: StyleScores, raw: RawDestination): TripStyle[] {
  const derivedStyles = (Object.entries(styleScores) as [TripStyle, number][])
    .filter(([, score]) => score >= 2)
    .map(([style]) => style);

  if (getHiddenGemSignal(raw) >= 2) {
    derivedStyles.push("hidden gems");
  }

  if (getMustSeeSignal(raw) >= 3) {
    derivedStyles.push("must see");
  }

  return Array.from(new Set(derivedStyles));
}

function mapCostLevel(
  costLevel: RawDestination["cost_level"]
): "low" | "medium" | "high" {
  if (costLevel === "low") return "low";
  if (costLevel === "high") return "high";
  return "medium";
}

function estimateHotelPrice(costLevel: RawDestination["cost_level"]): number {
  switch (costLevel) {
    case "high":
      return 260;
    case "mid":
      return 190;
    case "low_mid":
      return 155;
    case "low":
    default:
      return 120;
  }
}

function joinNaturalList(items: string[]) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function formatVibeLabel(value: string) {
  const normalized = formatDisplayText(value).toLowerCase();

  if (normalized === "relax") {
    return "relaxation";
  }

  return normalized;
}

function buildSummary(raw: RawDestination): string {
  const topHighlights = raw.anchor_experiences
    .slice(0, 2)
    .map((exp) => exp.title)
    .filter(Boolean);
  const vibeText = joinNaturalList(
    raw.vibes
      .slice(0, 4)
      .map(formatVibeLabel)
      .filter(Boolean)
  );
  const highlightsText = joinNaturalList(topHighlights);

  return `${raw.name} is a Canadian getaway known for ${vibeText || "mountain scenery"}${
    highlightsText ? `, with highlights like ${highlightsText}` : ""
  }.`;
}

function estimateActivityCost(type: string): number {
  switch (type) {
    case "skiing":
      return 120;
    case "gondola":
      return 70;
    case "hot_springs":
      return 20;
    case "spa":
      return 65;
    case "museum":
      return 25;
    case "food":
      return 0;
    case "nightlife":
      return 0;
    case "culture":
      return 0;
    case "scenic":
      return 0;
    case "nature":
      return 0;
    case "relax":
      return 0;
    case "lakes":
      return 0;
    case "adventure":
      return 0;
    default:
      return 0;
  }
}

function getImageSet(raw: RawDestination) {
  const imageSet = normalizeTripImageSet(
    {
      imageUrl: raw.image_url_light ?? raw.image_url,
      imageUrlLight: raw.image_url_light ?? raw.image_url,
      imageUrlDark: raw.image_url_dark ?? raw.image_url_light ?? raw.image_url,
    },
    raw.name
  );

  return {
    imageUrl: imageSet.defaultUrl,
    imageUrlLight: imageSet.lightUrl,
    imageUrlDark: imageSet.darkUrl,
  };
}

function getLatitude(raw: RawDestination): number | undefined {
  return typeof raw.latitude === "number" && Number.isFinite(raw.latitude)
    ? raw.latitude
    : undefined;
}

function getLongitude(raw: RawDestination): number | undefined {
  return typeof raw.longitude === "number" && Number.isFinite(raw.longitude)
    ? raw.longitude
    : undefined;
}

function haversineDistanceKm(
  startLatitude: number,
  startLongitude: number,
  endLatitude: number,
  endLongitude: number
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(endLatitude - startLatitude);
  const deltaLongitude = toRadians(endLongitude - startLongitude);
  const normalizedStartLatitude = toRadians(startLatitude);
  const normalizedEndLatitude = toRadians(endLatitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(normalizedStartLatitude) *
      Math.cos(normalizedEndLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateDriveHoursFromCoordinates(
  raw: RawDestination,
  input: TripInput
): number | undefined {
  const departureLocation = getDepartureLocation(input.startCity);
  const destinationLatitude = getLatitude(raw);
  const destinationLongitude = getLongitude(raw);

  if (
    typeof departureLocation?.latitude !== "number" ||
    typeof departureLocation?.longitude !== "number" ||
    typeof destinationLatitude !== "number" ||
    typeof destinationLongitude !== "number"
  ) {
    return undefined;
  }

  const straightLineKm = haversineDistanceKm(
    departureLocation.latitude,
    departureLocation.longitude,
    destinationLatitude,
    destinationLongitude
  );
  const roadAdjustedKm = straightLineKm * 1.28;

  if (roadAdjustedKm <= 12) {
    return 0.35;
  }

  return Math.round((roadAdjustedKm / 78 + 0.2) * 10) / 10;
}

function resolveDriveTime(
  raw: RawDestination,
  input: TripInput
): {
  driveHours: number;
  driveTimeSource?: DriveTimeSource;
  driveTimeConfidence?: DriveTimeConfidence;
} {
  const exactStartKey = normalizeStartCityLookupKey(input.startCity);
  const exactDriveHours = raw.drive_time_hours_from[exactStartKey];
  if (typeof exactDriveHours === "number" && Number.isFinite(exactDriveHours)) {
    return {
      driveHours: exactDriveHours,
      driveTimeSource: "catalog_exact",
      driveTimeConfidence: "high",
    };
  }

  const startKey = getPlanningHubForStartCity(input.startCity);
  if (startKey) {
    const hubDriveHours = raw.drive_time_hours_from[startKey];
    if (typeof hubDriveHours === "number" && Number.isFinite(hubDriveHours)) {
      return {
        driveHours: hubDriveHours,
        driveTimeSource: "catalog_hub",
        driveTimeConfidence: "medium",
      };
    }
  }

  const estimatedDriveHours = estimateDriveHoursFromCoordinates(raw, input);
  if (
    typeof estimatedDriveHours === "number" &&
    Number.isFinite(estimatedDriveHours)
  ) {
    return {
      driveHours: estimatedDriveHours,
      driveTimeSource: "estimated_coordinates",
      driveTimeConfidence: "low",
    };
  }

  return { driveHours: 999 };
}

function normalizeStartCityLookupKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type RawHotelOption = {
  name: string;
  price_per_night?: number;
  booking_link?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
};

type RawFoodSpot = {
  name: string;
  tags?: string[];
  link?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
};

type RawAnchorExperience = {
  title: string;
  type: string;
  description?: string;
  link?: string;
  latitude?: number;
  longitude?: number;
};

type RawNeighborhood = {
  name: string;
  reason: string;
  link?: string;
};

export function mapRawDestination(
  raw: RawDestination,
  input: TripInput
): Destination {
  const imageSet = getImageSet(raw);
  const driveTime = resolveDriveTime(raw, input);

  const rawHotels = ((raw as RawDestination & { hotel_options?: RawHotelOption[] }).hotel_options ??
    []) as RawHotelOption[];

  const rawFoodSpots = ((raw as RawDestination & { food_spots?: RawFoodSpot[] }).food_spots ??
    []) as RawFoodSpot[];

  const rawAnchors = raw.anchor_experiences as RawAnchorExperience[];
  const rawNeighborhoods = raw.neighborhoods as RawNeighborhood[];

  const hotelOptions =
    rawHotels.length > 0
      ? rawHotels.map((hotel) => ({
          name: hotel.name,
          pricePerNight:
            typeof hotel.price_per_night === "number"
              ? hotel.price_per_night
              : estimateHotelPrice(raw.cost_level),
          pricingSource: "Trip estimate",
          availabilityStatus: "unverified" as const,
          availabilitySource: "Static destination data",
          bookingLink: hotel.booking_link ?? "",
          shortDescription: hotel.description ?? "",
          latitude: hotel.latitude,
          longitude: hotel.longitude,
        }))
      : [
          {
            name: raw.home_base_city,
            pricePerNight: estimateHotelPrice(raw.cost_level),
            pricingSource: "Trip estimate",
            availabilityStatus: "unverified" as const,
            availabilitySource: "Static destination data",
            bookingLink: "",
            shortDescription: "Practical base option for this destination.",
          },
        ];

  const foodSpots =
    rawFoodSpots.length > 0
      ? rawFoodSpots.map((spot) => ({
          name: spot.name,
          tags: Array.isArray(spot.tags) ? spot.tags : [],
          link: spot.link ?? "",
          shortDescription: spot.description ?? "",
          latitude: spot.latitude,
          longitude: spot.longitude,
        }))
      : rawNeighborhoods.map((n) => ({
          name: n.name,
          tags: [n.reason],
          link: n.link ?? "",
          shortDescription: n.reason,
        }));

  const topActivities = rawAnchors.map((exp) => ({
    name: exp.title,
    type: exp.type,
    costEstimate: estimateActivityCost(exp.type),
    bookingLink: exp.link ?? "",
    shortDescription: exp.description ?? "",
    latitude: exp.latitude,
    longitude: exp.longitude,
  }));

  return {
    name: raw.name,
    province: raw.region,
    driveHoursFromStart: driveTime.driveHours,
    driveTimeSource: driveTime.driveTimeSource,
    driveTimeConfidence: driveTime.driveTimeConfidence,
    bestSeasons: raw.best_seasons,
    avoidSeasons: raw.avoid_seasons,
    tripStyles: deriveTripStylesFromScores(raw.style_scores, raw),
    styleScores: raw.style_scores,
    budgetLevel: mapCostLevel(raw.cost_level),
    veganFriendly: false,
    summary: buildSummary(raw),
    imageUrl: imageSet.imageUrl,
    imageUrlLight: imageSet.imageUrlLight,
    imageUrlDark: imageSet.imageUrlDark,
    latitude: getLatitude(raw),
    longitude: getLongitude(raw),
    topActivities,
    hotelOptions,
    foodSpots,
    homeBaseCity: raw.home_base_city,
    rawVibes: raw.vibes,
    isStaycation: raw.is_staycation,
  };
}
