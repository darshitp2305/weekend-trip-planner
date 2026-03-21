import {
  BudgetBreakdown,
  ItineraryDayData,
  RankedDestination,
  TripDataSource,
  TripInput,
  TripPlan,
} from "./types";
import { deriveTripEndDate } from "./tripDates";

const defaultInput: TripInput = {
  startCity: "Edmonton",
  maxDriveHours: 5,
  maxDriveMinutesBetweenStops: 45,
  budget: 600,
  budgetPerTraveler: 300,
  travelerCount: 2,
  tripLengthDays: 2,
  season: "Summer",
  style: "adventure",
  veganFriendly: false,
  includeStaycations: false,
  strictBudget: false,
};

// Normalize partial API/UI input into a complete trip request so the planner
// runs with consistent assumptions everywhere.
function normalizeInput(input?: Partial<TripInput>): TripInput {
  const travelerCount = Number(
    input?.travelerCount ?? defaultInput.travelerCount
  );
  const budgetPerTraveler = Number(
    input?.budgetPerTraveler ?? defaultInput.budgetPerTraveler
  );
  const tripLengthDays = Number(
    input?.tripLengthDays ?? defaultInput.tripLengthDays
  );
  const tripStartDate =
    typeof input?.tripStartDate === "string" ? input.tripStartDate : undefined;

  return {
    ...defaultInput,
    ...input,
    maxDriveHours: Number(input?.maxDriveHours ?? defaultInput.maxDriveHours),
    maxDriveMinutesBetweenStops: Number(
      input?.maxDriveMinutesBetweenStops ??
        defaultInput.maxDriveMinutesBetweenStops
    ),
    budget:
      Number(input?.budget) ||
      travelerCount * budgetPerTraveler ||
      defaultInput.budget,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
  };
}

function roundMoney(value: number) {
  return Math.round(value);
}

function makeDriveText(trip: RankedDestination) {
  return `${trip.driveHoursFromStart} hour${
    trip.driveHoursFromStart === 1 ? "" : "s"
  }`;
}

function buildBudgetBreakdown(
  trip: RankedDestination,
  input: TripInput,
  itineraryDays: ItineraryDayData[]
): BudgetBreakdown {
  const nights = Math.max(input.tripLengthDays - 1, 1);
  const travelerCount = Math.max(1, input.travelerCount);

  const firstHotelPrice = trip.hotelOptions?.[0]?.pricePerNight;
  const firstHotelTotal = trip.hotelOptions?.[0]?.totalStayPrice;
  // Prefer concrete hotel totals when we have them, then fall back through
  // nightly rate and any upstream trip-level budget estimate.
  const hotelBase =
    trip.isStaycation
      ? 0
      : typeof firstHotelTotal === "number"
      ? firstHotelTotal
      : typeof firstHotelPrice === "number"
      ? firstHotelPrice * nights
      : trip.budgetBreakdown?.hotel ?? 0;

  const fallbackFoodPerDayPerTraveler =
    input.style === "foodie"
      ? 65
      : input.style === "chill" || input.style === "solo reset"
          ? 45
          : 50;

  // Use itinerary-selected food stops first so builder edits immediately
  // change the trip budget instead of waiting for a fresh generation pass.
  const foodBase =
    itineraryDays
      .flatMap((day) => day.stops)
      .filter((stop) => stop.kind === "food")
      .reduce((sum, stop) => {
        const estimated =
          typeof stop.estimatedCost === "number" && stop.estimatedCost > 0
            ? stop.estimatedCost
            : fallbackFoodPerDayPerTraveler * travelerCount * 0.8;
        return sum + estimated;
      }, 0) ||
    (trip.budgetBreakdown?.food && trip.budgetBreakdown.food > 0
      ? trip.budgetBreakdown.food
      : input.tripLengthDays * fallbackFoodPerDayPerTraveler * travelerCount);

  const gasBase = trip.isStaycation
    ? 0
    : trip.budgetBreakdown?.gas && trip.budgetBreakdown.gas > 0
    ? trip.budgetBreakdown.gas
    : Math.max(40, trip.driveHoursFromStart * 22);

  const activitiesFromItinerary = itineraryDays
    .flatMap((day) => day.stops)
    .filter((stop) => stop.kind === "activity")
    .reduce((sum, stop) => sum + (stop.estimatedCost || 0), 0);

  const activitiesBase =
    activitiesFromItinerary > 0
      ? activitiesFromItinerary
      : (trip.budgetBreakdown?.activities ?? 0);

  // Misc is an explicit contingency bucket for parking, tips, snacks, and
  // other small spend we do not model directly.
  const miscBase = roundMoney(
    (hotelBase + foodBase + gasBase + activitiesBase) * 0.1
  );

  const totalExpected = roundMoney(
    hotelBase + foodBase + gasBase + activitiesBase + miscBase
  );

  if (
    typeof trip.estimatedCost === "number" &&
    trip.estimatedCost > 0 &&
    totalExpected > trip.estimatedCost * 1.05 &&
    trip.budgetBreakdown
  ) {
    return trip.budgetBreakdown;
  }

  return {
    hotel: roundMoney(hotelBase),
    food: roundMoney(foodBase),
    gas: roundMoney(gasBase),
    activities: roundMoney(activitiesBase),
    misc: miscBase,
    total: totalExpected,
    totalLow: roundMoney(totalExpected * 0.9),
    totalExpected,
    totalHigh: roundMoney(totalExpected * 1.15),
  };
}

type FoodSpot = NonNullable<RankedDestination["foodSpots"]>[number];
type ActivitySpot = NonNullable<RankedDestination["topActivities"]>[number];
type CoordinateItem = {
  name?: string;
  latitude?: number;
  longitude?: number;
};
type StopCoordinate = {
  latitude: number;
  longitude: number;
};

type BuildContext = {
  remainingFoods: FoodSpot[];
  remainingActivities: ActivitySpot[];
  previousDayFoodNames: Set<string>;
  previousDayActivityNames: Set<string>;
};

type TripPacing = "easy" | "balanced" | "fatiguing";

type ProximityOptions = {
  reference?: StopCoordinate;
  maxDistanceKm?: number;
  minimumNearbyCount?: number;
  fallbackReference?: StopCoordinate;
  distancePenaltyStartKm?: number;
  distanceWeight?: number;
  keepUnknownCoordinates?: boolean;
};

function dedupeByName<T extends { name?: string }>(items: T[] | undefined): T[] {
  if (!items?.length) return [];

  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = (item.name ?? "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function itemName(item?: { name?: string }) {
  return (item?.name ?? "").trim().toLowerCase();
}

function toCoordinate(item?: CoordinateItem): StopCoordinate | undefined {
  if (
    typeof item?.latitude !== "number" ||
    typeof item?.longitude !== "number"
  ) {
    return undefined;
  }

  return {
    latitude: item.latitude,
    longitude: item.longitude,
  };
}

function haversineDistanceKm(from: StopCoordinate, to: StopCoordinate) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceFromReference(
  reference: StopCoordinate | undefined,
  item?: CoordinateItem
) {
  const coordinate = toCoordinate(item);
  if (!reference || !coordinate) return undefined;
  return haversineDistanceKm(reference, coordinate);
}

function maxLegDistanceKm(input: TripInput) {
  return Math.max(8, (input.maxDriveMinutesBetweenStops / 60) * 55);
}

function buildBaseCoordinate(trip: RankedDestination) {
  // Anchor proximity around the hotel first, then fall back to the destination
  // or top-ranked stops when lodging coordinates are missing.
  return (
    toCoordinate(trip.hotelOptions?.[0]) ??
    toCoordinate(trip) ??
    toCoordinate(trip.topActivities?.[0]) ??
    toCoordinate(trip.foodSpots?.[0])
  );
}

function proximityScore(
  distanceKm: number | undefined,
  options?: Pick<
    ProximityOptions,
    "maxDistanceKm" | "distancePenaltyStartKm" | "distanceWeight"
  >
) {
  // Nearby options are easier to stitch into a realistic day plan, so we
  // reward short hops and strongly penalize awkward detours.
  if (distanceKm === undefined) return 0;

  const maxDistanceKm = options?.maxDistanceKm ?? Number.POSITIVE_INFINITY;
  const distancePenaltyStartKm = options?.distancePenaltyStartKm ?? maxDistanceKm * 0.5;
  const distanceWeight = options?.distanceWeight ?? 1.2;

  if (distanceKm <= Math.max(2, distancePenaltyStartKm)) {
    return 16 - distanceKm * 0.6;
  }

  if (distanceKm <= maxDistanceKm) {
    return Math.max(-10, 8 - (distanceKm - distancePenaltyStartKm) * distanceWeight);
  }

  return -30 - (distanceKm - maxDistanceKm) * distanceWeight * 1.4;
}

function normalizeSignalText(parts: Array<string | undefined>) {
  return parts.join(" ").toLowerCase();
}

function getTripPacing(trip: RankedDestination): TripPacing {
  if (trip.isStaycation || trip.driveHoursFromStart <= 1.75) return "easy";
  if (trip.driveHoursFromStart <= 4) return "balanced";
  return "fatiguing";
}

function setPreviousDayFoods(
  ctx: BuildContext,
  items: Array<FoodSpot | undefined>
) {
  ctx.previousDayFoodNames = new Set(items.map(itemName).filter(Boolean));
}

function setPreviousDayActivities(
  ctx: BuildContext,
  items: Array<ActivitySpot | undefined>
) {
  ctx.previousDayActivityNames = new Set(items.map(itemName).filter(Boolean));
}

function buildContext(trip: RankedDestination): BuildContext {
  return {
    remainingFoods: dedupeByName(trip.foodSpots),
    remainingActivities: dedupeByName(trip.topActivities),
    previousDayFoodNames: new Set<string>(),
    previousDayActivityNames: new Set<string>(),
  };
}

function normalizedFoodSignals(food?: FoodSpot) {
  return normalizeSignalText([
    ...(food?.tags ?? []),
    food?.category ?? "",
    food?.name ?? "",
    food?.shortDescription ?? "",
  ]);
}

function isUtilityLikeFood(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);

  return (
    text.includes("general store") ||
    text.includes("convenience") ||
    text.includes("convenience store") ||
    text.includes("grocery") ||
    text.includes("supermarket") ||
    text.includes("gas station") ||
    text.includes("liquor store")
  );
}

function normalizedActivitySignals(activity?: ActivitySpot) {
  return normalizeSignalText([
    activity?.type ?? "",
    activity?.name ?? "",
    activity?.shortDescription ?? "",
  ]);
}

function styleActivityScore(activity: ActivitySpot | undefined, input: TripInput) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (input.style === "foodie") {
    if (
      text.includes("market") ||
      text.includes("food") ||
      text.includes("brew") ||
      text.includes("distillery") ||
      text.includes("tour")
    ) {
      score += 6;
    }
    if (
      text.includes("museum") ||
      text.includes("historic") ||
      text.includes("downtown")
    ) {
      score += 3;
    }
  }

  if (input.style === "adventure" || input.style === "outdoors") {
    if (
      text.includes("trail") ||
      text.includes("hike") ||
      text.includes("summit") ||
      text.includes("gondola") ||
      text.includes("lake") ||
      text.includes("canyon") ||
      text.includes("waterfall") ||
      text.includes("park")
    ) {
      score += 6;
    }
  }

  if (input.style === "chill" || input.style === "solo reset") {
    if (
      text.includes("spa") ||
      text.includes("hot spring") ||
      text.includes("viewpoint") ||
      text.includes("lake") ||
      text.includes("garden") ||
      text.includes("scenic") ||
      text.includes("wellness")
    ) {
      score += 6;
    }
  }

  if (input.style === "hidden gems") {
    if (
      text.includes("historic") ||
      text.includes("heritage") ||
      text.includes("local") ||
      text.includes("lookout") ||
      text.includes("museum") ||
      text.includes("trail")
    ) {
      score += 5;
    }
  }

  return score;
}

function styleFoodScore(food: FoodSpot | undefined, input: TripInput) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (isUtilityLikeFood(food)) {
    score -= 12;
  }

  if (input.style === "foodie") {
    if (
      text.includes("restaurant") ||
      text.includes("chef") ||
      text.includes("market") ||
      text.includes("bakery") ||
      text.includes("coffee") ||
      text.includes("brew")
    ) {
      score += 5;
    }
  }

  if (input.style === "chill" || input.style === "solo reset") {
    if (
      text.includes("cafe") ||
      text.includes("coffee") ||
      text.includes("bakery") ||
      text.includes("brunch") ||
      text.includes("tea")
    ) {
      score += 4;
    }
  }

  if (input.veganFriendly) {
    if (text.includes("vegan") || text.includes("vegetarian") || text.includes("plant")) {
      score += 4;
    }
  }

  return score;
}

function isAdminLikeActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);

  return (
    text.includes("visitor center") ||
    text.includes("visitor centre") ||
    text.includes("information center") ||
    text.includes("information centre") ||
    text.includes("corporate office") ||
    text.includes("tourism office") ||
    text.includes("office") ||
    text.includes("agency") ||
    text.includes("travel agency") ||
    text.includes("operator") ||
    text.includes("administrative") ||
    text.includes("business office")
  );
}

function foodScoreForMorning(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (isUtilityLikeFood(food)) {
    score -= 10;
  }

  if (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("espresso") ||
    text.includes("waffle")
  ) {
    score += 8;
  }

  if (text.includes("provisions") || text.includes("deli")) score += 4;
  if (text.includes("brew")) score += 2;

  if (
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("tavern") ||
    text.includes("dining")
  ) {
    score -= 6;
  }

  if (text.includes("restaurant")) score -= 3;
  if (text.includes("kitchen")) score -= 2;
  if (text.includes("bistro")) score -= 1;

  return score;
}

function foodScoreForDinner(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (isUtilityLikeFood(food)) {
    return -40;
  }

  if (
    text.includes("restaurant") ||
    text.includes("bistro") ||
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("kitchen") ||
    text.includes("tavern") ||
    text.includes("dining") ||
    text.includes("trattoria")
  ) {
    score += 8;
  }

  if (text.includes("cafe")) score -= 6;

  if (
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("waffle") ||
    text.includes("provisions")
  ) {
    score -= 7;
  }

  return score;
}

function foodScoreForArrivalDinner(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (isUtilityLikeFood(food)) {
    return -40;
  }

  if (
    text.includes("restaurant") ||
    text.includes("bistro") ||
    text.includes("kitchen") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("dining") ||
    text.includes("steak") ||
    text.includes("tavern") ||
    text.includes("trattoria")
  ) {
    score += 10;
  }

  if (text.includes("cafe")) score -= 8;

  if (
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("waffle") ||
    text.includes("provisions")
  ) {
    score -= 8;
  }

  return score;
}

function foodScoreForFinalLightStop(food?: FoodSpot) {
  const text = normalizedFoodSignals(food);
  let score = 0;

  if (isUtilityLikeFood(food)) {
    score -= 12;
  }

  if (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("bakery") ||
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("espresso") ||
    text.includes("waffle")
  ) {
    score += 10;
  }

  if (
    text.includes("provisions") ||
    text.includes("deli") ||
    text.includes("brew")
  ) {
    score += 5;
  }

  if (
    text.includes("restaurant") ||
    text.includes("steak") ||
    text.includes("grill") ||
    text.includes("bar") ||
    text.includes("tavern") ||
    text.includes("dining") ||
    text.includes("trattoria")
  ) {
    score -= 8;
  }

  if (text.includes("bistro")) score -= 4;
  if (text.includes("kitchen")) score -= 3;

  return score;
}

function activityAnchorScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("national park") ||
    text.includes("museum") ||
    text.includes("planetarium") ||
    text.includes("historic") ||
    text.includes("landmark") ||
    text.includes("gondola") ||
    text.includes("viewpoint") ||
    text.includes("trail") ||
    text.includes("waterfall") ||
    text.includes("lake") ||
    text.includes("hot spring") ||
    text.includes("lookout") ||
    text.includes("canyon") ||
    text.includes("tourist_attraction")
  ) {
    score += 10;
  }

  if (text.includes("park")) score += 5;
  if (text.includes("tour")) score += 4;

  if (text.includes("red chair") || text.includes("totem pole")) {
    score -= 2;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 12;
  }

  return score;
}

function activitySecondaryScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("museum") ||
    text.includes("historic") ||
    text.includes("landmark") ||
    text.includes("viewpoint") ||
    text.includes("trail") ||
    text.includes("park") ||
    text.includes("lake") ||
    text.includes("tour") ||
    text.includes("planetarium") ||
    text.includes("tourist_attraction")
  ) {
    score += 6;
  }

  if (text.includes("red chair") || text.includes("totem pole")) {
    score += 1;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 10;
  }

  return score;
}

function activityFinalLightScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("viewpoint") ||
    text.includes("lake") ||
    text.includes("landmark") ||
    text.includes("historic") ||
    text.includes("trail") ||
    text.includes("park") ||
    text.includes("red chair") ||
    text.includes("totem pole") ||
    text.includes("tourist_attraction")
  ) {
    score += 7;
  }

  if (text.includes("museum") || text.includes("planetarium")) {
    score += 2;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 12;
  }

  return score;
}

function popBestItem<T extends CoordinateItem>(
  pool: T[],
  previousDayNames: Set<string>,
  blockedNames: Set<string>,
  scorer: (item: T) => number,
  minScore: number,
  proximity?: ProximityOptions
): T | undefined {
  const candidates = pool
    .map((item, index) => ({
      item,
      index,
      distanceKm: distanceFromReference(proximity?.reference, item),
      fallbackDistanceKm: distanceFromReference(proximity?.fallbackReference, item),
      wasYesterday: previousDayNames.has(itemName(item)),
      key: itemName(item),
    }))
    .filter(({ item }) => !blockedNames.has(itemName(item)));

  if (candidates.length === 0) return undefined;

  const maxDistanceKm = proximity?.maxDistanceKm;
  const minimumNearbyCount = proximity?.minimumNearbyCount ?? 2;
  const keepUnknownCoordinates = proximity?.keepUnknownCoordinates ?? false;
  const nearEnoughCandidates =
    maxDistanceKm === undefined
      ? candidates
      : candidates.filter(
          ({ distanceKm }) =>
            distanceKm !== undefined && distanceKm <= maxDistanceKm
        );

  const effectiveCandidates =
    maxDistanceKm !== undefined &&
    proximity?.reference &&
    nearEnoughCandidates.length >= minimumNearbyCount
      ? candidates.filter(
          ({ distanceKm }) =>
            distanceKm !== undefined
              ? distanceKm <= maxDistanceKm
              : keepUnknownCoordinates
        )
      : candidates;

  const scoredCandidates = effectiveCandidates.map((candidate) => {
    const distanceKm = candidate.distanceKm ?? candidate.fallbackDistanceKm;

    return {
      ...candidate,
      distanceKm,
      score:
        scorer(candidate.item) +
        proximityScore(distanceKm, {
          maxDistanceKm,
          distancePenaltyStartKm: proximity?.distancePenaltyStartKm,
          distanceWeight: proximity?.distanceWeight,
        }),
    };
  });

  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.distanceKm ?? Infinity) !== (b.distanceKm ?? Infinity)) {
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    }
    if (a.wasYesterday !== b.wasYesterday) return a.wasYesterday ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  const best = scoredCandidates[0];
  if (!best || best.score < minScore) return undefined;

  const [picked] = pool.splice(best.index, 1);
  return picked;
}

function pickMorningFood(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    (food) => foodScoreForMorning(food) + styleFoodScore(food, input),
    4,
    proximity
  );
}

function pickDinnerFood(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    (food) => foodScoreForDinner(food) + styleFoodScore(food, input),
    8,
    proximity
  );
}

function pickArrivalDinnerFood(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    (food) => foodScoreForArrivalDinner(food) + styleFoodScore(food, input),
    8,
    proximity
  );
}

function pickLightFinalFood(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    (food) => foodScoreForFinalLightStop(food) + styleFoodScore(food, input),
    5,
    proximity
  );
}

function pickFlexibleFood(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingFoods,
    ctx.previousDayFoodNames,
    blockedNames,
    (food) => styleFoodScore(food, input) + normalizedFoodSignals(food).length * 0.001,
    0,
    proximity
  );
}

function pickAnchorActivity(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    (activity) => activityAnchorScore(activity) + styleActivityScore(activity, input),
    4,
    proximity
  );
}

function pickSecondaryActivity(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    (activity) =>
      activitySecondaryScore(activity) + styleActivityScore(activity, input),
    1,
    proximity
  );
}

function pickFinalLightActivity(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    (activity) =>
      activityFinalLightScore(activity) + styleActivityScore(activity, input),
    2,
    proximity
  );
}

function pickFlexibleActivity(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    (activity) =>
      styleActivityScore(activity, input) +
      activitySecondaryScore(activity) +
      normalizedActivitySignals(activity).length * 0.001,
    0,
    proximity
  );
}

function compactStops<T>(items: Array<T | undefined | false | null>): T[] {
  return items.filter(Boolean) as T[];
}

function middleDayTitle(
  dayNumber: number,
  totalDays: number,
  isStaycation: boolean
) {
  if (totalDays <= 3) return `Core experience day ${dayNumber}`;
  if (dayNumber === 2) {
    return isStaycation ? "Best local day" : "Anchor experience day";
  }
  if (dayNumber === totalDays - 1) {
    return isStaycation ? "Flexible local day" : "Recharge and favorites day";
  }
  if (dayNumber % 2 === 0) return `Exploration day ${dayNumber}`;
  return `Core experience day ${dayNumber}`;
}

function middleDaySummary(
  input: TripInput,
  dayNumber: number,
  totalDays: number,
  isStaycation: boolean
) {
  if (totalDays <= 3) {
    return `Use the middle of the trip for the strongest ${input.style} anchors instead of wasting it on logistics.`;
  }

  if (dayNumber === 2) {
    return isStaycation
      ? `Use day two for the strongest local ${input.style} stops while energy is high.`
      : `Use the first full day for the strongest ${input.style} anchors in the destination.`;
  }

  if (dayNumber === totalDays - 1) {
    return isStaycation
      ? "Keep this day flexible and use it for favorites you still have not hit."
      : "Use this day to revisit favorites or add lighter stops before the final return day.";
  }

  if (dayNumber % 2 === 0) {
    return `Mix one anchor stop with lighter exploration so the trip still feels sustainable by day ${dayNumber}.`;
  }

  return `Keep the trip varied by balancing one main anchor with food and flexible exploration on day ${dayNumber}.`;
}

function styleFoodDescription(input: TripInput, venueName: string, phase: "start" | "end" | "light") {
  if (input.style === "foodie") {
    if (phase === "start") return `Start with a strong local food stop at ${venueName}.`;
    if (phase === "end") return `Use ${venueName} as the dinner anchor so the day still feels food-forward.`;
    return `Use ${venueName} for one more local bite, bakery stop, or coffee run before you head out.`;
  }

  if (input.style === "hidden gems") {
    return `Use ${venueName} as a lower-key local heritage stop that still feels specific to the area.`;
  }

  return phase === "end"
    ? `Finish with dinner at ${venueName}.`
    : `Start the day at ${venueName}.`;
}

function styleActivityDescription(
  input: TripInput,
  activityName: string,
  phase: "anchor" | "secondary" | "light"
) {
  if (input.style === "hidden gems") {
    if (phase === "secondary") {
      return `Add ${activityName} for more local or heritage texture without overpacking the day.`;
    }
    return `Use ${activityName} as a scenic or local anchor that keeps the trip feeling distinctive.`;
  }

  if (input.style === "foodie") {
    return phase === "secondary"
      ? `Add ${activityName} if it still fits around the main food stops.`
      : `Use ${activityName} as a lighter anchor between the main meal stops.`;
  }

  return phase === "secondary"
    ? `Add ${activityName} if you still have energy.`
    : `Use ${activityName} as the main daytime anchor.`;
}

function makeFlexibleFoodStop(
  input: TripInput,
  trip: RankedDestination,
  time: string,
  title: string
) {
  return {
    time,
    title,
    description:
      input.style === "foodie"
        ? `Keep this slot for a local food crawl, bakery stop, coffee stop, or neighborhood restaurant in ${trip.name}.`
        : `Keep this slot flexible for one good local stop in ${trip.name}.`,
    estimatedCost:
      (input.style === "foodie" ? 36 : 22) * Math.max(1, input.travelerCount),
    kind: "food" as const,
  };
}

function makeFlexibleActivityStop(
  input: TripInput,
  trip: RankedDestination,
  time: string,
  title: string
) {
  return {
    time,
    title,
    description:
      input.style === "hidden gems"
        ? `Use this block for a scenic, heritage, local, or trail-side stop around ${trip.name}.`
        : input.style === "adventure" || input.style === "outdoors"
          ? `Use this block for one more outdoor anchor around ${trip.name}.`
          : `Keep this block open for a low-friction stop around ${trip.name}.`,
    estimatedCost: 0,
    kind: "activity" as const,
  };
}

function withDistanceCap<T extends CoordinateItem>(
  items: T[] | undefined,
  reference: StopCoordinate | undefined,
  maxDistanceKm: number,
  minimumNearbyCount: number
) {
  const safeItems = dedupeByName(items);
  if (!reference) return safeItems;

  const nearby = safeItems.filter((item) => {
    const distanceKm = distanceFromReference(reference, item);
    return distanceKm !== undefined && distanceKm <= maxDistanceKm;
  });

  if (nearby.length >= minimumNearbyCount) {
    return nearby;
  }

  return safeItems;
}

function buildFoodProximity(
  input: TripInput,
  reference: StopCoordinate | undefined,
  fallbackReference: StopCoordinate | undefined
): ProximityOptions {
  return {
    reference,
    fallbackReference,
    maxDistanceKm: maxLegDistanceKm(input),
    minimumNearbyCount: 2,
    distancePenaltyStartKm: Math.max(2, maxLegDistanceKm(input) * 0.35),
    distanceWeight: 1.5,
  };
}

function buildActivityProximity(
  input: TripInput,
  reference: StopCoordinate | undefined,
  fallbackReference: StopCoordinate | undefined
): ProximityOptions {
  return {
    reference,
    fallbackReference,
    maxDistanceKm: maxLegDistanceKm(input) * 1.4,
    minimumNearbyCount: 2,
    distancePenaltyStartKm: Math.max(3, maxLegDistanceKm(input) * 0.5),
    distanceWeight: 1.2,
  };
}

function buildStaycationDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const baseCoordinate = buildBaseCoordinate(trip);
  const breakfast =
    pickMorningFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    pickFlexibleFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    );
  const breakfastCoordinate = toCoordinate(breakfast);
  const activity =
    pickAnchorActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    ) ??
    pickFlexibleActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    );
  const activityCoordinate = toCoordinate(activity);
  const dinner =
    pickDinnerFood(
      ctx,
      input,
      new Set([itemName(breakfast)]),
      buildFoodProximity(
        input,
        activityCoordinate ?? breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    ) ??
    (input.style === "foodie" || input.style === "chill" || input.style === "solo reset"
      ? pickFlexibleFood(
          ctx,
          input,
          new Set([itemName(breakfast)]),
          buildFoodProximity(
            input,
            activityCoordinate ?? breakfastCoordinate ?? baseCoordinate,
            baseCoordinate
          )
        )
      : undefined);

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Local reset day",
    summary: `Low-friction ${input.style} day with basically no travel overhead.`,
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: styleFoodDescription(input, breakfast.name, "start"),
        websiteUrl: breakfast.link,
        estimatedCost:
          (input.style === "foodie" ? 26 : input.style === "chill" || input.style === "solo reset" ? 20 : 22) *
          Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      activity && {
        time: "Afternoon",
        title: activity.name,
        description: styleActivityDescription(input, activity.name, "anchor"),
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activity.costEstimate ?? activity.estimatedCost ?? 0,
        kind: "activity" as const,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: styleFoodDescription(input, dinner.name, "end"),
        websiteUrl: dinner.link,
        estimatedCost:
          (input.style === "foodie" ? 42 : 34) * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      !breakfast &&
        !activity &&
        !dinner && {
          time: "Anytime",
          title: `Flexible ${input.style} day in ${trip.name}`,
          description:
            "Use this day for a low-friction local plan while more destination data loads in.",
          kind: "activity" as const,
        },
    ]),
  };
}

function buildStaycationFinalDay(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const baseCoordinate = buildBaseCoordinate(trip);
  const breakfast =
    pickLightFinalFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    pickFlexibleFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    );
  const breakfastCoordinate = toCoordinate(breakfast);
  const activity =
    pickFinalLightActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    ) ??
    pickFlexibleActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    );

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [activity]);

  return {
    title: "Second local day",
    summary:
      input.style === "foodie"
        ? "Use day two for one more meaningful local food stop without travel friction."
        : input.style === "hidden gems"
          ? "Use day two for one more scenic local stop without travel friction."
          : "Use day two for one more meaningful stop without travel friction.",
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: styleFoodDescription(input, breakfast.name, "light"),
        websiteUrl: breakfast.link,
        estimatedCost: 20 * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      activity && {
        time: "Afternoon",
        title: activity.name,
        description: styleActivityDescription(input, activity.name, "light"),
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activity.costEstimate ?? activity.estimatedCost ?? 0,
        kind: "activity" as const,
      },
      input.style === "foodie" &&
        !breakfast &&
        makeFlexibleFoodStop(
          input,
          trip,
          "Morning",
          `Local brunch or bakery stop in ${trip.name}`
        ),
      !breakfast &&
        !activity && {
          ...makeFlexibleActivityStop(
            input,
            trip,
            "Flexible",
            input.style === "hidden gems"
              ? `Low-key scenic heritage day in ${trip.name}`
              : `Low-key final day in ${trip.name}`
          ),
        },
    ]),
  };
}

function buildGetawayDayOne(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const hotel = trip.hotelOptions?.[0];
  const baseCoordinate = toCoordinate(hotel) ?? buildBaseCoordinate(trip);
  const dinner =
    pickArrivalDinnerFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    (input.style === "foodie"
      ? pickFlexibleFood(
          ctx,
          input,
          new Set<string>(),
          buildFoodProximity(input, baseCoordinate, baseCoordinate)
        )
      : undefined);
  const pacing = getTripPacing(trip);
  const arrivalActivity =
    pacing === "easy" || (pacing === "balanced" && (input.style === "adventure" || input.style === "outdoors"))
      ? pickFinalLightActivity(
          ctx,
          input,
          new Set<string>(),
          buildActivityProximity(input, baseCoordinate, baseCoordinate)
        ) ??
        pickFlexibleActivity(
          ctx,
          input,
          new Set<string>(),
          buildActivityProximity(input, baseCoordinate, baseCoordinate)
        )
      : undefined;

  setPreviousDayFoods(ctx, [dinner]);
  setPreviousDayActivities(ctx, [arrivalActivity]);

  return {
    title: "Arrival and easy first day",
    summary:
      input.style === "hidden gems"
        ? "Arrive, settle in, and keep the first day focused on a distinctive local feel instead of rushing the trip."
        : pacing === "fatiguing"
          ? "Use day one to arrive, settle in, and avoid burning the trip on an overstuffed first evening."
        : pacing === "balanced"
          ? "Get there, settle in, and keep the first day useful without forcing too much into it."
          : "Because the drive is short, day one can include one real stop without making the trip feel rushed.",
    stops: compactStops([
      {
        time: "Morning",
        title: `Drive from ${input.startCity} to ${trip.name}`,
        description: `Estimated drive: ${makeDriveText(trip)}.`,
        kind: "travel" as const,
      },
      hotel && {
        time: "Afternoon",
        title: `Check in at ${hotel.name}`,
        description: `Use ${hotel.name} as your base, then start light.`,
        websiteUrl: hotel.bookingLink ?? hotel.websiteUrl,
        kind: "stay" as const,
      },
      arrivalActivity && {
        time: "Late afternoon",
        title: arrivalActivity.name,
        description: `Add ${arrivalActivity.name} as a short arrival-day stop before dinner.`,
        websiteUrl: arrivalActivity.bookingLink ?? arrivalActivity.websiteUrl,
        estimatedCost:
          arrivalActivity.costEstimate ?? arrivalActivity.estimatedCost ?? 0,
        kind: "activity" as const,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: styleFoodDescription(input, dinner.name, "end"),
        websiteUrl: dinner.link,
        estimatedCost:
          (input.style === "foodie" ? 42 : 34) * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
    ]),
  };
}

function buildGetawayFinalDay(
  trip: RankedDestination,
  input: TripInput,
  ctx: BuildContext
): ItineraryDayData {
  const baseCoordinate =
    toCoordinate(trip.hotelOptions?.[0]) ?? buildBaseCoordinate(trip);
  const breakfast =
    pickLightFinalFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    ((input.style === "foodie" || input.style === "chill" || input.style === "solo reset")
      ? pickFlexibleFood(
          ctx,
          input,
          new Set<string>(),
          buildFoodProximity(input, baseCoordinate, baseCoordinate)
        )
      : undefined);
  const breakfastCoordinate = toCoordinate(breakfast);
  const finalActivity =
    pickFinalLightActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    ) ??
    ((input.style === "adventure" || input.style === "outdoors" || input.style === "hidden gems")
      ? pickFlexibleActivity(
          ctx,
          input,
          new Set<string>(),
          buildActivityProximity(
            input,
            breakfastCoordinate ?? baseCoordinate,
            baseCoordinate
          )
        )
      : undefined);

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [finalActivity]);

  return {
    title: "Final half-day and drive back",
    summary:
      input.style === "hidden gems"
        ? `Keep the final day lighter and use it for one more scenic or heritage stop before returning to ${input.startCity}.`
        : `Keep the final day lighter so the return to ${input.startCity} does not feel rushed.`,
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: styleFoodDescription(input, breakfast.name, "light"),
        websiteUrl: breakfast.link,
        estimatedCost: 20 * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      finalActivity && {
        time: "Late morning",
        title: finalActivity.name,
        description: styleActivityDescription(input, finalActivity.name, "light"),
        websiteUrl: finalActivity.bookingLink ?? finalActivity.websiteUrl,
        estimatedCost:
          finalActivity.costEstimate ?? finalActivity.estimatedCost ?? 0,
        kind: "activity" as const,
      },
      input.style === "foodie" &&
        !breakfast &&
        makeFlexibleFoodStop(
          input,
          trip,
          "Morning",
          `Last local coffee, bakery, or market stop in ${trip.name}`
        ),
      {
        time: "Afternoon",
        title: `Drive back to ${input.startCity}`,
        description:
          "Head back without turning the final day into a scramble.",
        kind: "travel" as const,
      },
    ]),
  };
}

function buildMiddleDay(
  trip: RankedDestination,
  input: TripInput,
  dayNumber: number,
  totalDays: number,
  ctx: BuildContext
): ItineraryDayData {
  const baseCoordinate =
    toCoordinate(trip.hotelOptions?.[0]) ?? buildBaseCoordinate(trip);
  const breakfast =
    pickMorningFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    ((input.style === "foodie" || input.style === "chill" || input.style === "solo reset")
      ? pickFlexibleFood(
          ctx,
          input,
          new Set<string>(),
          buildFoodProximity(input, baseCoordinate, baseCoordinate)
        )
      : undefined);
  const breakfastCoordinate = toCoordinate(breakfast);
  const mainActivity =
    pickAnchorActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    ) ??
    pickFlexibleActivity(
      ctx,
      input,
      new Set<string>(),
      buildActivityProximity(
        input,
        breakfastCoordinate ?? baseCoordinate,
        baseCoordinate
      )
    );
  const mainActivityCoordinate = toCoordinate(mainActivity);

  const buildLightDay = dayNumber % 2 === 0 && totalDays >= 5;
  const secondaryActivity = buildLightDay
    ? undefined
    : pickSecondaryActivity(
        ctx,
        input,
        new Set([itemName(mainActivity)]),
        buildActivityProximity(
          input,
          mainActivityCoordinate ?? breakfastCoordinate ?? baseCoordinate,
          baseCoordinate
        )
      ) ??
      ((input.style === "adventure" || input.style === "outdoors" || input.style === "hidden gems")
        ? pickFlexibleActivity(
            ctx,
            input,
            new Set([itemName(mainActivity)]),
            buildActivityProximity(
              input,
              mainActivityCoordinate ?? breakfastCoordinate ?? baseCoordinate,
              baseCoordinate
            )
          )
        : undefined);
  const secondaryActivityCoordinate = toCoordinate(secondaryActivity);

  const dinner =
    pickDinnerFood(
      ctx,
      input,
      new Set([itemName(breakfast)]),
      buildFoodProximity(
        input,
        secondaryActivityCoordinate ??
          mainActivityCoordinate ??
          breakfastCoordinate ??
          baseCoordinate,
        baseCoordinate
      )
    ) ??
    ((input.style === "foodie" || input.style === "chill" || input.style === "solo reset")
      ? pickFlexibleFood(
          ctx,
          input,
          new Set([itemName(breakfast)]),
          buildFoodProximity(
            input,
            secondaryActivityCoordinate ??
              mainActivityCoordinate ??
              breakfastCoordinate ??
              baseCoordinate,
            baseCoordinate
          )
        )
      : undefined);

  setPreviousDayFoods(ctx, [breakfast, dinner]);
  setPreviousDayActivities(ctx, [mainActivity, secondaryActivity]);

  return {
    title: middleDayTitle(dayNumber, totalDays, trip.isStaycation),
    summary: middleDaySummary(
      input,
      dayNumber,
      totalDays,
      trip.isStaycation
    ),
    stops: compactStops([
      breakfast && {
        time: "Morning",
        title: breakfast.name,
        description: styleFoodDescription(input, breakfast.name, "start"),
        websiteUrl: breakfast.link,
        estimatedCost:
          (input.style === "foodie" ? 24 : 20) * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      mainActivity && {
        time: "Late morning",
        title: mainActivity.name,
        description: styleActivityDescription(input, mainActivity.name, "anchor"),
        websiteUrl: mainActivity.bookingLink ?? mainActivity.websiteUrl,
        estimatedCost: mainActivity.costEstimate ?? mainActivity.estimatedCost ?? 0,
        kind: "activity" as const,
      },
      secondaryActivity && {
        time: "Afternoon",
        title: secondaryActivity.name,
        description: styleActivityDescription(input, secondaryActivity.name, "secondary"),
        websiteUrl:
          secondaryActivity.bookingLink ?? secondaryActivity.websiteUrl,
        estimatedCost:
          secondaryActivity.costEstimate ??
          secondaryActivity.estimatedCost ??
          0,
        kind: "activity" as const,
      },
      dinner && {
        time: "Evening",
        title: dinner.name,
        description: styleFoodDescription(input, dinner.name, "end"),
        websiteUrl: dinner.link,
        estimatedCost:
          (input.style === "foodie" ? 42 : 34) * Math.max(1, input.travelerCount),
        kind: "food" as const,
      },
      !breakfast &&
        !mainActivity &&
        !secondaryActivity &&
        !dinner &&
        makeFlexibleActivityStop(
          input,
          trip,
          "Flexible",
          input.style === "hidden gems"
            ? `${middleDayTitle(dayNumber, totalDays, trip.isStaycation)} scenic local fallback`
            : `${middleDayTitle(dayNumber, totalDays, trip.isStaycation)} fallback`
        ),
      input.style === "foodie" &&
        !dinner &&
        makeFlexibleFoodStop(
          input,
          trip,
          "Evening",
          `Local dinner, bakery, or coffee window in ${trip.name}`
        ),
    ]),
  };
}

function buildItineraryDays(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData[] {
  const ctx = buildContext(trip);

  if (trip.isStaycation) {
    if (input.tripLengthDays <= 1) {
      return [buildStaycationDayOne(trip, input, ctx)];
    }

    if (input.tripLengthDays === 2) {
      return [
        buildStaycationDayOne(trip, input, ctx),
        buildStaycationFinalDay(trip, input, ctx),
      ];
    }

    const days: ItineraryDayData[] = [buildStaycationDayOne(trip, input, ctx)];
    for (let day = 2; day < input.tripLengthDays; day += 1) {
      days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
    }
    days.push(buildStaycationFinalDay(trip, input, ctx));
    return days;
  }

  if (input.tripLengthDays <= 1) {
    return [buildGetawayDayOne(trip, input, ctx)];
  }

  if (input.tripLengthDays === 2) {
    return [
      buildGetawayDayOne(trip, input, ctx),
      buildGetawayFinalDay(trip, input, ctx),
    ];
  }

  const days: ItineraryDayData[] = [buildGetawayDayOne(trip, input, ctx)];
  for (let day = 2; day < input.tripLengthDays; day += 1) {
    days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
  }
  days.push(buildGetawayFinalDay(trip, input, ctx));
  return days;
}

export function buildTripPlan(
  trip: RankedDestination,
  input?: Partial<TripInput>,
  dataSource: TripDataSource = "static-fallback"
): TripPlan {
  const safeInput = normalizeInput(input);
  const baseCoordinate = buildBaseCoordinate(trip);
  const foodDistanceCapKm = maxLegDistanceKm(safeInput);
  const activityDistanceCapKm = foodDistanceCapKm * 1.4;
  const filteredHotels = withDistanceCap(
    trip.hotelOptions ?? [],
    toCoordinate(trip) ?? baseCoordinate,
    activityDistanceCapKm,
    2
  );
  const filteredFoodSpots = withDistanceCap(
    trip.foodSpots ?? [],
    toCoordinate(filteredHotels[0]) ?? baseCoordinate,
    foodDistanceCapKm,
    3
  );
  const filteredActivities = withDistanceCap(
    trip.topActivities ?? [],
    toCoordinate(filteredHotels[0]) ?? baseCoordinate,
    activityDistanceCapKm,
    3
  );
  const filteredTrip: RankedDestination = {
    ...trip,
    hotelOptions: filteredHotels,
    foodSpots: filteredFoodSpots,
    topActivities: filteredActivities,
  };
  const itineraryDays = buildItineraryDays(filteredTrip, safeInput);
  const budgetBreakdown = buildBudgetBreakdown(
    filteredTrip,
    safeInput,
    itineraryDays
  );

  const driveHoursFromStart = trip.isStaycation ? 0 : trip.driveHoursFromStart;
  const driveTimeText = trip.isStaycation ? "0 hours" : makeDriveText(trip);

  return {
    id: crypto.randomUUID(),

    destinationName: trip.name,
    startCity: safeInput.startCity,
    region: trip.province,
    summary: trip.summary,
    imageUrl: trip.imageUrl,

    driveTimeText,
    score: trip.score,
    styleMatchStrength: trip.styleMatchStrength,
    confidence: trip.confidence,
    liveDataSummary: trip.liveDataSummary,
    rankingReasons: trip.rankingReasons ?? [],
    tags: trip.rawVibes ?? [],

    budgetBreakdown,
    hotelOptions: filteredHotels,
    foodSpots: filteredFoodSpots,
    topActivities: filteredActivities,
    itineraryDays,

    aiSummary: trip.aiSummary ?? "",
    aiBudgetNote: trip.aiBudgetNote ?? "",
    aiBestFit: trip.aiBestFit ?? "",

    dataSource,
    createdAt: new Date().toISOString(),
    sourceCheckedAt: trip.sourceCheckedAt,
    providerStatus: trip.providerStatus,
    travelerCount: safeInput.travelerCount,
    budgetPerTraveler: safeInput.budgetPerTraveler,
    totalBudget: safeInput.budget,
    tripLengthDays: safeInput.tripLengthDays,
    tripStartDate: safeInput.tripStartDate,
    tripEndDate: safeInput.tripEndDate,
    maxDriveMinutesBetweenStops: safeInput.maxDriveMinutesBetweenStops,
    status: "draft",
    decisionStatus: "waiting_on_partner",
    bookingChecklist: {
      reservedStay: {
        done: false,
      },
      exportedCalendar: {
        done: false,
      },
      confirmedTravelers: {
        done: false,
      },
      sharedItinerary: {
        done: false,
      },
    },

    name: trip.name,
    title: trip.name,
    destination: trip.name,
    province: trip.province,
    driveHoursFromStart,
    rawVibes: trip.rawVibes ?? [],
    source: dataSource,
    isStaycation: trip.isStaycation,
    homeBaseCity: trip.homeBaseCity,
  } as TripPlan;
}
