import {
  BudgetBreakdown,
  ItineraryDayData,
  ItineraryStop,
  RankedDestination,
  TripDataSource,
  TripInput,
  TripPlan,
} from "./types";
import { sortHotelOptions } from "./hotelAvailability";
import { deriveTripEndDate, getTodayIsoDate } from "./tripDates";
import { ensureTripEditToken } from "./tripSecurity";
import {
  buildDefaultSelectionState,
  calculateSelectedBudget,
} from "./tripSelections";
import {
  getRecommendedTripTitle,
  isGenericActivityDisplayName,
  normalizePlaceDisplayName,
  refineTripStayRecommendation,
} from "./tripSpecificity";
import { deriveTripIntentFromPrompt, extractPromptDepartureTime } from "./tripIntent";

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
    extractPromptDepartureTime(tripPrompt) ??
    (tripStartDate === getTodayIsoDate() ? getCurrentTimeValue() : undefined);

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

function getCurrentTimeValue(referenceDate = new Date()) {
  return `${String(referenceDate.getHours()).padStart(2, "0")}:${String(
    referenceDate.getMinutes()
  ).padStart(2, "0")}`;
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

  if (normalizedMinutes < 11 * 60) return "Morning";
  if (normalizedMinutes < 14 * 60) return "Late morning";
  if (normalizedMinutes < 16 * 60 + 30) return "Afternoon";
  if (normalizedMinutes < 18 * 60 + 30) return "Late afternoon";
  if (normalizedMinutes < 21 * 60) return "Evening";
  return "Night";
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

function buildBudgetBreakdown(
  trip: RankedDestination,
  input: TripInput,
  itineraryDays: ItineraryDayData[]
): BudgetBreakdown {
  const defaultSelection = buildDefaultSelectionState(
    itineraryDays,
    trip.hotelOptions ?? [],
    trip.foodSpots ?? [],
    trip.topActivities ?? []
  );

  return calculateSelectedBudget({
    tripLengthDays: input.tripLengthDays,
    travelerCount: input.travelerCount,
    hotelOptions: trip.hotelOptions ?? [],
    foodSpots: trip.foodSpots ?? [],
    activities: trip.topActivities ?? [],
    itineraryDays,
    selection: defaultSelection,
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

function prefersRecoveryDays(input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  return (
    promptIntent.softPreferences.wantsRecoveryDays ||
    promptIntent.softPreferences.wantsLowEffort
  );
}

function reservedHikeAnchorScore(activity: ActivitySpot | undefined, input: TripInput) {
  return (
    activityAnchorScore(activity) +
    styleActivityScore(activity, input) +
    promptActivityConstraintScore(activity, input)
  );
}

function reservePrimaryHikeAnchor(
  activities: ActivitySpot[],
  input: TripInput
): {
  remainingActivities: ActivitySpot[];
  reservedPrimaryActivity?: ActivitySpot;
} {
  if (!isSummitHikeTrip(input)) {
    return {
      remainingActivities: activities,
    };
  }

  const reservedPrimaryActivity = [...activities]
    .sort(
      (a, b) =>
        reservedHikeAnchorScore(b, input) - reservedHikeAnchorScore(a, input)
    )[0];

  if (
    !reservedPrimaryActivity ||
    reservedHikeAnchorScore(reservedPrimaryActivity, input) < 18
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
  const activityReservation = reservePrimaryHikeAnchor(dedupedActivities, input);

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

  return score;
}

function promptActivityConstraintScore(
  activity: ActivitySpot | undefined,
  input: TripInput
) {
  const text = normalizedActivitySignals(activity);
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  let score = 0;

  if (isGenericActivityDisplayName(activity?.name)) {
    score -= 28;
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

  return score;
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

function claimReservedPrimaryActivity(ctx: BuildContext) {
  if (!ctx.reservedPrimaryActivity) return undefined;

  const reservedPrimaryActivity = ctx.reservedPrimaryActivity;
  ctx.reservedPrimaryActivity = undefined;
  ctx.primaryActivityUsed = true;
  return reservedPrimaryActivity;
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
        title: displayActivityName(activity),
        description: styleActivityDescription(
          input,
          displayActivityName(activity),
          "anchor"
        ),
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
        title: displayActivityName(activity),
        description: styleActivityDescription(
          input,
          displayActivityName(activity),
          "light"
        ),
        websiteUrl: activity.bookingLink ?? activity.websiteUrl,
        estimatedCost: activityGroupCost(activity, input),
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
        (input.style === "foodie"
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
  const recoveryDays = prefersRecoveryDays(input);
  const isTwoDaySummitCompromise = summitTrip && input.tripLengthDays <= 2;
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
  const useFinalDayAsPrimaryAnchor = summitTrip && !ctx.primaryActivityUsed;
  const finalActivity =
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

  if (summitTrip && finalActivity) {
    ctx.primaryActivityUsed = true;
  }

  setPreviousDayFoods(ctx, [breakfast]);
  setPreviousDayActivities(ctx, [finalActivity]);

  return {
    title: isTwoDaySummitCompromise
      ? "Main hike day and drive back"
      : "Final half-day and drive back",
    summary:
      isTwoDaySummitCompromise
        ? `Use the morning for the main hike, then drive back to ${input.startCity} the same day so the trip still lands as a mountain weekend.`
        : recoveryDays && !useFinalDayAsPrimaryAnchor
        ? `Keep the final day lighter with a slower meal and, at most, one scenic stop before the return to ${input.startCity}.`
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
        websiteUrl: finalActivity.bookingLink ?? finalActivity.websiteUrl,
        estimatedCost: activityGroupCost(finalActivity, input),
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
  const summitTrip = isSummitHikeTrip(input);
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
    summitTrip && ctx.reservedPrimaryActivity
      ? claimReservedPrimaryActivity(ctx)
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

  if (summitTrip && mainActivity) {
    ctx.primaryActivityUsed = true;
  }

  const mainActivityCoordinate = toCoordinate(mainActivity);

  const buildLightDay =
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
        websiteUrl: mainActivity.bookingLink ?? mainActivity.websiteUrl,
        estimatedCost: activityGroupCost(mainActivity, input),
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
        websiteUrl:
          secondaryActivity.bookingLink ?? secondaryActivity.websiteUrl,
        estimatedCost: activityGroupCost(secondaryActivity, input),
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
            ? `${middleDayTitle(input, dayNumber, totalDays, trip.isStaycation)} scenic local fallback`
            : `${middleDayTitle(input, dayNumber, totalDays, trip.isStaycation)} fallback`
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
  const ctx = buildContext(trip, input);

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
    )
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
  const finalRecommendation = refineTripStayRecommendation({
    trip,
    input: safeInput,
    hotelOptions: initialRecommendation.hotelOptions,
    activities: filteredActivities,
  });
  const filteredTrip: RankedDestination = {
    ...trip,
    hotelOptions: finalRecommendation.hotelOptions,
    foodSpots: filteredFoodSpots,
    topActivities: finalRecommendation.activities,
  };
  const itineraryDays = buildItineraryDays(filteredTrip, safeInput);
  const budgetBreakdown = buildBudgetBreakdown(
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
    budgetBreakdown,
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
  const defaultSelection = buildDefaultSelectionState(
    preview.itineraryDays,
    preview.filteredTrip.hotelOptions,
    preview.filteredTrip.foodSpots,
    preview.filteredTrip.topActivities
  );
  const selectedBudget = calculateSelectedBudget({
    tripLengthDays: preview.safeInput.tripLengthDays,
    travelerCount: preview.safeInput.travelerCount,
    hotelOptions: preview.filteredTrip.hotelOptions,
    foodSpots: preview.filteredTrip.foodSpots,
    activities: preview.filteredTrip.topActivities,
    itineraryDays: preview.itineraryDays,
    selection: defaultSelection,
    fallbackBreakdown: preview.budgetBreakdown,
  });

  return ensureTripEditToken({
    id: crypto.randomUUID(),

    destinationName: trip.name,
    startCity: preview.safeInput.startCity,
    region: trip.province,
    summary: trip.summary,
    imageUrl: trip.imageUrl,

    driveTimeText: preview.driveTimeText,
    score: trip.score,
    styleMatchStrength: trip.styleMatchStrength,
    confidence: trip.confidence,
    liveDataSummary: trip.liveDataSummary,
    rankingReasons: trip.rankingReasons ?? [],
    tags: trip.rawVibes ?? [],

    budgetBreakdown: selectedBudget,
    hotelOptions: preview.filteredTrip.hotelOptions,
    foodSpots: preview.filteredTrip.foodSpots,
    topActivities: preview.filteredTrip.topActivities,
    itineraryDays: preview.itineraryDays,

    aiSummary: trip.aiSummary ?? "",
    aiBudgetNote: trip.aiBudgetNote ?? "",
    aiBestFit: trip.aiBestFit ?? "",

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
    savedSelectionState: defaultSelection,
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
  } as TripPlan);
}

export function syncTripPlanTiming(plan: TripPlan): TripPlan {
  if (
    !plan.departureTime ||
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
