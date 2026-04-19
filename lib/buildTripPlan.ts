/**
 * Builds the normalized trip plan used by the UI and persistence layer.
 * This module merges raw destination data with dates, budgets, itinerary defaults, and edit tokens so the rest of the app can work with one consistent shape.
 */

import {
  BudgetBreakdown,
  BudgetOptimizationSummary,
  ItineraryDayData,
  ItineraryStop,
  RankedDestination,
  TripDataSource,
  TripInput,
  TripPlan,
  TripSelectionState,
} from "./types";
import { sortHotelOptions } from "./hotelAvailability";
import { deriveTripEndDate } from "./tripDates";
import { ensureTripEditToken } from "./tripSecurity";
import {
  optimizeSelectionForBudget,
} from "./tripSelections";
import {
  coffeeStopSpecificityScore,
  getRecommendedTripTitle,
  isGenericActivityDisplayName,
  normalizePlaceDisplayName,
  refineTripStayRecommendation,
  scenicHikeSpecificityScore,
} from "./tripSpecificity";
import {
  deriveTripIntentFromPrompt,
  extractPromptDepartureTime,
} from "./tripIntent";

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

export type TripPlanPreview = {
  safeInput: TripInput;
  filteredTrip: RankedDestination;
  budgetBreakdown: BudgetBreakdown;
  budgetOptimization?: BudgetOptimizationSummary;
  budgetSelectionState: TripSelectionState;
  itineraryDays: ItineraryDayData[];
  recommendedTitle: string;
  driveHoursFromStart: number;
  driveTimeText: string;
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
  const tripPrompt =
    typeof input?.tripPrompt === "string"
      ? input.tripPrompt.trim() || undefined
      : undefined;
  const departureTime =
    normalizeDepartureTime(input?.departureTime) ??
    extractPromptDepartureTime(tripPrompt);

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
    tripPrompt,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
    departureTime,
  };
}

function makeDriveText(trip: RankedDestination) {
  const routeMinutes =
    typeof trip.routeSummary?.durationSeconds === "number" &&
    Number.isFinite(trip.routeSummary.durationSeconds) &&
    trip.routeSummary.durationSeconds > 0
      ? Math.round(trip.routeSummary.durationSeconds / 60)
      : undefined;

  if (routeMinutes !== undefined) {
    const hours = Math.floor(routeMinutes / 60);
    const minutes = routeMinutes % 60;

    if (hours <= 0) {
      return `${minutes} min`;
    }

    if (minutes === 0) {
      return `${hours} hr${hours === 1 ? "" : "s"}`;
    }

    return `${hours} hr ${minutes} min`;
  }

  return `${trip.driveHoursFromStart} hour${
    trip.driveHoursFromStart === 1 ? "" : "s"
  }`;
}

function normalizeDepartureTime(value?: string) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value.trim())) {
    return undefined;
  }

  return value.trim();
}

function parseTimeValue(value?: string) {
  const normalized = normalizeDepartureTime(value);
  if (!normalized) return undefined;

  const [hourText, minuteText] = normalized.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return undefined;
  }

  return hour * 60 + minute;
}

function formatTimeLabel(totalMinutes: number) {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function timeBucketForMinutes(totalMinutes: number): ItineraryStop["time"] {
  const normalizedMinutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;

  if (normalizedMinutes < 5 * 60) return "Night";
  if (normalizedMinutes < 11 * 60) return "Morning";
  if (normalizedMinutes < 14 * 60) return "Late morning";
  if (normalizedMinutes < 16 * 60 + 30) return "Afternoon";
  if (normalizedMinutes < 18 * 60 + 30) return "Late afternoon";
  if (normalizedMinutes < 21 * 60) return "Evening";
  return "Night";
}

function hasGroundedDepartureTime(
  departureTime?: string,
  tripPrompt?: string
) {
  const normalizedDepartureTime = normalizeDepartureTime(departureTime);
  if (!normalizedDepartureTime) return false;

  const promptText = tripPrompt?.trim();
  if (!promptText) {
    return true;
  }

  return extractPromptDepartureTime(promptText) === normalizedDepartureTime;
}

function formatRemainingWindow(minutes: number) {
  if (minutes <= 0) return "almost no time";

  const hours = minutes / 60;
  if (hours < 1.25) return "about an hour";
  if (hours < 2) return "around an hour and a half";
  if (hours < 3) return "about two hours";
  if (hours < 4) return "around three hours";
  return `about ${Math.round(hours)} hours`;
}

type ArrivalDayTiming = {
  departureLabel: string;
  arrivalLabel: string;
  driveTime: ItineraryStop["time"];
  hotelTime: ItineraryStop["time"];
  activityTime: ItineraryStop["time"];
  dinnerTime: ItineraryStop["time"];
  includeArrivalActivity: boolean;
  includeDinner: boolean;
  remainingMinutesAfterArrival: number;
};

function getDriveDurationMinutes(
  trip: Pick<RankedDestination, "driveHoursFromStart" | "routeSummary">
) {
  if (
    typeof trip.routeSummary?.durationSeconds === "number" &&
    Number.isFinite(trip.routeSummary.durationSeconds) &&
    trip.routeSummary.durationSeconds > 0
  ) {
    return Math.round(trip.routeSummary.durationSeconds / 60);
  }

  return Math.round(trip.driveHoursFromStart * 60);
}

function getArrivalDayTiming(
  trip: RankedDestination,
  input: TripInput
): ArrivalDayTiming | undefined {
  const departureMinutes = parseTimeValue(input.departureTime);
  if (departureMinutes === undefined) return undefined;

  const arrivalMinutes = departureMinutes + getDriveDurationMinutes(trip);
  const remainingMinutesAfterArrival = Math.max(0, 22 * 60 - arrivalMinutes);

  return {
    departureLabel: formatTimeLabel(departureMinutes),
    arrivalLabel: formatTimeLabel(arrivalMinutes),
    driveTime: timeBucketForMinutes(departureMinutes),
    hotelTime: timeBucketForMinutes(arrivalMinutes),
    activityTime: timeBucketForMinutes(arrivalMinutes + 60),
    dinnerTime: timeBucketForMinutes(Math.max(arrivalMinutes + 120, 18 * 60 + 30)),
    includeArrivalActivity:
      remainingMinutesAfterArrival >= 180 && arrivalMinutes <= 17 * 60 + 30,
    includeDinner: remainingMinutesAfterArrival >= 45 && arrivalMinutes <= 21 * 60,
    remainingMinutesAfterArrival,
  };
}

function arrivalDayTitle(options: {
  includeDinner: boolean;
  includeActivity: boolean;
}) {
  if (!options.includeDinner) return "Late arrival and settle-in";
  if (!options.includeActivity) return "Arrival evening";
  return "Arrival and easy first day";
}

function arrivalDaySummary(timing: ArrivalDayTiming) {
  if (!timing.includeDinner) {
    return `Leaving around ${timing.departureLabel} gets you to the hotel near ${timing.arrivalLabel}, so keep day one focused on arrival and settling in.`;
  }

  if (!timing.includeArrivalActivity) {
    return `Leaving around ${timing.departureLabel} gets you to the hotel near ${timing.arrivalLabel}, so day one works best as check-in plus dinner with ${formatRemainingWindow(timing.remainingMinutesAfterArrival)} left after arrival.`;
  }

  return `Leaving around ${timing.departureLabel} still leaves ${formatRemainingWindow(timing.remainingMinutesAfterArrival)} after hotel arrival, so day one can fit one light stop before dinner without rushing.`;
}

function resolveBudgetFitDefaults(
  trip: RankedDestination,
  input: TripInput,
  itineraryDays: ItineraryDayData[]
): {
  budgetBreakdown: BudgetBreakdown;
  budgetSelectionState: TripSelectionState;
  budgetOptimization?: BudgetOptimizationSummary;
} {
  const result = optimizeSelectionForBudget({
    tripLengthDays: input.tripLengthDays,
    travelerCount: input.travelerCount,
    targetTotalBudget: input.budget,
    hotelOptions: trip.hotelOptions ?? [],
    foodSpots: trip.foodSpots ?? [],
    activities: trip.topActivities ?? [],
    itineraryDays,
    tripPrompt: input.tripPrompt,
    fallbackCenter: {
      latitude: trip.latitude,
      longitude: trip.longitude,
    },
    fallbackBreakdown: {
      ...trip.budgetBreakdown,
      gas:
        trip.isStaycation
          ? 0
          : trip.budgetBreakdown?.gas && trip.budgetBreakdown.gas > 0
            ? trip.budgetBreakdown.gas
            : Math.max(40, trip.driveHoursFromStart * 22),
    },
  });

  return {
    budgetBreakdown: result.optimizedBudget,
    budgetSelectionState: result.optimizedSelection,
    budgetOptimization:
      result.summary.status === "no_target" ? undefined : result.summary,
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
  reservedPrimaryActivity?: ActivitySpot;
  primaryActivityUsed: boolean;
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

function activityGroupCost(
  activity: ActivitySpot | undefined,
  input: TripInput
) {
  const base = activity?.costEstimate ?? activity?.estimatedCost ?? 0;
  return base * Math.max(1, input.travelerCount);
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

function isSummitHikeTrip(input: TripInput) {
  return (
    deriveTripIntentFromPrompt(input.tripPrompt).hardConstraints.activityAnchor ===
    "summit_hike"
  );
}

function isSkiTrip(input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);

  return (
    promptIntent.hardConstraints.activityAnchor === "ski_trip" ||
    promptIntent.activityFocus === "skiing"
  );
}

function prefersRecoveryDays(input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  return (
    promptIntent.softPreferences.wantsRecoveryDays ||
    promptIntent.softPreferences.wantsLowEffort
  );
}

function shouldGuaranteeFoodStops(input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  return (
    input.style === "foodie" ||
    input.style === "chill" ||
    input.style === "solo reset" ||
    promptIntent.softPreferences.wantsGoodFood ||
    promptIntent.hardConstraints.requiresVegetarianOptions
  );
}

function shouldGuaranteeActivityStops(input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  return (
    input.style === "adventure" ||
    input.style === "outdoors" ||
    input.style === "must see" ||
    input.style === "hidden gems" ||
    Boolean(input.activityFocus) ||
    Boolean(promptIntent.requestedActivityName) ||
    Boolean(promptIntent.hardConstraints.activityAnchor) ||
    promptIntent.softPreferences.wantsScenery
  );
}

function hasRequestedNamedActivity(input: TripInput) {
  return Boolean(deriveTripIntentFromPrompt(input.tripPrompt).requestedActivityName);
}

function reservedHikeAnchorScore(activity: ActivitySpot | undefined, input: TripInput) {
  return (
    activityAnchorScore(activity) +
    styleActivityScore(activity, input) +
    promptActivityConstraintScore(activity, input)
  );
}

function reservePrimaryActivity(
  activities: ActivitySpot[],
  input: TripInput
): {
  remainingActivities: ActivitySpot[];
  reservedPrimaryActivity?: ActivitySpot;
} {
  if (
    !isSummitHikeTrip(input) &&
    !isSkiTrip(input) &&
    !hasRequestedNamedActivity(input)
  ) {
    return {
      remainingActivities: activities,
    };
  }

  const reservationPool = isSkiTrip(input)
    ? activities.filter(
        (activity) =>
          isSkiActivity(activity) && !isFoodForwardActivity(activity)
      )
    : activities;

  if (isSkiTrip(input) && reservationPool.length === 0) {
    return {
      remainingActivities: activities,
    };
  }

  const reservedPrimaryActivity = [...reservationPool]
    .sort(
      (a, b) =>
        reservedHikeAnchorScore(b, input) - reservedHikeAnchorScore(a, input)
    )[0];

  if (
    !reservedPrimaryActivity ||
    reservedHikeAnchorScore(reservedPrimaryActivity, input) <
      (isSkiTrip(input) ? 14 : 18)
  ) {
    return {
      remainingActivities: activities,
    };
  }

  return {
    remainingActivities: activities.filter(
      (activity) => itemName(activity) !== itemName(reservedPrimaryActivity)
    ),
    reservedPrimaryActivity,
  };
}

function buildContext(trip: RankedDestination, input: TripInput): BuildContext {
  const dedupedActivities = dedupeByName(trip.topActivities);
  const activityReservation = reservePrimaryActivity(dedupedActivities, input);

  return {
    remainingFoods: dedupeByName(trip.foodSpots),
    remainingActivities: activityReservation.remainingActivities,
    previousDayFoodNames: new Set<string>(),
    previousDayActivityNames: new Set<string>(),
    reservedPrimaryActivity: activityReservation.reservedPrimaryActivity,
    primaryActivityUsed: false,
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

function normalizeActivityName(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function activityMatchesRequestedName(
  activityName: string | undefined,
  requestedActivityName?: string
) {
  const normalizedActivity = normalizeActivityName(activityName);
  const normalizedRequestedActivity = normalizeActivityName(
    requestedActivityName
  );

  if (!normalizedActivity || !normalizedRequestedActivity) {
    return false;
  }

  return (
    normalizedActivity === normalizedRequestedActivity ||
    normalizedActivity.includes(normalizedRequestedActivity) ||
    normalizedRequestedActivity.includes(normalizedActivity)
  );
}

function hasVisibleCoffeeIdentity(food?: FoodSpot) {
  const text = normalizeSignalText([food?.name ?? ""]);

  return (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("espresso") ||
    text.includes("bakery")
  );
}

function promptExplicitlyWantsWellness(prompt?: string) {
  const text = normalizeSignalText([prompt ?? ""]);

  return (
    text.includes("spa") ||
    text.includes("wellness") ||
    text.includes("hot spring") ||
    text.includes("hot springs") ||
    text.includes("sauna") ||
    text.includes("bathhouse") ||
    text.includes("thermal") ||
    text.includes("mineral pool") ||
    text.includes("nordic spa")
  );
}

function promptExplicitlyWantsCoffee(prompt?: string) {
  const text = normalizeSignalText([prompt ?? ""]);

  return (
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("espresso") ||
    text.includes("latte") ||
    text.includes("bakery")
  );
}

function isWellnessActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);

  return (
    text.includes("spa") ||
    text.includes("wellness") ||
    text.includes("hot spring") ||
    text.includes("hot springs") ||
    text.includes("sauna") ||
    text.includes("bathhouse") ||
    text.includes("thermal") ||
    text.includes("mineral pool") ||
    text.includes("nordic spa")
  );
}

function isFoodForwardActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);

  return (
    text.includes("food") ||
    text.includes("restaurant") ||
    text.includes("cafe") ||
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("brewery") ||
    text.includes("brewpub") ||
    text.includes("brunch") ||
    text.includes("market") ||
    text.includes("tasting")
  );
}

function isSkiText(value?: string) {
  const text = normalizeSignalText([value ?? ""]);

  return (
    text.includes("ski") ||
    text.includes("skiing") ||
    text.includes("snowboard") ||
    text.includes("snowboarding") ||
    text.includes("chairlift") ||
    text.includes("terrain park") ||
    text.includes("groomer") ||
    text.includes("alpine resort")
  );
}

function isSkiActivity(activity?: ActivitySpot) {
  return isSkiText(normalizedActivitySignals(activity));
}

function isHospitalityLikeActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);

  return (
    text.includes("hotel") ||
    text.includes("resort") ||
    text.includes("lodge") ||
    text.includes("inn") ||
    text.includes("motel") ||
    text.includes("suite") ||
    text.includes("suites") ||
    text.includes("accommodation") ||
    text.includes("hostel")
  );
}

function hospitalityActivityPenalty(
  activity: ActivitySpot | undefined,
  input: TripInput
) {
  if (!isHospitalityLikeActivity(activity)) {
    return 0;
  }

  if (promptExplicitlyWantsWellness(input.tripPrompt) && isWellnessActivity(activity)) {
    return -8;
  }

  return -28;
}

function displayActivityName(activity?: Pick<ActivitySpot, "name"> | string) {
  const name =
    typeof activity === "string"
      ? activity
      : activity?.name;
  const normalizedName = normalizePlaceDisplayName(name);
  if (normalizedName && !isGenericActivityDisplayName(normalizedName)) {
    return normalizedName;
  }
  return normalizedName || name || "Activity";
}

function isDemandingHikeActivity(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  if (!text) return false;

  const summitSignal =
    ["summit", "peak", "ridge", "scramble", "alpine", "mountain"].some((term) =>
      text.includes(term)
    );
  const hikeSignal =
    ["trail", "hike", "trailhead", "backcountry"].some((term) =>
      text.includes(term)
    );

  return summitSignal && hikeSignal;
}

function promptFoodConstraintScore(food: FoodSpot | undefined, input: TripInput) {
  const text = normalizedFoodSignals(food);
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  let score = 0;

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    if (
      [
        "vegetarian",
        "vegan",
        "plant",
        "salad",
        "falafel",
        "mediterranean",
        "indian",
        "thai",
        "mexican",
        "fusion",
      ].some((term) => text.includes(term))
    ) {
      score += 8;
    } else if (
      ["restaurant", "bistro", "kitchen", "dining", "cafe", "bakery"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 2;
    } else {
      score -= 4;
    }

    if (
      promptIntent.hardConstraints.mixedDietGroup &&
      ["restaurant", "bistro", "grill", "kitchen", "fusion", "dining"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 3;
    }
  }

  if (promptIntent.softPreferences.wantsGoodFood) {
    if (
      [
        "restaurant",
        "bistro",
        "kitchen",
        "bakery",
        "brunch",
        "chef",
        "fusion",
        "trattoria",
        "cafe",
      ].some((term) => text.includes(term))
    ) {
      score += 4;
    }
  }

  if (promptExplicitlyWantsCoffee(input.tripPrompt)) {
    score +=
      text.includes("coffee") ||
      text.includes("cafe") ||
      text.includes("espresso") ||
      text.includes("bakery")
        ? 6
        : -2;
  }

  return score;
}

function promptActivityConstraintScore(
  activity: ActivitySpot | undefined,
  input: TripInput
) {
  const text = normalizedActivitySignals(activity);
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const normalizedRequestedActivity = normalizeActivityName(
    promptIntent.requestedActivityName
  );
  const normalizedActivity = normalizeActivityName(activity?.name);
  let score = 0;

  if (normalizedRequestedActivity) {
    if (
      normalizedActivity === normalizedRequestedActivity ||
      normalizedActivity.includes(normalizedRequestedActivity) ||
      normalizedRequestedActivity.includes(normalizedActivity)
    ) {
      score += 48;
    } else {
      score -= 16;
    }
  }

  if (isGenericActivityDisplayName(activity?.name)) {
    score -= 28;
  }

  if (promptIntent.hardConstraints.activityAnchor === "ski_trip") {
    const skiSignal =
      [
        "ski",
        "skiing",
        "ski resort",
        "ski hill",
        "snowboard",
        "snowboarding",
        "terrain",
        "lift",
        "chairlift",
        "gondola",
        "runs",
        "downhill",
        "nordic",
        "village",
      ].filter((term) => text.includes(term)).length;
    const explicitBanffSkiSignal =
      [
        "sunshine village",
        "lake louise ski resort",
        "mt norquay",
        "norquay",
      ].filter((term) => text.includes(term)).length;
    const genericWinterSignal =
      ["winter", "snow", "mountain"].filter((term) => text.includes(term)).length;

    if (skiSignal >= 2) {
      score += 34;
    } else if (skiSignal >= 1) {
      score += 18;
    } else if (genericWinterSignal >= 1) {
      score += 2;
    } else {
      score -= 18;
    }

    if (explicitBanffSkiSignal >= 1) {
      score += 18;
    }

    if (
      text.includes("trail") ||
      text.includes("hike") ||
      text.includes("waterfall") ||
      text.includes("canyon") ||
      text.includes("viewpoint")
    ) {
      score -= 10;
    }
  }

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    const strongSummitSignal =
      ["summit", "peak", "ridge", "scramble", "alpine", "mountain"].filter(
        (term) => text.includes(term)
      ).length;
    const scenicSignal =
      ["view", "lookout", "viewpoint", "scenic", "panorama", "lake"].filter(
        (term) => text.includes(term)
      ).length;
    const hikeSignal =
      ["trail", "hike", "loop", "backcountry", "canyon"].filter((term) =>
        text.includes(term)
      ).length;

    const namedRouteSignal =
      ["table mountain", "ha ling", "tent ridge", "eeor", "ridgewalk", "summit trail"].filter(
        (term) => text.includes(term)
      ).length;

    if (strongSummitSignal >= 1 && hikeSignal >= 1) {
      score += 28;
    } else if (strongSummitSignal >= 1) {
      score += 4;
    } else if (hikeSignal >= 2 && scenicSignal >= 1) {
      score += 9;
    } else if (hikeSignal >= 1) {
      score -= 2;
    } else {
      score -= 12;
    }

    if (namedRouteSignal >= 1) {
      score += 22;
    }

    if (promptIntent.hardConstraints.requiresScenicView) {
      score += scenicSignal >= 1 ? 8 : -6;
    }

    if (promptIntent.hardConstraints.hikeDistanceKmTarget) {
      if (
        strongSummitSignal >= 1 ||
        text.includes("backcountry") ||
        text.includes("loop")
      ) {
        score += 3;
      } else if (text.includes("trailhead")) {
        score -= 8;
      } else if (text.includes("viewpoint")) {
        score -= 7;
      }
    }

    if (text.includes("trailhead") && strongSummitSignal === 0) {
      score -= 8;
    }

    if (text.includes("viewpoint") && strongSummitSignal === 0) {
      score -= 8;
    }

    if (scenicSignal >= 2 && hikeSignal === 0) {
      score -= 18;
    }

    if (text.includes("ridge") && hikeSignal === 0 && !text.includes("scramble")) {
      score -= 10;
    }

    if (
      (text.endsWith("national park") || text.endsWith("provincial park")) &&
      strongSummitSignal === 0 &&
      scenicSignal === 0
    ) {
      score -= 10;
    }
  }

  if (
    input.activityFocus === "hiking" ||
    promptIntent.activityFocus === "hiking" ||
    promptIntent.hardConstraints.activityAnchor === "summit_hike" ||
    ((input.style === "adventure" || input.style === "outdoors") &&
      promptIntent.softPreferences.wantsScenery)
  ) {
    score += scenicHikeSpecificityScore(activity);
  }

  return score;
}

function styleActivityScore(activity: ActivitySpot | undefined, input: TripInput) {
  const text = normalizedActivitySignals(activity);
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
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
      text.includes("ski") ||
      text.includes("snowboard") ||
      text.includes("lift") ||
      text.includes("gondola") ||
      text.includes("lake") ||
      text.includes("canyon") ||
      text.includes("waterfall") ||
      text.includes("park")
    ) {
      score += 6;
    }
  }

  if (input.style === "must see") {
    if (
      text.includes("landmark") ||
      text.includes("iconic") ||
      text.includes("museum") ||
      text.includes("viewpoint") ||
      text.includes("lookout") ||
      text.includes("gondola") ||
      text.includes("waterfall") ||
      text.includes("hot spring") ||
      text.includes("historic") ||
      text.includes("canyon")
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

  if (promptIntent.activityFocus === "skiing") {
    if (
      text.includes("ski") ||
      text.includes("snowboard") ||
      text.includes("lift") ||
      text.includes("chairlift") ||
      text.includes("gondola") ||
      text.includes("resort")
    ) {
      score += 16;
    } else if (
      text.includes("trail") ||
      text.includes("hike") ||
      text.includes("waterfall") ||
      text.includes("canyon")
    ) {
      score -= 8;
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

  if (input.style === "must see") {
    if (
      text.includes("iconic") ||
      text.includes("historic") ||
      text.includes("landmark") ||
      text.includes("museum") ||
      text.includes("popular")
    ) {
      score += 2;
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
  score += coffeeStopSpecificityScore(food);

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
  score += coffeeStopSpecificityScore(food);

  return score;
}

function activityAnchorScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;
  const summitSignal =
    ["summit", "peak", "ridge", "scramble", "alpine", "mountain"].filter((term) =>
      text.includes(term)
    ).length;
  const hikeSignal =
    ["trail", "hike", "loop", "backcountry", "scramble"].filter((term) =>
      text.includes(term)
    ).length;
  const scenicSignal =
    ["view", "viewpoint", "lookout", "scenic", "panorama"].filter((term) =>
      text.includes(term)
    ).length;

  if (isGenericActivityDisplayName(activity?.name)) {
    score -= 30;
  }

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

  if (text.includes("trailhead")) score -= 3;
  if (text.includes("viewpoint")) score -= 2;
  if (summitSignal >= 1 && hikeSignal >= 1) score += 32;
  if (text.includes("table mountain")) score += 26;
  if (scenicSignal >= 2 && hikeSignal === 0) score -= 18;
  if (text.includes("ridge") && hikeSignal === 0 && !text.includes("scramble")) score -= 12;

  if (text.includes("red chair") || text.includes("totem pole")) {
    score -= 2;
  }

  if (isAdminLikeActivity(activity)) {
    score -= 12;
  }

  if (
    text.includes("ski") ||
    text.includes("skiing") ||
    text.includes("snowboard") ||
    text.includes("snowboarding") ||
    text.includes("lift") ||
    text.includes("chairlift") ||
    text.includes("resort")
  ) {
    score += 22;
  }

  return score;
}

function activitySecondaryScore(activity?: ActivitySpot) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (isGenericActivityDisplayName(activity?.name)) {
    score -= 14;
  }

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

  if (isGenericActivityDisplayName(activity?.name)) {
    score -= 14;
  }

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

function relaxActivityScore(activity: ActivitySpot | undefined, input: TripInput) {
  const text = normalizedActivitySignals(activity);
  let score = 0;

  if (
    text.includes("viewpoint") ||
    text.includes("lookout") ||
    text.includes("lake") ||
    text.includes("river") ||
    text.includes("boardwalk") ||
    text.includes("museum") ||
    text.includes("historic") ||
    text.includes("garden") ||
    text.includes("spa") ||
    text.includes("hot spring") ||
    text.includes("gallery") ||
    text.includes("gondola")
  ) {
    score += 8;
  }

  if (text.includes("walk")) score += 4;
  if (text.includes("trail")) score -= 6;
  if (text.includes("trailhead")) score -= 16;
  if (text.includes("summit") || text.includes("peak") || text.includes("ridge")) {
    score -= 18;
  }
  if (text.includes("scramble") || text.includes("backcountry")) {
    score -= 18;
  }
  if (text.includes("mountain")) score -= 6;

  if (prefersRecoveryDays(input)) {
    score += 2;
  }

  if (
    deriveTripIntentFromPrompt(input.tripPrompt).hardConstraints.requiresScenicView &&
    ["view", "lookout", "viewpoint", "scenic", "lake", "river"].some((term) =>
      text.includes(term)
    )
  ) {
    score += 4;
  }

  score += hospitalityActivityPenalty(activity, input);

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
    nearEnoughCandidates.length > 0
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

function claimReservedPrimaryActivity(ctx: BuildContext) {
  if (!ctx.reservedPrimaryActivity) return undefined;

  const reservedPrimaryActivity = ctx.reservedPrimaryActivity;
  ctx.reservedPrimaryActivity = undefined;
  ctx.primaryActivityUsed = true;
  return reservedPrimaryActivity;
}

function peekReservedPrimaryActivity(ctx: BuildContext) {
  return ctx.reservedPrimaryActivity;
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
    (food) =>
      foodScoreForMorning(food) +
      styleFoodScore(food, input) +
      promptFoodConstraintScore(food, input),
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
    (food) =>
      foodScoreForDinner(food) +
      styleFoodScore(food, input) +
      promptFoodConstraintScore(food, input),
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
    (food) =>
      foodScoreForArrivalDinner(food) +
      styleFoodScore(food, input) +
      promptFoodConstraintScore(food, input),
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
    (food) =>
      foodScoreForFinalLightStop(food) +
      styleFoodScore(food, input) +
      promptFoodConstraintScore(food, input),
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
    (food) =>
      styleFoodScore(food, input) +
      promptFoodConstraintScore(food, input) +
      normalizedFoodSignals(food).length * 0.001,
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
    (activity) =>
      activityAnchorScore(activity) +
      styleActivityScore(activity, input) +
      promptActivityConstraintScore(activity, input) +
      hospitalityActivityPenalty(activity, input),
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
      activitySecondaryScore(activity) +
      styleActivityScore(activity, input) +
      promptActivityConstraintScore(activity, input) +
      hospitalityActivityPenalty(activity, input),
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
      activityFinalLightScore(activity) +
      styleActivityScore(activity, input) +
      promptActivityConstraintScore(activity, input) +
      hospitalityActivityPenalty(activity, input),
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
      promptActivityConstraintScore(activity, input) +
      hospitalityActivityPenalty(activity, input) +
      activitySecondaryScore(activity) +
      normalizedActivitySignals(activity).length * 0.001,
    0,
    proximity
  );
}

function pickRelaxActivity(
  ctx: BuildContext,
  input: TripInput,
  blockedNames: Set<string> = new Set<string>(),
  proximity?: ProximityOptions
) {
  return popBestItem(
    ctx.remainingActivities,
    ctx.previousDayActivityNames,
    blockedNames,
    (activity) => relaxActivityScore(activity, input),
    5,
    proximity
  );
}

function compactStops<T>(items: Array<T | undefined | false | null>): T[] {
  return items.filter(Boolean) as T[];
}

function middleDayTitle(
  input: TripInput,
  dayNumber: number,
  totalDays: number,
  isStaycation: boolean
) {
  if (!isStaycation && isSummitHikeTrip(input) && dayNumber === 2) {
    return "Signature summit day";
  }

  if (!isStaycation && isSkiTrip(input)) {
    return dayNumber === 2 ? "Full ski day" : `Ski day ${dayNumber}`;
  }

  if (!isStaycation && prefersRecoveryDays(input) && dayNumber > 2) {
    return `Recovery and food day ${dayNumber}`;
  }

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
  if (!isStaycation && isSummitHikeTrip(input) && dayNumber === 2) {
    return "Use the first full day for the one signature summit hike, then keep the rest of the trip easier.";
  }

  if (!isStaycation && isSkiTrip(input)) {
    return totalDays <= 3
      ? "Use the middle of the trip for a full ski day instead of burning the best snow window on logistics."
      : `Keep day ${dayNumber} focused on lift time while the trip is still at full energy.`;
  }

  if (!isStaycation && prefersRecoveryDays(input) && dayNumber > 2) {
    return "Keep this day lighter with shared meals and, at most, one low-effort stop before the trip ends.";
  }

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
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    if (phase === "end") {
      return promptIntent.hardConstraints.mixedDietGroup
        ? `Use ${venueName} as a vegetarian-friendly dinner stop that still works for the group.`
        : `Finish with a vegetarian-friendly stop at ${venueName}.`;
    }

    return promptIntent.hardConstraints.mixedDietGroup
      ? `Start with ${venueName} so the group has a vegetarian-friendly option that still feels shared.`
      : `Start with a vegetarian-friendly stop at ${venueName}.`;
  }

  if (input.style === "foodie") {
    if (phase === "start") return `Start with a strong local food stop at ${venueName}.`;
    if (phase === "end") return `Use ${venueName} as the dinner anchor so the day still feels food-forward.`;
    return `Use ${venueName} for one more local bite, bakery stop, or coffee run before you head out.`;
  }

  if (input.style === "hidden gems") {
    return `Use ${venueName} as a lower-key local heritage stop that still feels specific to the area.`;
  }

  if (input.style === "must see") {
    return phase === "end"
      ? `Finish with ${venueName} after the main sightseeing anchors.`
      : `Start at ${venueName} before the bigger must-see stops.`;
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
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const displayName = normalizePlaceDisplayName(activityName) || activityName;
  const skiLikeActivity = isSkiText(displayName);

  if (
    promptIntent.hardConstraints.activityAnchor === "ski_trip" ||
    promptIntent.activityFocus === "skiing"
  ) {
    if (!skiLikeActivity) {
      if (phase === "secondary") {
        return `Add ${displayName} only if it still keeps the day easy to manage.`;
      }

      if (phase === "light") {
        return `Use ${displayName} as one shorter side stop before you head out.`;
      }

      return `Use ${displayName} as the support stop around the main winter-sports block.`;
    }

    if (phase === "secondary") {
      return `Add ${displayName} only if it still keeps the day centered on skiing.`;
    }

    if (phase === "light") {
      return `Use ${displayName} as a shorter ski-focused stop before the drive home.`;
    }

    return `Use ${displayName} as the main ski-day anchor for the trip.`;
  }

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    if (phase === "secondary") {
      return `Add ${displayName} only if it still supports the hiking brief without replacing the main summit-style anchor.`;
    }

    if (phase === "light") {
      return `Use ${displayName} only as a lighter scenic stop so the non-hike days stay easier.`;
    }

    return `Use ${displayName} as the signature summit-style hike for the trip.`;
  }

  if (input.style === "hidden gems") {
    if (phase === "secondary") {
      return `Add ${displayName} for more local or heritage texture without overpacking the day.`;
    }
    return `Use ${displayName} as a scenic or local anchor that keeps the trip feeling distinctive.`;
  }

  if (input.style === "must see") {
    return phase === "secondary"
      ? `Add ${displayName} because it is one of the classic sights worth fitting in while you are here.`
      : `Use ${displayName} as one of the signature must-see stops for the trip.`;
  }

  if (input.style === "foodie") {
    return phase === "secondary"
      ? `Add ${displayName} if it still fits around the main food stops.`
      : `Use ${displayName} as a lighter anchor between the main meal stops.`;
  }

  return phase === "secondary"
    ? `Add ${displayName} if you still have energy.`
    : `Use ${displayName} as the main daytime anchor.`;
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
        : input.style === "must see"
          ? `Use this block for one more classic sight or landmark around ${trip.name}.`
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

  const nearby = safeItems
    .map((item) => ({
      item,
      distanceKm: distanceFromReference(reference, item),
    }))
    .filter(
      ({ distanceKm }) =>
        distanceKm !== undefined && distanceKm <= maxDistanceKm
    )
    .sort(
      (left, right) =>
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY)
    )
    .map(({ item }) => item);

  if (nearby.length >= minimumNearbyCount || nearby.length > 0) {
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
  let breakfast =
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
    (shouldGuaranteeFoodStops(input)
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
        title: displayActivityName(activity),
        description: styleActivityDescription(
          input,
          displayActivityName(activity),
          "anchor"
        ),
        allTrailsUrl: activity.allTrailsUrl,
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activityGroupCost(activity, input),
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
  let breakfast =
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
        : input.style === "must see"
          ? "Use day two for the strongest classic sights while you are already based in town."
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
        title: displayActivityName(activity),
        description: styleActivityDescription(
          input,
          displayActivityName(activity),
          "light"
        ),
        allTrailsUrl: activity.allTrailsUrl,
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activityGroupCost(activity, input),
        kind: "activity" as const,
      },
      shouldGuaranteeFoodStops(input) &&
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
            input.style === "must see"
              ? `Classic sights day in ${trip.name}`
              :
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
  const summitTrip = isSummitHikeTrip(input);
  const recoveryDays = prefersRecoveryDays(input);
  const hotel = trip.hotelOptions?.[0];
  const baseCoordinate = toCoordinate(hotel) ?? buildBaseCoordinate(trip);
  const arrivalTiming = getArrivalDayTiming(trip, input);
  const pacing = getTripPacing(trip);
  const dinner =
    arrivalTiming?.includeDinner === false
      ? undefined
      : pickArrivalDinnerFood(
          ctx,
          input,
          new Set<string>(),
          buildFoodProximity(input, baseCoordinate, baseCoordinate)
        ) ??
        (shouldGuaranteeFoodStops(input)
          ? pickFlexibleFood(
              ctx,
              input,
              new Set<string>(),
              buildFoodProximity(input, baseCoordinate, baseCoordinate)
            )
          : undefined);
  const arrivalActivity =
    arrivalTiming?.includeArrivalActivity === false
      ? undefined
      : summitTrip && input.tripLengthDays >= 3
        ? undefined
        : recoveryDays
          ? pickRelaxActivity(
              ctx,
              input,
              new Set<string>(),
              buildActivityProximity(input, baseCoordinate, baseCoordinate)
            )
          : pacing === "easy" ||
              (pacing === "balanced" &&
                (input.style === "adventure" || input.style === "outdoors"))
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

  const title = arrivalTiming
    ? arrivalDayTitle({
        includeDinner: Boolean(dinner),
        includeActivity: Boolean(arrivalActivity),
      })
    : "Arrival and easy first day";
  const summary = arrivalTiming
    ? arrivalDaySummary({
        ...arrivalTiming,
        includeDinner: Boolean(dinner),
        includeArrivalActivity: Boolean(arrivalActivity),
      })
    : summitTrip && input.tripLengthDays >= 3
      ? "Arrive, settle in, and save the signature hike for the first full day."
      : input.style === "must see"
        ? "Arrive, settle in, and save the biggest classic sights for the first full day instead of rushing them on arrival."
      : input.style === "hidden gems"
        ? "Arrive, settle in, and keep the first day focused on a distinctive local feel instead of rushing the trip."
        : pacing === "fatiguing"
          ? "Use day one to arrive, settle in, and avoid burning the trip on an overstuffed first evening."
          : pacing === "balanced"
            ? "Get there, settle in, and keep the first day useful without forcing too much into it."
            : "Because the drive is short, day one can include one real stop without making the trip feel rushed.";

  return {
    title,
    summary,
    stops: compactStops([
      {
        time: arrivalTiming?.driveTime ?? "Morning",
        title: `Drive from ${input.startCity} to ${trip.name}`,
        description: arrivalTiming
          ? `Leave around ${arrivalTiming.departureLabel}. Estimated hotel arrival: ${arrivalTiming.arrivalLabel} after ${makeDriveText(trip)} on the road.`
          : `Estimated drive: ${makeDriveText(trip)}.`,
        kind: "travel" as const,
      },
      hotel && {
        time: arrivalTiming?.hotelTime ?? "Afternoon",
        title: `Check in at ${hotel.name}`,
        description: arrivalTiming
          ? `Arrive around ${arrivalTiming.arrivalLabel}, use ${hotel.name} as your base, and keep the rest of the day aligned with the time you have left.`
          : `Use ${hotel.name} as your base, then start light.`,
        websiteUrl: hotel.bookingLink ?? hotel.websiteUrl,
        kind: "stay" as const,
      },
      arrivalActivity && {
        time: arrivalTiming?.activityTime ?? "Late afternoon",
        title: displayActivityName(arrivalActivity),
        description:
          recoveryDays || summitTrip
            ? `Add ${displayActivityName(arrivalActivity)} only as a light arrival-day stop before dinner.`
            : `Add ${displayActivityName(arrivalActivity)} as a short arrival-day stop before dinner.`,
        allTrailsUrl: arrivalActivity.allTrailsUrl,
        websiteUrl: arrivalActivity.bookingLink ?? arrivalActivity.websiteUrl,
        estimatedCost: activityGroupCost(arrivalActivity, input),
        kind: "activity" as const,
      },
      dinner && {
        time: arrivalTiming?.dinnerTime ?? "Evening",
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
  const summitTrip = isSummitHikeTrip(input);
  const skiTrip = isSkiTrip(input);
  const hasRequestedAnchor = hasRequestedNamedActivity(input);
  const recoveryDays = prefersRecoveryDays(input);
  const isTwoDaySummitCompromise = summitTrip && input.tripLengthDays <= 2;
  const baseCoordinate =
    toCoordinate(trip.hotelOptions?.[0]) ?? buildBaseCoordinate(trip);
  let breakfast =
    pickLightFinalFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    (shouldGuaranteeFoodStops(input)
       ? pickFlexibleFood(
           ctx,
           input,
           new Set<string>(),
           buildFoodProximity(input, baseCoordinate, baseCoordinate)
         )
       : undefined);
  if (
    promptExplicitlyWantsCoffee(input.tripPrompt) &&
    breakfast &&
    (coffeeStopSpecificityScore(breakfast) < 45 ||
      !hasVisibleCoffeeIdentity(breakfast))
  ) {
    breakfast = undefined;
  }
  const breakfastCoordinate = toCoordinate(breakfast);
  const useFinalDayAsPrimaryAnchor =
      (summitTrip || skiTrip || hasRequestedAnchor) && !ctx.primaryActivityUsed;
  const finalActivityCandidate =
    useFinalDayAsPrimaryAnchor
      ? claimReservedPrimaryActivity(ctx) ??
        pickAnchorActivity(
          ctx,
          input,
          new Set<string>(),
          buildActivityProximity(
            input,
            breakfastCoordinate ?? baseCoordinate,
            baseCoordinate
          )
        )
      : recoveryDays
        ? pickRelaxActivity(
            ctx,
            input,
            new Set<string>(),
            buildActivityProximity(
              input,
              breakfastCoordinate ?? baseCoordinate,
              baseCoordinate
            )
          )
        : pickFinalLightActivity(
            ctx,
            input,
            new Set<string>(),
            buildActivityProximity(
              input,
              breakfastCoordinate ?? baseCoordinate,
              baseCoordinate
            )
          ) ??
          ((input.style === "adventure" ||
            input.style === "outdoors" ||
            input.style === "must see" ||
            input.style === "hidden gems")
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
  const finalActivity =
    skiTrip &&
    useFinalDayAsPrimaryAnchor &&
    finalActivityCandidate &&
    !isSkiActivity(finalActivityCandidate)
      ? undefined
      : finalActivityCandidate;
  const guaranteedFinalActivityFallback =
    !finalActivity &&
    !skiTrip &&
    shouldGuaranteeActivityStops(input) &&
    input.tripLengthDays >= 3
      ? makeFlexibleActivityStop(
          input,
          trip,
          "Late morning",
          `One more scenic stop before leaving ${trip.name}`
        )
      : undefined;

    if ((summitTrip || skiTrip || hasRequestedAnchor) && finalActivity) {
      ctx.primaryActivityUsed = true;
    }

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [finalActivity]);

    return {
      title: isTwoDaySummitCompromise
        ? "Main hike day and drive back"
        : skiTrip && useFinalDayAsPrimaryAnchor
          ? "Main ski day and drive back"
          : "Final half-day and drive back",
      summary:
        isTwoDaySummitCompromise
          ? `Use the morning for the main hike, then drive back to ${input.startCity} the same day so the trip still lands as a mountain weekend.`
          : skiTrip && useFinalDayAsPrimaryAnchor
          ? `Use the main daylight window for the ski day, then drive back to ${input.startCity} so the trip still lands as a clean overnight without feeling overpacked.`
          : recoveryDays && !useFinalDayAsPrimaryAnchor
          ? `Keep the final day lighter with a slower meal and, at most, one scenic stop before the return to ${input.startCity}.`
          : input.style === "must see"
        ? `Keep the final day lighter and use it for one last classic sight before returning to ${input.startCity}.`
          : input.style === "hidden gems"
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
        title: displayActivityName(finalActivity),
        description: styleActivityDescription(
          input,
          displayActivityName(finalActivity),
          useFinalDayAsPrimaryAnchor ? "anchor" : "light"
        ),
        allTrailsUrl: finalActivity.allTrailsUrl,
        websiteUrl: finalActivity.bookingLink ?? finalActivity.websiteUrl,
        estimatedCost: activityGroupCost(finalActivity, input),
        kind: "activity" as const,
      },
      guaranteedFinalActivityFallback,
      skiTrip &&
        !finalActivity && {
          time: "Late morning",
          title: `Final ski morning in ${trip.name}`,
          description: `Keep the final daylight window centered on skiing before you drive back to ${input.startCity}.`,
          kind: "activity" as const,
        },
      shouldGuaranteeFoodStops(input) &&
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
        description: undefined,
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
  const summitTrip = isSummitHikeTrip(input);
  const skiTrip = isSkiTrip(input);
  const recoveryDays = prefersRecoveryDays(input);
  const baseCoordinate =
    toCoordinate(trip.hotelOptions?.[0]) ?? buildBaseCoordinate(trip);
  const breakfast =
    pickMorningFood(
      ctx,
      input,
      new Set<string>(),
      buildFoodProximity(input, baseCoordinate, baseCoordinate)
    ) ??
    (shouldGuaranteeFoodStops(input)
      ? pickFlexibleFood(
          ctx,
          input,
          new Set<string>(),
          buildFoodProximity(input, baseCoordinate, baseCoordinate)
        )
      : undefined);
  const breakfastCoordinate = toCoordinate(breakfast);
  const repeatedSkiActivity = skiTrip ? peekReservedPrimaryActivity(ctx) : undefined;
  const mainActivityCandidate =
    summitTrip && ctx.reservedPrimaryActivity
      ? claimReservedPrimaryActivity(ctx)
      : repeatedSkiActivity
        ? repeatedSkiActivity
      : recoveryDays && summitTrip && ctx.primaryActivityUsed
        ? pickRelaxActivity(
            ctx,
            input,
            new Set<string>(),
            buildActivityProximity(
              input,
              breakfastCoordinate ?? baseCoordinate,
              baseCoordinate
            )
          )
        : pickAnchorActivity(
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
  const mainActivity =
    skiTrip &&
    mainActivityCandidate &&
    !isSkiActivity(mainActivityCandidate)
      ? undefined
      : mainActivityCandidate;

  if (summitTrip && mainActivity) {
    ctx.primaryActivityUsed = true;
  }

  const mainActivityCoordinate = toCoordinate(mainActivity);

  const buildLightDay =
    skiTrip ||
    (dayNumber % 2 === 0 && totalDays >= 5) ||
    (summitTrip && recoveryDays);
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
      ((input.style === "adventure" ||
        input.style === "outdoors" ||
        input.style === "must see" ||
        input.style === "hidden gems")
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
  const guaranteedActivityFallback =
    !mainActivity &&
    !secondaryActivity &&
    shouldGuaranteeActivityStops(input)
      ? makeFlexibleActivityStop(
          input,
          trip,
          "Late morning",
          `Pick a nearby scenic anchor in ${trip.name}`
        )
      : undefined;

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
    (shouldGuaranteeFoodStops(input)
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
    title: middleDayTitle(input, dayNumber, totalDays, trip.isStaycation),
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
        time:
          summitTrip && isDemandingHikeActivity(mainActivity)
            ? "Late morning to afternoon"
            : "Late morning",
        title: displayActivityName(mainActivity),
        description: styleActivityDescription(
          input,
          displayActivityName(mainActivity),
          recoveryDays && summitTrip && dayNumber > 2 ? "light" : "anchor"
        ),
        allTrailsUrl: mainActivity.allTrailsUrl,
        websiteUrl: mainActivity.bookingLink ?? mainActivity.websiteUrl,
        estimatedCost: activityGroupCost(mainActivity, input),
        kind: "activity" as const,
      },
      skiTrip &&
        !mainActivity && {
          time: "Late morning",
          title: `Ski day in ${trip.name}`,
          description: `Use the main daylight window for a ski block before you settle back into the rest of the trip.`,
          kind: "activity" as const,
        },
      secondaryActivity && {
        time: "Afternoon",
        title: displayActivityName(secondaryActivity),
        description: styleActivityDescription(
          input,
          displayActivityName(secondaryActivity),
          "secondary"
        ),
        allTrailsUrl: secondaryActivity.allTrailsUrl,
        websiteUrl:
          secondaryActivity.bookingLink ?? secondaryActivity.websiteUrl,
        estimatedCost: activityGroupCost(secondaryActivity, input),
        kind: "activity" as const,
      },
      guaranteedActivityFallback,
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
          input.style === "must see"
            ? `${middleDayTitle(input, dayNumber, totalDays, trip.isStaycation)} classic sights fallback`
            :
          input.style === "hidden gems"
            ? `${middleDayTitle(input, dayNumber, totalDays, trip.isStaycation)} scenic local fallback`
            : `${middleDayTitle(input, dayNumber, totalDays, trip.isStaycation)} fallback`
        ),
      shouldGuaranteeFoodStops(input) &&
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

function normalizeStopMatchText(value?: string) {
  return (value ?? "")
    .replace(/^check in at\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stopTextTokens(value?: string) {
  return normalizeStopMatchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4);
}

function tokenOverlapCount(left?: string, right?: string) {
  const leftTokens = new Set(stopTextTokens(left));
  const rightTokens = stopTextTokens(right);

  return rightTokens.reduce(
    (count, token) => count + Number(leftTokens.has(token)),
    0
  );
}

function matchStopTitle<T extends { name?: string }>(items: T[] | undefined, title?: string) {
  const normalizedTitle = normalizeStopMatchText(title);
  if (!normalizedTitle) return undefined;

  return dedupeByName(items)
    .map((item) => {
      const normalizedName = normalizeStopMatchText(item.name);
      let score = 0;

      if (normalizedName === normalizedTitle) score += 100;
      else if (
        normalizedName.includes(normalizedTitle) ||
        normalizedTitle.includes(normalizedName)
      ) {
        score += 70;
      }

      score += tokenOverlapCount(normalizedTitle, normalizedName) * 6;

      return {
        item,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.item;
}

function isStopTooFar(options: {
  item?: CoordinateItem;
  base?: StopCoordinate;
  previous?: StopCoordinate;
  maxDistanceKm: number;
}) {
  const baseDistanceKm = distanceFromReference(options.base, options.item);
  const previousDistanceKm = distanceFromReference(
    options.previous ?? options.base,
    options.item
  );

  if (
    typeof baseDistanceKm === "number" &&
    baseDistanceKm > options.maxDistanceKm
  ) {
    return true;
  }

  if (
    typeof previousDistanceKm === "number" &&
    previousDistanceKm > options.maxDistanceKm * 1.35
  ) {
    return true;
  }

  return false;
}

function guardrailFoodScore(
  food: FoodSpot,
  stop: ItineraryStop,
  input: TripInput
) {
  const time = normalizeStopMatchText(stop.time);
  const stopText = [stop.title, stop.description, stop.time].join(" ");
  let score =
    time.includes("morning")
      ? foodScoreForMorning(food)
      : time.includes("evening") || time.includes("night")
        ? foodScoreForDinner(food)
        : foodScoreForFinalLightStop(food);

  score += styleFoodScore(food, input);
  score += promptFoodConstraintScore(food, input);
  score += tokenOverlapCount(stopText, [food.name, ...(food.tags ?? []), food.category].join(" ")) * 4;
  score += (food.rating ?? 0) * 2;

  return score;
}

function guardrailActivityScore(
  activity: ActivitySpot,
  stop: ItineraryStop,
  input: TripInput
) {
  const time = normalizeStopMatchText(stop.time);
  const stopText = [stop.title, stop.description, stop.time].join(" ");
  let score =
    time.includes("late morning to afternoon") || time.includes("late morning")
      ? activityAnchorScore(activity)
      : time.includes("afternoon")
        ? activitySecondaryScore(activity)
        : activityFinalLightScore(activity);

  score += styleActivityScore(activity, input);
  score += promptActivityConstraintScore(activity, input);
  score += hospitalityActivityPenalty(activity, input);
  score += tokenOverlapCount(
    stopText,
    [activity.name, activity.type, activity.shortDescription].join(" ")
  ) * 4;
  score += (activity.rating ?? 0) * 2;

  return score;
}

function nearestGuardrailFood(options: {
  trip: RankedDestination;
  input: TripInput;
  stop: ItineraryStop;
  base?: StopCoordinate;
  previous?: StopCoordinate;
}) {
  const proximity = buildFoodProximity(
    options.input,
    options.previous ?? options.base,
    options.base
  );

  return dedupeByName(options.trip.foodSpots)
    .filter(
      (food) =>
        !isStopTooFar({
          item: food,
          base: options.base,
          previous: options.previous,
          maxDistanceKm: proximity.maxDistanceKm ?? maxLegDistanceKm(options.input),
        })
    )
    .map((food) => ({
      food,
      distanceKm:
        distanceFromReference(options.previous ?? options.base, food) ??
        distanceFromReference(options.base, food),
      score:
        guardrailFoodScore(food, options.stop, options.input) +
        proximityScore(
          distanceFromReference(options.previous ?? options.base, food) ??
            distanceFromReference(options.base, food),
          {
            maxDistanceKm: proximity.maxDistanceKm,
            distancePenaltyStartKm: proximity.distancePenaltyStartKm,
            distanceWeight: proximity.distanceWeight,
          }
        ),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity);
    })[0]?.food;
}

function nearestGuardrailActivity(options: {
  trip: RankedDestination;
  input: TripInput;
  stop: ItineraryStop;
  base?: StopCoordinate;
  previous?: StopCoordinate;
}) {
  const proximity = buildActivityProximity(
    options.input,
    options.previous ?? options.base,
    options.base
  );

  return dedupeByName(options.trip.topActivities)
    .filter(
      (activity) =>
        !isStopTooFar({
          item: activity,
          base: options.base,
          previous: options.previous,
          maxDistanceKm:
            proximity.maxDistanceKm ?? maxLegDistanceKm(options.input) * 1.4,
        })
    )
    .map((activity) => ({
      activity,
      distanceKm:
        distanceFromReference(options.previous ?? options.base, activity) ??
        distanceFromReference(options.base, activity),
      score:
        guardrailActivityScore(activity, options.stop, options.input) +
        proximityScore(
          distanceFromReference(options.previous ?? options.base, activity) ??
            distanceFromReference(options.base, activity),
          {
            maxDistanceKm: proximity.maxDistanceKm,
            distancePenaltyStartKm: proximity.distancePenaltyStartKm,
            distanceWeight: proximity.distanceWeight,
          }
        ),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity);
    })[0]?.activity;
}

function sanitizeFoodStop(options: {
  stop: ItineraryStop;
  trip: RankedDestination;
  input: TripInput;
  base?: StopCoordinate;
  previous?: StopCoordinate;
}) {
  const resolvedFood =
    matchStopTitle(options.trip.foodSpots, options.stop.title) ??
    nearestGuardrailFood(options);

  if (!resolvedFood) {
    return makeFlexibleFoodStop(
      options.input,
      options.trip,
      options.stop.time ?? "Flexible",
      `Pick a local food stop in ${options.trip.name}`
    );
  }

  if (
    isStopTooFar({
      item: resolvedFood,
      base: options.base,
      previous: options.previous,
      maxDistanceKm: maxLegDistanceKm(options.input),
    })
  ) {
    return makeFlexibleFoodStop(
      options.input,
      options.trip,
      options.stop.time ?? "Flexible",
      `Keep this meal close to ${options.trip.name}`
    );
  }

  return {
    ...options.stop,
    title: resolvedFood.name,
    description: styleFoodDescription(
      options.input,
      resolvedFood.name,
      normalizeStopMatchText(options.stop.time).includes("evening") ||
      normalizeStopMatchText(options.stop.time).includes("night")
        ? "end"
        : normalizeStopMatchText(options.stop.time).includes("morning")
          ? "start"
          : "light"
    ),
    websiteUrl: resolvedFood.link,
  };
}

function sanitizeActivityStop(options: {
  stop: ItineraryStop;
  trip: RankedDestination;
  input: TripInput;
  base?: StopCoordinate;
  previous?: StopCoordinate;
}) {
  const stopSignals = normalizeSignalText([
    options.stop.title,
    options.stop.description,
    options.stop.time,
  ]);
  const matchedActivity = matchStopTitle(
    options.trip.topActivities,
    options.stop.title
  );
  const keepSyntheticAnchor =
    (stopSignals.includes("ski day") ||
      stopSignals.includes("ski morning") ||
      stopSignals.includes("main ski") ||
      stopSignals.includes("ski focused stop") ||
      stopSignals.includes("centered on skiing") ||
      stopSignals.includes("daylight window for a ski block") ||
      stopSignals.includes("daylight window for the ski day")) &&
    (!matchedActivity || !isSkiActivity(matchedActivity));

  if (keepSyntheticAnchor) {
    return options.stop;
  }

  const resolvedActivity =
    matchedActivity &&
    !isGenericActivityDisplayName(matchedActivity.name)
      ? matchedActivity
      : nearestGuardrailActivity(options);

  if (!resolvedActivity) {
    return makeFlexibleActivityStop(
      options.input,
      options.trip,
      options.stop.time ?? "Flexible",
      `Pick a nearby activity in ${options.trip.name}`
    );
  }

  if (
    isStopTooFar({
      item: resolvedActivity,
      base: options.base,
      previous: options.previous,
      maxDistanceKm: maxLegDistanceKm(options.input) * 1.4,
    })
  ) {
    return makeFlexibleActivityStop(
      options.input,
      options.trip,
      options.stop.time ?? "Flexible",
      `Keep this activity close to ${options.trip.name}`
    );
  }

  const phase =
    normalizeStopMatchText(options.stop.time).includes("afternoon") &&
    !normalizeStopMatchText(options.stop.time).includes("late morning")
      ? "secondary"
      : normalizeStopMatchText(options.stop.time).includes("evening") ||
        normalizeStopMatchText(options.stop.time).includes("night")
        ? "light"
        : "anchor";

  return {
    ...options.stop,
    title: displayActivityName(resolvedActivity),
    description: styleActivityDescription(
      options.input,
      displayActivityName(resolvedActivity),
      phase
    ),
    allTrailsUrl: resolvedActivity.allTrailsUrl,
    websiteUrl: resolvedActivity.bookingLink ?? resolvedActivity.websiteUrl,
    estimatedCost: activityGroupCost(resolvedActivity, options.input),
  };
}

function sanitizeItineraryDays(
  trip: RankedDestination,
  input: TripInput,
  itineraryDays: ItineraryDayData[]
) {
  const defaultHotel = trip.hotelOptions?.[0];
  const fallbackBase = toCoordinate(defaultHotel) ?? buildBaseCoordinate(trip);

  return itineraryDays.map((day) => {
    let dayBase = fallbackBase;
    let previousResolved = fallbackBase;

    const sanitizedStops = day.stops.map((stop) => {
      if (stop.kind === "travel") {
        return stop;
      }

      if (stop.kind === "stay") {
        if (!defaultHotel) return stop;

        dayBase = toCoordinate(defaultHotel) ?? dayBase;
        previousResolved = dayBase;

        return {
          ...stop,
          title: `Check in at ${defaultHotel.name}`,
          description:
            stop.description ??
            `Use ${defaultHotel.name} as your base for this part of the trip.`,
          websiteUrl: defaultHotel.bookingLink ?? defaultHotel.websiteUrl,
        };
      }

      if (stop.kind === "food") {
        const sanitizedStop = sanitizeFoodStop({
          stop,
          trip,
          input,
          base: dayBase,
          previous: previousResolved,
        });

        previousResolved =
          toCoordinate(matchStopTitle(trip.foodSpots, sanitizedStop.title)) ??
          previousResolved;
        return sanitizedStop;
      }

      if (stop.kind === "activity") {
        const sanitizedStop = sanitizeActivityStop({
          stop,
          trip,
          input,
          base: dayBase,
          previous: previousResolved,
        });

        previousResolved =
          toCoordinate(matchStopTitle(trip.topActivities, sanitizedStop.title)) ??
          previousResolved;
        return sanitizedStop;
      }

      return stop;
    });

    return {
      ...day,
      stops: compactStops(sanitizedStops),
    };
  });
}

function buildItineraryDays(
  trip: RankedDestination,
  input: TripInput
): ItineraryDayData[] {
  const ctx = buildContext(trip, input);

  if (trip.isStaycation) {
    if (input.tripLengthDays <= 1) {
      return sanitizeItineraryDays(trip, input, [
        buildStaycationDayOne(trip, input, ctx),
      ]);
    }

    if (input.tripLengthDays === 2) {
      return sanitizeItineraryDays(trip, input, [
        buildStaycationDayOne(trip, input, ctx),
        buildStaycationFinalDay(trip, input, ctx),
      ]);
    }

    const days: ItineraryDayData[] = [buildStaycationDayOne(trip, input, ctx)];
    for (let day = 2; day < input.tripLengthDays; day += 1) {
      days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
    }
    days.push(buildStaycationFinalDay(trip, input, ctx));
    return sanitizeItineraryDays(trip, input, days);
  }

  if (input.tripLengthDays <= 1) {
    return sanitizeItineraryDays(trip, input, [
      buildGetawayDayOne(trip, input, ctx),
    ]);
  }

  if (input.tripLengthDays === 2) {
    return sanitizeItineraryDays(trip, input, [
      buildGetawayDayOne(trip, input, ctx),
      buildGetawayFinalDay(trip, input, ctx),
    ]);
  }

  const days: ItineraryDayData[] = [buildGetawayDayOne(trip, input, ctx)];
  for (let day = 2; day < input.tripLengthDays; day += 1) {
    days.push(buildMiddleDay(trip, input, day, input.tripLengthDays, ctx));
  }
  days.push(buildGetawayFinalDay(trip, input, ctx));
  return sanitizeItineraryDays(trip, input, days);
}

export function buildTripPlanPreview(
  trip: RankedDestination,
  input?: Partial<TripInput>
): TripPlanPreview {
  const safeInput = normalizeInput(input);
  const baseCoordinate = buildBaseCoordinate(trip);
  const foodDistanceCapKm = maxLegDistanceKm(safeInput);
  const activityDistanceCapKm = foodDistanceCapKm * 1.4;
  const candidateHotels = sortHotelOptions(
    withDistanceCap(
      trip.hotelOptions ?? [],
      toCoordinate(trip) ?? baseCoordinate,
      activityDistanceCapKm,
      2
    ),
    {
      nights: Math.max(1, safeInput.tripLengthDays - 1),
      fallbackTotalStayCost: trip.budgetBreakdown?.hotel,
    }
  );
  const candidateActivities = withDistanceCap(
    trip.topActivities ?? [],
    toCoordinate(candidateHotels[0]) ?? baseCoordinate,
    activityDistanceCapKm,
    4
  );
  const initialRecommendation = refineTripStayRecommendation({
    trip,
    input: safeInput,
    hotelOptions: candidateHotels,
    activities: candidateActivities,
  });
  const stayAnchorCoordinate =
    toCoordinate(initialRecommendation.hotelOptions[0]) ?? baseCoordinate;
  const filteredFoodSpots = withDistanceCap(
    trip.foodSpots ?? [],
    stayAnchorCoordinate,
    foodDistanceCapKm,
    3
  );
  const filteredActivities = withDistanceCap(
    initialRecommendation.activities,
    stayAnchorCoordinate,
    activityDistanceCapKm,
    3
  );
  const requestedActivityName =
    deriveTripIntentFromPrompt(safeInput.tripPrompt).requestedActivityName;
  const requestedActivity =
    requestedActivityName
      ? initialRecommendation.activities.find((activity) =>
          activityMatchesRequestedName(activity.name, requestedActivityName)
        )
      : undefined;
  const preservedActivities =
    requestedActivity &&
    !filteredActivities.some((activity) =>
      activityMatchesRequestedName(activity.name, requestedActivityName)
    )
      ? dedupeByName([requestedActivity, ...filteredActivities])
      : filteredActivities;
  const finalRecommendation = refineTripStayRecommendation({
    trip,
    input: safeInput,
    hotelOptions: initialRecommendation.hotelOptions,
    activities: preservedActivities,
  });
  const filteredTrip: RankedDestination = {
    ...trip,
    hotelOptions: finalRecommendation.hotelOptions,
    foodSpots: filteredFoodSpots,
    topActivities: finalRecommendation.activities,
  };
  const itineraryDays = buildItineraryDays(filteredTrip, safeInput);
  const budgetFit = resolveBudgetFitDefaults(
    filteredTrip,
    safeInput,
    itineraryDays
  );
  const recommendedTitle = getRecommendedTripTitle(
    {
      title: finalRecommendation.recommendedStayName,
      name: trip.name,
      destinationName: trip.name,
      destination: trip.name,
      homeBaseCity: trip.homeBaseCity,
      province: trip.province,
      hotelOptions: filteredTrip.hotelOptions,
      topActivities: filteredTrip.topActivities,
    },
    safeInput
  );

  const driveHoursFromStart = trip.isStaycation ? 0 : trip.driveHoursFromStart;
  const driveTimeText = trip.isStaycation ? "0 hours" : makeDriveText(trip);

  return {
    safeInput,
    filteredTrip,
    budgetBreakdown: budgetFit.budgetBreakdown,
    budgetOptimization: budgetFit.budgetOptimization,
    budgetSelectionState: budgetFit.budgetSelectionState,
    itineraryDays,
    recommendedTitle,
    driveHoursFromStart,
    driveTimeText,
  };
}

export function buildTripPlan(
  trip: RankedDestination,
  input?: Partial<TripInput>,
  dataSource: TripDataSource = "static-fallback"
): TripPlan {
  const preview = buildTripPlanPreview(trip, input);

  return ensureTripEditToken({
    id: crypto.randomUUID(),

    destinationName: trip.name,
    startCity: preview.safeInput.startCity,
    region: trip.province,
    summary: trip.summary,
    imageUrl: trip.imageUrl,
    imageUrlLight: trip.imageUrlLight,
    imageUrlDark: trip.imageUrlDark,

    driveTimeText: preview.driveTimeText,
    score: trip.score,
    styleMatchStrength: trip.styleMatchStrength,
    confidence: trip.confidence,
    liveDataSummary: trip.liveDataSummary,
    rankingReasons: trip.rankingReasons ?? [],
    tags: trip.rawVibes ?? [],

    budgetBreakdown: preview.budgetBreakdown,
    hotelOptions: preview.filteredTrip.hotelOptions,
    foodSpots: preview.filteredTrip.foodSpots,
    topActivities: preview.filteredTrip.topActivities,
    itineraryDays: preview.itineraryDays,

    aiSummary: trip.aiSummary ?? "",
    aiBudgetNote: trip.aiBudgetNote ?? "",
    aiBestFit: trip.aiBestFit ?? "",

    routeSummary: trip.routeSummary,
    dataSource,
    createdAt: new Date().toISOString(),
    sourceCheckedAt: trip.sourceCheckedAt,
    providerStatus: trip.providerStatus,
    travelerCount: preview.safeInput.travelerCount,
    budgetPerTraveler: preview.safeInput.budgetPerTraveler,
    totalBudget: preview.safeInput.budget,
    tripLengthDays: preview.safeInput.tripLengthDays,
    tripStartDate: preview.safeInput.tripStartDate,
    tripEndDate: preview.safeInput.tripEndDate,
    departureTime: preview.safeInput.departureTime,
    tripPrompt: preview.safeInput.tripPrompt,
    maxDriveMinutesBetweenStops: preview.safeInput.maxDriveMinutesBetweenStops,
    savedSelectionState: preview.budgetSelectionState,
    budgetOptimization: preview.budgetOptimization,
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
    title: preview.recommendedTitle,
    destination: trip.name,
    province: trip.province,
    driveHoursFromStart: preview.driveHoursFromStart,
    rawVibes: trip.rawVibes ?? [],
    source: dataSource,
    isStaycation: trip.isStaycation,
    homeBaseCity: trip.homeBaseCity,
    latitude: trip.latitude,
    longitude: trip.longitude,
  } as TripPlan);
}

export function syncTripPlanTiming(plan: TripPlan): TripPlan {
  if (
    !hasGroundedDepartureTime(plan.departureTime, plan.tripPrompt) ||
    !Array.isArray(plan.itineraryDays) ||
    plan.itineraryDays.length === 0 ||
    typeof plan.routeSummary?.durationSeconds !== "number" ||
    !Number.isFinite(plan.routeSummary.durationSeconds) ||
    plan.routeSummary.durationSeconds <= 0
  ) {
    return plan;
  }

  const departureMinutes = parseTimeValue(plan.departureTime);
  if (departureMinutes === undefined) return plan;

  const arrivalMinutes =
    departureMinutes + Math.round(plan.routeSummary.durationSeconds / 60);
  const remainingMinutesAfterArrival = Math.max(0, 22 * 60 - arrivalMinutes);
  const includeActivity =
    remainingMinutesAfterArrival >= 180 && arrivalMinutes <= 17 * 60 + 30;
  const includeDinner =
    remainingMinutesAfterArrival >= 45 && arrivalMinutes <= 21 * 60;
  const timing: ArrivalDayTiming = {
    departureLabel: formatTimeLabel(departureMinutes),
    arrivalLabel: formatTimeLabel(arrivalMinutes),
    driveTime: timeBucketForMinutes(departureMinutes),
    hotelTime: timeBucketForMinutes(arrivalMinutes),
    activityTime: timeBucketForMinutes(arrivalMinutes + 60),
    dinnerTime: timeBucketForMinutes(Math.max(arrivalMinutes + 120, 18 * 60 + 30)),
    includeArrivalActivity: includeActivity,
    includeDinner,
    remainingMinutesAfterArrival,
  };

  const [firstDay, ...restDays] = plan.itineraryDays;
  const updatedFirstDayStops = firstDay.stops
    .filter((stop) => {
      if (stop.kind === "activity" && !includeActivity) return false;
      if (stop.kind === "food" && !includeDinner) return false;
      return true;
    })
    .map((stop) => {
      if (stop.kind === "travel") {
        return {
          ...stop,
          time: timing.driveTime,
          description: `Leave around ${timing.departureLabel}. Estimated hotel arrival: ${timing.arrivalLabel} after ${makeDriveText(plan as unknown as RankedDestination)} on the road.`,
        };
      }

      if (stop.kind === "stay") {
        const stayName = stop.title.replace(/^Check in at\s+/i, "").trim();

        return {
          ...stop,
          time: timing.hotelTime,
          description: `Arrive around ${timing.arrivalLabel}, use ${stayName || "your stay"} as your base, and keep the rest of the day aligned with the time you have left.`,
        };
      }

      if (stop.kind === "activity") {
        return {
          ...stop,
          time: timing.activityTime,
        };
      }

      if (stop.kind === "food") {
        return {
          ...stop,
          time: timing.dinnerTime,
        };
      }

      return stop;
    });

  return {
    ...plan,
    driveTimeText: plan.isStaycation ? "0 hours" : makeDriveText(plan as unknown as RankedDestination),
    itineraryDays: [
      {
        ...firstDay,
        title: arrivalDayTitle({
          includeDinner,
          includeActivity,
        }),
        summary: arrivalDaySummary(timing),
        stops: updatedFirstDayStops,
      },
      ...restDays,
    ],
  };
}
