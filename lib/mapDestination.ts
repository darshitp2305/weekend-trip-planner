import { Destination, RawDestination, StyleScores, TripInput, TripStyle } from "./types";

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

function deriveTripStylesFromScores(styleScores: StyleScores, raw: RawDestination): TripStyle[] {
  const derivedStyles = (Object.entries(styleScores) as [TripStyle, number][])
    .filter(([, score]) => score >= 2)
    .map(([style]) => style);

  if (getHiddenGemSignal(raw) >= 2) {
    derivedStyles.push("hidden gems");
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

function buildSummary(raw: RawDestination): string {
  const topHighlights = raw.anchor_experiences
    .slice(0, 2)
    .map((exp) => exp.title)
    .join(" and ");

  return `${raw.name} is a ${raw.vibes.join(", ")} getaway in ${raw.region} with highlights like ${topHighlights}.`;
}

function estimateActivityCost(type: string): number {
  switch (type) {
    case "gondola":
      return 70;
    case "hot_springs":
      return 20;
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

function getImageUrl(raw: RawDestination): string | undefined {
  const value = (raw as RawDestination & { image_url?: string }).image_url;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

type RawHotelOption = {
  name: string;
  price_per_night?: number;
  booking_link?: string;
  description?: string;
};

type RawFoodSpot = {
  name: string;
  tags?: string[];
  link?: string;
  description?: string;
};

type RawAnchorExperience = {
  title: string;
  type: string;
  description?: string;
  link?: string;
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
  const startKey = input.startCity.toLowerCase();
  const driveHours = raw.drive_time_hours_from[startKey] ?? 999;

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
          bookingLink: hotel.booking_link ?? "",
          shortDescription: hotel.description ?? "",
        }))
      : [
          {
            name: raw.home_base_city,
            pricePerNight: estimateHotelPrice(raw.cost_level),
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
  }));

  return {
    name: raw.name,
    province: raw.region,
    driveHoursFromStart: driveHours,
    bestSeasons: raw.best_seasons,
    avoidSeasons: raw.avoid_seasons,
    tripStyles: deriveTripStylesFromScores(raw.style_scores, raw),
    styleScores: raw.style_scores,
    budgetLevel: mapCostLevel(raw.cost_level),
    veganFriendly: false,
    summary: buildSummary(raw),
    imageUrl: getImageUrl(raw),
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
