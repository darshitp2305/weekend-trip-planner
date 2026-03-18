import { enrichRankedTrip } from "./enrichTrip";
import { rankDestinations } from "./rankDestinations";
import { RankedDestination, TripInput } from "./types";

type GenerateRankedTripsResult = {
  initialCandidates: RankedDestination[];
  finalTrips: RankedDestination[];
  usedLiveData: boolean;
};

type RankingReason = NonNullable<RankedDestination["rankingReasons"]>[number];

type PrioritizedReason = RankingReason & {
  priority: number;
  weight: number;
  family: string;
};

type BoardRole = "home_city_anchor" | "getaway_anchor" | "balanced_alt" | "general";

type EnrichedCandidate = RankedDestination & {
  _reasonPool: PrioritizedReason[];
  _postScore: number;
  _boardRole: BoardRole;
  _liveStrength: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function confidenceOrder(confidence?: RankedDestination["confidence"]): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function normalizeCity(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/staycation/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tripBaseCity(trip: RankedDestination): string {
  const possible = [
    (trip as RankedDestination & { homeBase?: string }).homeBase,
    trip.name,
    trip.summary,
  ];

  for (const item of possible) {
    const normalized = normalizeCity(item);
    if (normalized) {
      if (normalized.includes("calgary")) return "calgary";
      if (normalized.includes("edmonton")) return "edmonton";
      if (normalized.includes("banff")) return "banff";
      if (normalized.includes("canmore")) return "canmore";
      if (normalized.includes("jasper")) return "jasper";
      if (normalized.includes("drumheller")) return "drumheller";
      if (normalized.includes("nordegg")) return "nordegg";
      if (normalized.includes("kananaskis")) return "kananaskis";
      return normalized;
    }
  }

  return "";
}

function isHomeCityTrip(trip: RankedDestination, startCity: string): boolean {
  const start = normalizeCity(startCity);
  const base = tripBaseCity(trip);

  if (!start || !base) return false;
  return base === start;
}

function isCrossCityStaycation(trip: RankedDestination, startCity: string): boolean {
  return Boolean(trip.isStaycation) && !isHomeCityTrip(trip, startCity);
}

function makeReason(
  label: string,
  impact: "positive" | "negative" | "neutral",
  priority: number,
  weight: number,
  family: string
): PrioritizedReason {
  return { label, impact, priority, weight, family };
}

function normalizeExistingReason(reason: RankingReason, index: number): PrioritizedReason {
  const lower = reason.label.toLowerCase();

  if (lower.includes("excellent live restaurant coverage")) {
    return { ...reason, priority: 1, weight: 98 - index, family: "live_restaurant_coverage" };
  }
  if (lower.includes("strong live restaurant coverage")) {
    return { ...reason, priority: 1, weight: 92 - index, family: "live_restaurant_coverage" };
  }
  if (lower.includes("solid live restaurant coverage")) {
    return { ...reason, priority: 2, weight: 82 - index, family: "live_restaurant_coverage" };
  }

  if (lower.includes("excellent restaurant ratings")) {
    return { ...reason, priority: 1, weight: 96 - index, family: "restaurant_ratings" };
  }
  if (lower.includes("high restaurant ratings")) {
    return { ...reason, priority: 1, weight: 90 - index, family: "restaurant_ratings" };
  }
  if (lower.includes("good restaurant ratings")) {
    return { ...reason, priority: 2, weight: 78 - index, family: "restaurant_ratings" };
  }

  if (lower.includes("foodie option still feels like a real getaway")) {
    return { ...reason, priority: 1, weight: 94 - index, family: "getaway_foodie" };
  }
  if (lower.includes("adds getaway value beyond pure city density")) {
    return { ...reason, priority: 2, weight: 84 - index, family: "getaway_foodie" };
  }
  if (lower.includes("foodie mountain alternative with easier access")) {
    return { ...reason, priority: 1, weight: 95 - index, family: "mountain_foodie_access" };
  }

  if (lower.includes("excellent live activity coverage")) {
    return { ...reason, priority: 1, weight: 98 - index, family: "live_activity_coverage" };
  }
  if (lower.includes("strong live activity coverage")) {
    return { ...reason, priority: 1, weight: 90 - index, family: "live_activity_coverage" };
  }
  if (lower.includes("solid live activity coverage")) {
    return { ...reason, priority: 2, weight: 80 - index, family: "live_activity_coverage" };
  }

  if (lower.includes("excellent activity ratings")) {
    return { ...reason, priority: 1, weight: 95 - index, family: "activity_ratings" };
  }
  if (lower.includes("high activity ratings")) {
    return { ...reason, priority: 1, weight: 89 - index, family: "activity_ratings" };
  }
  if (lower.includes("good activity ratings")) {
    return { ...reason, priority: 2, weight: 76 - index, family: "activity_ratings" };
  }

  if (lower.includes("good hotel coverage")) {
    return { ...reason, priority: 1, weight: 86 - index, family: "hotel_coverage" };
  }
  if (lower.includes("usable hotel coverage")) {
    return { ...reason, priority: 2, weight: 74 - index, family: "hotel_coverage" };
  }
  if (lower.includes("thin hotel coverage")) {
    return { ...reason, priority: 1, weight: 90 - index, family: "hotel_coverage" };
  }

  if (lower.includes("backed by live google places")) {
    return { ...reason, priority: 4, weight: 10, family: "source_live_places" };
  }
  if (lower.includes("fallback")) {
    return { ...reason, priority: 4, weight: 8, family: "source_fallback" };
  }

  if (lower.includes("budget") || lower.includes("value")) {
    return { ...reason, priority: 2, weight: 66 - index, family: "budget_value" };
  }

  if (lower.includes("drive")) {
    return { ...reason, priority: 5, weight: 24 - index, family: "drive_fit" };
  }

  if (lower.includes("especially strong")) {
    return { ...reason, priority: 1, weight: 88 - index, family: "style_fit" };
  }
  if (lower.includes("strong style match")) {
    return { ...reason, priority: 2, weight: 70 - index, family: "style_fit" };
  }

  return { ...reason, priority: 3, weight: 40 - index, family: "general" };
}

function sortReasons(reasons: PrioritizedReason[]): PrioritizedReason[] {
  const impactOrder = { positive: 3, neutral: 2, negative: 1 };

  return [...reasons].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return impactOrder[b.impact] - impactOrder[a.impact];
  });
}

function mergeAndRankReasons(
  baseReasons: RankedDestination["rankingReasons"],
  extraReasons: PrioritizedReason[]
): PrioritizedReason[] {
  const normalizedBase = (baseReasons ?? []).map(normalizeExistingReason);
  const merged = [...normalizedBase, ...extraReasons];

  const deduped = Array.from(
    new Map(merged.map((reason) => [`${reason.impact}:${reason.label}`, reason])).values()
  );

  return sortReasons(deduped);
}

function joinedTripText(trip: RankedDestination): string {
  return [
    trip.name,
    trip.summary,
    ...(trip.rawVibes ?? []),
    ...(trip.matchReasons ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function getGetawaySignal(trip: RankedDestination): number {
  const joined = joinedTripText(trip);

  let score = 0;
  const keywords = [
    "mountain",
    "lake",
    "scenic",
    "retreat",
    "hot springs",
    "hot_springs",
    "viewpoint",
    "badlands",
    "park",
    "nature",
    "cabin",
  ];

  for (const keyword of keywords) {
    if (joined.includes(keyword)) score += 1;
  }

  if (!trip.isStaycation && trip.driveHoursFromStart >= 1) score += 1;
  if (!trip.isStaycation && trip.driveHoursFromStart <= 4.5) score += 1;

  return score;
}

function getMountainAccessSignal(trip: RankedDestination): number {
  const joined = joinedTripText(trip);

  let score = 0;
  const keywords = ["mountain", "rockies", "canmore", "banff", "lake", "scenic", "viewpoint"];

  for (const keyword of keywords) {
    if (joined.includes(keyword)) score += 1;
  }

  if (!trip.isStaycation && trip.driveHoursFromStart <= 2.25) score += 1;

  return score;
}

function getCitySignal(trip: RankedDestination): number {
  const joined = joinedTripText(trip);
  let score = 0;
  const keywords = [
    "downtown",
    "cafes",
    "café",
    "food",
    "nightlife",
    "culture",
    "restaurant",
    "shop",
    "avenue",
  ];

  for (const keyword of keywords) {
    if (joined.includes(keyword)) score += 1;
  }

  if (trip.isStaycation) score += 2;
  if (trip.driveHoursFromStart <= 0.5) score += 1;

  return score;
}

function getLiveStrengthScore(trip: RankedDestination, style: TripInput["style"]): number {
  const summary = trip.liveDataSummary;
  if (!summary) return 0;

  if (style === "foodie") {
    let score = 0;
    if ((summary.restaurantCount ?? 0) >= 8) score += 3;
    else if ((summary.restaurantCount ?? 0) >= 5) score += 2;
    else if ((summary.restaurantCount ?? 0) >= 3) score += 1;

    if ((summary.avgRestaurantRating ?? 0) >= 4.6) score += 3;
    else if ((summary.avgRestaurantRating ?? 0) >= 4.3) score += 2;
    else if ((summary.avgRestaurantRating ?? 0) >= 4.1) score += 1;

    if (summary.usedPlacesData) score += 1;
    return score;
  }

  if (style === "adventure" || style === "outdoors") {
    let score = 0;
    if ((summary.activityCount ?? 0) >= 6) score += 3;
    else if ((summary.activityCount ?? 0) >= 4) score += 2;
    else if ((summary.activityCount ?? 0) >= 2) score += 1;

    if ((summary.avgActivityRating ?? 0) >= 4.6) score += 3;
    else if ((summary.avgActivityRating ?? 0) >= 4.3) score += 2;
    else if ((summary.avgActivityRating ?? 0) >= 4.1) score += 1;

    if (summary.usedPlacesData) score += 1;
    return score;
  }

  if (style === "chill" || style === "solo reset") {
    let score = 0;
    if ((summary.hotelCount ?? 0) >= 5) score += 3;
    else if ((summary.hotelCount ?? 0) >= 3) score += 2;
    else if ((summary.hotelCount ?? 0) >= 2) score += 1;

    if (summary.usedPlacesData) score += 1;
    return score;
  }

  return summary.usedPlacesData ? 1 : 0;
}

function isMountainFoodieAlternative(
  trip: RankedDestination,
  restaurantCount: number,
  restaurantRating: number
): boolean {
  const mountainSignal = getMountainAccessSignal(trip);
  return (
    !trip.isStaycation &&
    mountainSignal >= 4 &&
    trip.driveHoursFromStart <= 2.25 &&
    restaurantCount >= 3 &&
    restaurantRating >= 4.1
  );
}

function calculateFoodieLiveBoost(
  trip: RankedDestination,
  input: TripInput
): { boost: number; reasons: PrioritizedReason[]; role: BoardRole } {
  const summary = trip.liveDataSummary;
  const reasons: PrioritizedReason[] = [];
  if (!summary) return { boost: 0, reasons, role: "general" };

  let boost = 0;
  const restaurantCount = summary.restaurantCount ?? 0;
  const restaurantRating = summary.avgRestaurantRating ?? 0;
  const getawaySignal = getGetawaySignal(trip);
  const citySignal = getCitySignal(trip);

  let role: BoardRole = "general";
  const homeCity = isHomeCityTrip(trip, input.startCity);
  const crossCityStaycation = isCrossCityStaycation(trip, input.startCity);

  if (restaurantCount >= 10) {
    boost += 8;
    reasons.push(makeReason("Excellent live restaurant coverage", "positive", 1, 98, "live_restaurant_coverage"));
  } else if (restaurantCount >= 7) {
    boost += 7;
    reasons.push(makeReason("Strong live restaurant coverage", "positive", 1, 92, "live_restaurant_coverage"));
  } else if (restaurantCount >= 4) {
    boost += 5;
    reasons.push(makeReason("Solid live restaurant coverage", "positive", 2, 82, "live_restaurant_coverage"));
  } else if (restaurantCount >= 2) {
    boost += 1;
    reasons.push(makeReason("Limited live restaurant coverage", "neutral", 3, 52, "live_restaurant_coverage"));
  } else {
    boost -= 6;
    reasons.push(makeReason("Thin live restaurant coverage", "negative", 1, 96, "live_restaurant_coverage"));
  }

  if (restaurantRating >= 4.6) {
    boost += 8;
    reasons.push(makeReason("Excellent restaurant ratings", "positive", 1, 97, "restaurant_ratings"));
  } else if (restaurantRating >= 4.4) {
    boost += 6;
    reasons.push(makeReason("High restaurant ratings", "positive", 1, 91, "restaurant_ratings"));
  } else if (restaurantRating >= 4.1) {
    boost += 3;
    reasons.push(makeReason("Good restaurant ratings", "positive", 2, 78, "restaurant_ratings"));
  } else if (restaurantCount > 0) {
    boost -= 2;
    reasons.push(makeReason("Restaurant ratings are less convincing", "negative", 2, 80, "restaurant_ratings"));
  }

  if (homeCity && (trip.isStaycation || citySignal >= 5)) {
    role = "home_city_anchor";
    boost += 2;
    reasons.push(makeReason("Best home-city foodie anchor", "positive", 1, 93, "home_city_fit"));
  }

  if (!trip.isStaycation && getawaySignal >= 5) {
    boost += 4;
    reasons.push(
      makeReason("Foodie option still feels like a real getaway", "positive", 1, 94, "getaway_foodie")
    );
    role = "getaway_anchor";
  } else if (!trip.isStaycation && getawaySignal >= 3) {
    boost += 2;
    reasons.push(
      makeReason("Adds getaway value beyond pure city density", "positive", 2, 84, "getaway_foodie")
    );
  }

  if (isMountainFoodieAlternative(trip, restaurantCount, restaurantRating)) {
    boost += 4;
    reasons.push(
      makeReason(
        "Foodie mountain alternative with easier access",
        "positive",
        1,
        96,
        "mountain_foodie_access"
      )
    );

    if (role !== "home_city_anchor" && role !== "getaway_anchor") {
      role = "balanced_alt";
    }
  }

  if (crossCityStaycation) {
    boost -= 8;
    reasons.push(
      makeReason(
        "Cross-city staycation is less convincing than a real getaway or true home-base option",
        "negative",
        1,
        99,
        "cross_city_staycation"
      )
    );
  }

  if (trip.isStaycation && input.maxDriveHours >= 4 && input.budget >= 350 && !homeCity) {
    boost -= 2;
    reasons.push(
      makeReason(
        "Convenient city pick, but weaker as a distinct getaway",
        "neutral",
        3,
        42,
        "staycation_balance"
      )
    );
  }

  if (summary.usedPlacesData) {
    boost += 1;
    reasons.push(makeReason("Backed by live Google Places results", "positive", 4, 10, "source_live_places"));
  } else if (summary.usedFallbackData) {
    boost -= 2;
    reasons.push(makeReason("Using fallback recommendation data", "neutral", 4, 8, "source_fallback"));
  }

  return { boost: round2(boost), reasons, role };
}

function calculateAdventureLiveBoost(
  trip: RankedDestination,
  input: TripInput
): { boost: number; reasons: PrioritizedReason[]; role: BoardRole } {
  const summary = trip.liveDataSummary;
  const reasons: PrioritizedReason[] = [];
  if (!summary) return { boost: 0, reasons, role: "general" };

  let boost = 0;
  let role: BoardRole = "general";
  const activityCount = summary.activityCount ?? 0;
  const activityRating = summary.avgActivityRating ?? 0;
  const getawaySignal = getGetawaySignal(trip);

  if (activityCount >= 8) {
    boost += 8;
    reasons.push(makeReason("Excellent live activity coverage", "positive", 1, 98, "live_activity_coverage"));
  } else if (activityCount >= 5) {
    boost += 6;
    reasons.push(makeReason("Strong live activity coverage", "positive", 1, 90, "live_activity_coverage"));
  } else if (activityCount >= 3) {
    boost += 3;
    reasons.push(makeReason("Solid live activity coverage", "positive", 2, 80, "live_activity_coverage"));
  } else if (activityCount >= 1) {
    boost -= 1;
    reasons.push(makeReason("Limited live activity coverage", "neutral", 3, 50, "live_activity_coverage"));
  } else {
    boost -= 6;
    reasons.push(makeReason("Thin live activity coverage", "negative", 1, 96, "live_activity_coverage"));
  }

  if (activityRating >= 4.6) {
    boost += 7;
    reasons.push(makeReason("Excellent activity ratings", "positive", 1, 95, "activity_ratings"));
  } else if (activityRating >= 4.4) {
    boost += 5;
    reasons.push(makeReason("High activity ratings", "positive", 1, 89, "activity_ratings"));
  } else if (activityRating >= 4.1) {
    boost += 2;
    reasons.push(makeReason("Good activity ratings", "positive", 2, 76, "activity_ratings"));
  }

  if (!trip.isStaycation && getawaySignal >= 5) {
    boost += 3;
    reasons.push(
      makeReason("Strong getaway value for this adventure trip", "positive", 1, 87, "getaway_adventure")
    );
    role = "getaway_anchor";
  }

  if (isCrossCityStaycation(trip, input.startCity)) {
    boost -= 6;
    reasons.push(
      makeReason("Cross-city staycation is weaker than a real adventure base", "negative", 1, 97, "cross_city_staycation")
    );
  }

  if (summary.usedPlacesData) {
    boost += 1;
    reasons.push(makeReason("Backed by live Google Places results", "positive", 4, 10, "source_live_places"));
  } else if (summary.usedFallbackData) {
    boost -= 2;
    reasons.push(makeReason("Using fallback recommendation data", "neutral", 4, 8, "source_fallback"));
  }

  return { boost: round2(boost), reasons, role };
}

function calculateChillLiveBoost(
  trip: RankedDestination,
  input: TripInput
): { boost: number; reasons: PrioritizedReason[]; role: BoardRole } {
  const summary = trip.liveDataSummary;
  const reasons: PrioritizedReason[] = [];
  if (!summary) return { boost: 0, reasons, role: "general" };

  let boost = 0;
  const role: BoardRole = isHomeCityTrip(trip, input.startCity)
    ? "home_city_anchor"
    : "balanced_alt";
  const hotelCount = summary.hotelCount ?? 0;

  if (hotelCount >= 5) {
    boost += 5;
    reasons.push(makeReason("Good hotel coverage", "positive", 1, 86, "hotel_coverage"));
  } else if (hotelCount >= 3) {
    boost += 2;
    reasons.push(makeReason("Usable hotel coverage", "positive", 2, 74, "hotel_coverage"));
  } else if (hotelCount <= 1) {
    boost -= 3;
    reasons.push(makeReason("Thin hotel coverage", "negative", 1, 90, "hotel_coverage"));
  }

  if (isCrossCityStaycation(trip, input.startCity)) {
    boost -= 6;
    reasons.push(
      makeReason("Cross-city staycation is weaker than a true low-friction home-base option", "negative", 1, 97, "cross_city_staycation")
    );
  }

  if (summary.usedPlacesData) {
    boost += 1;
    reasons.push(makeReason("Backed by live Google Places results", "positive", 4, 10, "source_live_places"));
  } else if (summary.usedFallbackData) {
    boost -= 2;
    reasons.push(makeReason("Using fallback recommendation data", "neutral", 4, 8, "source_fallback"));
  }

  return { boost: round2(boost), reasons, role };
}

function applyLiveBoosts(
  trips: RankedDestination[],
  input: TripInput
): EnrichedCandidate[] {
  return trips.map((trip) => {
    let boost = 0;
    let reasons: PrioritizedReason[] = [];
    let role: BoardRole = "general";

    if (input.style === "foodie") {
      const foodie = calculateFoodieLiveBoost(trip, input);
      boost += foodie.boost;
      reasons = reasons.concat(foodie.reasons);
      role = foodie.role;
    } else if (input.style === "adventure" || input.style === "outdoors") {
      const adventure = calculateAdventureLiveBoost(trip, input);
      boost += adventure.boost;
      reasons = reasons.concat(adventure.reasons);
      role = adventure.role;
    } else if (input.style === "chill" || input.style === "solo reset") {
      const chill = calculateChillLiveBoost(trip, input);
      boost += chill.boost;
      reasons = reasons.concat(chill.reasons);
      role = chill.role;
    } else if (trip.liveDataSummary?.usedPlacesData) {
      boost += 1;
      reasons.push(makeReason("Backed by live Google Places results", "positive", 4, 10, "source_live_places"));
    }

    const reasonPool = mergeAndRankReasons(trip.rankingReasons, reasons);

    return {
      ...trip,
      score: round2(trip.score + boost),
      _postScore: round2(trip.score + boost),
      _reasonPool: reasonPool,
      _boardRole: role,
      _liveStrength: getLiveStrengthScore(trip, input.style),
      rankingReasons: reasonPool.slice(0, 5).map(({ label, impact }) => ({ label, impact })),
    };
  });
}

function compareTrips(a: RankedDestination, b: RankedDestination): number {
  if (b.score !== a.score) return b.score - a.score;

  if (confidenceOrder(b.confidence) !== confidenceOrder(a.confidence)) {
    return confidenceOrder(b.confidence) - confidenceOrder(a.confidence);
  }

  if (b.styleMatchStrength !== a.styleMatchStrength) {
    const strengthOrder = { strong: 4, medium: 3, weak: 2, poor: 1 } as const;
    return strengthOrder[b.styleMatchStrength] - strengthOrder[a.styleMatchStrength];
  }

  return a.name.localeCompare(b.name);
}

function roleBonus(style: TripInput["style"], trip: EnrichedCandidate, selected: EnrichedCandidate[]): number {
  if (style !== "foodie" && style !== "chill" && style !== "solo reset") return 0;

  const alreadyHasHomeCity = selected.some((item) => item._boardRole === "home_city_anchor");
  const alreadyHasGetaway = selected.some((item) => item._boardRole === "getaway_anchor");
  const alreadyHasBalanced = selected.some((item) => item._boardRole === "balanced_alt");

  if (trip._boardRole === "home_city_anchor" && !alreadyHasHomeCity) return 5;
  if (trip._boardRole === "getaway_anchor" && !alreadyHasGetaway) return 3.5;
  if (trip._boardRole === "balanced_alt" && !alreadyHasBalanced) return 2.5;

  return 0;
}

function overlapPenalty(style: TripInput["style"], trip: EnrichedCandidate, selected: EnrichedCandidate[]): number {
  if (selected.length === 0) return 0;

  let penalty = 0;

  const selectedFamilies = new Set(
    selected.flatMap((item) => item._reasonPool.slice(0, 2).map((reason) => reason.family))
  );

  const tripTopFamilies = trip._reasonPool.slice(0, 2).map((reason) => reason.family);
  const overlapCount = tripTopFamilies.filter((family) => selectedFamilies.has(family)).length;

  penalty += overlapCount * 1.5;

  if (style === "foodie") {
    const selectedHomeCity = selected.some((item) => item._boardRole === "home_city_anchor");
    const selectedGetaway = selected.some((item) => item._boardRole === "getaway_anchor");

    if (selectedHomeCity && trip._boardRole === "home_city_anchor") penalty += 4;
    if (selectedGetaway && trip._boardRole === "getaway_anchor") penalty += 2;
  }

  return penalty;
}

function chooseBoard(
  trips: EnrichedCandidate[],
  input: TripInput,
  limit = 3
): EnrichedCandidate[] {
  const pool = [...trips].sort((a, b) => b._postScore - a._postScore);
  const selected: EnrichedCandidate[] = [];

  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const trip = pool[i];

      let value =
        trip._postScore +
        roleBonus(input.style, trip, selected) -
        overlapPenalty(input.style, trip, selected);

      if (input.style === "foodie" || input.style === "chill" || input.style === "solo reset") {
        if (isCrossCityStaycation(trip, input.startCity)) {
          value -= 10;
        }
      }

      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }

    selected.push(pool.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function getPreferredFamiliesForStyle(style: TripInput["style"]): string[] {
  switch (style) {
    case "foodie":
      return [
        "home_city_fit",
        "live_restaurant_coverage",
        "restaurant_ratings",
        "getaway_foodie",
        "mountain_foodie_access",
        "style_fit",
        "budget_value",
        "general",
        "source_live_places",
        "drive_fit",
      ];
    case "adventure":
    case "outdoors":
      return [
        "live_activity_coverage",
        "activity_ratings",
        "getaway_adventure",
        "style_fit",
        "budget_value",
        "general",
        "source_live_places",
        "drive_fit",
      ];
    case "chill":
    case "solo reset":
      return [
        "home_city_fit",
        "hotel_coverage",
        "style_fit",
        "budget_value",
        "general",
        "source_live_places",
        "drive_fit",
      ];
    default:
      return ["style_fit", "budget_value", "general", "source_live_places", "drive_fit"];
  }
}

function familyPreferenceScore(family: string, style: TripInput["style"]): number {
  const preferred = getPreferredFamiliesForStyle(style);
  const index = preferred.indexOf(family);
  return index === -1 ? 999 : index;
}

function hasFoodieSpecificAlternative(reasons: PrioritizedReason[]): boolean {
  return reasons.some((reason) =>
    [
      "home_city_fit",
      "live_restaurant_coverage",
      "restaurant_ratings",
      "getaway_foodie",
      "mountain_foodie_access",
    ].includes(reason.family)
  );
}

function pickLeadReason(
  reasons: PrioritizedReason[],
  usedFamilies: Set<string>,
  style: TripInput["style"]
): PrioritizedReason | null {
  if (reasons.length === 0) return null;

  let candidates = [...reasons];

  if (style === "foodie" && hasFoodieSpecificAlternative(reasons)) {
    candidates = candidates.filter((reason) => reason.family !== "drive_fit");
  }

  const ordered = candidates.sort((a, b) => {
    const aPref = familyPreferenceScore(a.family, style);
    const bPref = familyPreferenceScore(b.family, style);

    if (aPref !== bPref) return aPref - bPref;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });

  const freshPreferred = ordered.find(
    (reason) => !usedFamilies.has(reason.family) && familyPreferenceScore(reason.family, style) <= 4
  );
  if (freshPreferred) return freshPreferred;

  const freshTopTier = ordered.find((reason) => !usedFamilies.has(reason.family) && reason.priority <= 2);
  if (freshTopTier) return freshTopTier;

  const freshAny = ordered.find((reason) => !usedFamilies.has(reason.family));
  if (freshAny) return freshAny;

  return ordered[0] ?? reasons[0];
}

function finalizeReasons(
  reasons: PrioritizedReason[],
  usedFamilies: Set<string>,
  style: TripInput["style"]
): RankingReason[] {
  if (reasons.length === 0) return [];

  const chosen: PrioritizedReason[] = [];
  const lead = pickLeadReason(reasons, usedFamilies, style);

  if (lead) {
    chosen.push(lead);
    usedFamilies.add(lead.family);
  }

  const remaining = [...reasons].sort((a, b) => {
    const aPref = familyPreferenceScore(a.family, style);
    const bPref = familyPreferenceScore(b.family, style);

    if (aPref !== bPref) return aPref - bPref;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.weight - a.weight;
  });

  for (const reason of remaining) {
    if (chosen.some((picked) => picked.label === reason.label && picked.impact === reason.impact)) {
      continue;
    }

    if (!usedFamilies.has(reason.family)) {
      chosen.push(reason);
      usedFamilies.add(reason.family);
    }

    if (chosen.length >= 5) break;
  }

  if (chosen.length < 5) {
    for (const reason of remaining) {
      if (!chosen.some((picked) => picked.label === reason.label && picked.impact === reason.impact)) {
        chosen.push(reason);
      }
      if (chosen.length >= 5) break;
    }
  }

  return chosen.slice(0, 5).map(({ label, impact }) => ({ label, impact }));
}

function countStrongReasonFamilies(trip: RankedDestination): number {
  const reasons = (trip.rankingReasons ?? []).map((reason, index) => normalizeExistingReason(reason, index));

  return reasons.filter(
    (reason) =>
      reason.priority <= 2 &&
      [
        "home_city_fit",
        "live_restaurant_coverage",
        "restaurant_ratings",
        "getaway_foodie",
        "mountain_foodie_access",
        "live_activity_coverage",
        "activity_ratings",
        "getaway_adventure",
        "hotel_coverage",
        "style_fit",
        "budget_value",
      ].includes(reason.family)
  ).length;
}

function recalculateConfidence(
  trips: RankedDestination[],
  input: TripInput
): RankedDestination[] {
  const topScore = trips[0]?.score ?? 0;

  return trips.map((trip, index) => {
    let score = 0;

    if (trip.styleMatchStrength === "strong") score += 3;
    else if (trip.styleMatchStrength === "medium") score += 2;
    else if (trip.styleMatchStrength === "weak") score += 1;
    else score -= 1;

    const gapFromTop = topScore - trip.score;
    if (index === 0) score += 2;
    else if (gapFromTop <= 4) score += 1;
    else if (gapFromTop >= 10) score -= 2;
    else if (gapFromTop >= 6) score -= 1;

    const nextTrip = trips[index + 1];
    const leadOverNext = nextTrip ? trip.score - nextTrip.score : 0;
    if (leadOverNext >= 6) score += 1;

    score += getLiveStrengthScore(trip, input.style);

    const strongReasons = countStrongReasonFamilies(trip);
    if (strongReasons >= 3) score += 2;
    else if (strongReasons >= 2) score += 1;

    if (trip.liveDataSummary?.usedFallbackData) score -= 2;
    if (!trip.liveDataSummary?.usedPlacesData) score -= 1;

    if (isCrossCityStaycation(trip, input.startCity)) score -= 3;

    if (index === 2) score -= 2;
    else if (index === 1) score -= 1;

    let confidence: RankedDestination["confidence"];
    let confidenceLabel: string;

    if (score >= 9) {
      confidence = "high";
      confidenceLabel = "Strong match";
    } else if (score >= 5) {
      confidence = "medium";
      confidenceLabel = "Good match";
    } else {
      confidence = "low";
      confidenceLabel = "Promising";
    }

    return {
      ...trip,
      confidence,
      confidenceLabel,
    };
  });
}

export async function generateRankedTrips(
  input: TripInput,
  options?: {
    shortlistSize?: number;
    finalLimit?: number;
    excludedDestinationNames?: string[];
  }
): Promise<GenerateRankedTripsResult> {
  const shortlistSize = options?.shortlistSize ?? 6;
  const finalLimit = options?.finalLimit ?? 3;

  const initialCandidates = rankDestinations(input, shortlistSize, {
    excludedDestinationNames: options?.excludedDestinationNames,
  });

  const enrichedTrips = await Promise.all(
    initialCandidates.map(async (trip) => {
      try {
        const enriched = await enrichRankedTrip(trip, input);
        return enriched.trip;
      } catch (error) {
        console.error(`Failed to enrich ${trip.name}:`, error);
        return trip;
      }
    })
  );

  const usedLiveData = enrichedTrips.some((trip) => trip.liveDataSummary?.usedPlacesData);

  const boostedTrips = applyLiveBoosts(enrichedTrips, input);
  const chosenBoard = chooseBoard(boostedTrips, input, finalLimit);

  const usedFamilies = new Set<string>();
  const withReasons: RankedDestination[] = chosenBoard
    .map((trip) => ({
      ...trip,
      rankingReasons: finalizeReasons(trip._reasonPool, usedFamilies, input.style),
    }))
    .sort(compareTrips);

  const finalTrips = recalculateConfidence(withReasons, input);

  return {
    initialCandidates,
    finalTrips,
    usedLiveData,
  };
}
