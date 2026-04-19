/**
 * Helper module for trip specificity concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripInput,
  TripSelectionState,
} from "./types";
import { deriveTripIntentFromPrompt } from "./tripIntent";

type RecommendationTripLike = {
  title?: string;
  name?: string;
  destination?: string;
  destinationName?: string;
  homeBaseCity?: string;
  province?: string;
  latitude?: number;
  longitude?: number;
  hotelOptions?: HotelOption[];
  topActivities?: Activity[];
  foodSpots?: FoodSpot[];
  savedSelectionState?: TripSelectionState;
};

type PromptFitTripLike = Pick<RecommendationTripLike, "topActivities"> & {
  budgetBreakdown?: {
    total?: number;
    totalExpected?: number;
  };
  estimatedCost?: number;
  itineraryDays?: Pick<ItineraryDayData, "stops">[];
};

type PromptSummaryTripLike = Pick<
  RecommendationTripLike,
  | "destination"
  | "destinationName"
  | "homeBaseCity"
  | "name"
  | "foodSpots"
  | "topActivities"
  | "savedSelectionState"
> & {
  itineraryDays?: Pick<ItineraryDayData, "title" | "summary" | "stops">[];
  summary?: string;
  tripPrompt?: string;
  tripLengthDays?: number;
};

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isSkiLikeText(value?: string) {
  const text = normalized(value);
  if (!text) return false;

  return [
    "ski",
    "skiing",
    "snowboard",
    "chairlift",
    "gondola",
    "lift",
    "resort",
    "alpine",
  ].some((term) => text.includes(term));
}

function extractNamedAnchorFromDescription(description?: string) {
  const text = description?.trim();
  if (!text) return undefined;

  const match = text.match(
    /\b(?:use|start at|head to|ski at|ride at|base the day at)\s+([^.,]+?)\s+as\b/i
  );
  const candidate = normalizePlaceDisplayName(match?.[1]);

  if (!candidate || isGenericActivityDisplayName(candidate)) {
    return undefined;
  }

  return candidate;
}

function isGeneratedSkiPlaceholder(value?: string, baseName?: string) {
  const normalizedValue = normalized(normalizePlaceDisplayName(value));
  const normalizedBaseName = normalized(baseName);
  if (!normalizedValue) return true;

  return (
    normalizedValue === "ski day" ||
    normalizedValue.startsWith("ski day in ") ||
    (normalizedBaseName
      ? normalizedValue === normalized(`${baseName} ski day`)
      : false)
  );
}

const GENERIC_ACTIVITY_NAMES = new Set([
  "lookout",
  "lookout point",
  "viewpoint",
  "scenic viewpoint",
  "view point",
  "observation point",
  "hiking area",
  "trail",
  "mountain view",
  "scenic view",
  "viewing area",
]);

export function normalizePlaceDisplayName(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(/\s*trailhead$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\-]\s*$/g, "")
    .trim();
}

export function isGenericActivityDisplayName(value?: string) {
  const name = normalized(normalizePlaceDisplayName(value));
  if (!name) return true;
  if (GENERIC_ACTIVITY_NAMES.has(name)) return true;

  if (/^(lookout|viewpoint|observation point)\b/.test(name)) {
    return name.split(" ").length <= 3;
  }

  return false;
}

function signalText(parts: Array<string | undefined>) {
  return normalized(parts.filter(Boolean).join(" "));
}

function foodSignalText(
  food?: Pick<FoodSpot, "name" | "tags" | "category" | "shortDescription"> | null
) {
  return signalText([
    food?.name,
    ...(food?.tags ?? []),
    food?.category,
    food?.shortDescription,
  ]);
}

function promptExplicitlyWantsCoffee(prompt?: string) {
  const text = normalized(prompt);
  if (!text) return false;

  return /\b(coffee|cafe|espresso|latte|americano|bakery)\b/.test(text);
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function recommendationBaseCoordinate(trip: RecommendationTripLike) {
  if (
    typeof trip.hotelOptions?.[0]?.latitude === "number" &&
    typeof trip.hotelOptions?.[0]?.longitude === "number"
  ) {
    return {
      latitude: trip.hotelOptions[0].latitude,
      longitude: trip.hotelOptions[0].longitude,
    };
  }

  if (typeof trip.latitude === "number" && typeof trip.longitude === "number") {
    return {
      latitude: trip.latitude,
      longitude: trip.longitude,
    };
  }

  return undefined;
}

export function isCampingFocused(
  input?: Partial<Pick<TripInput, "activityFocus" | "tripPrompt">> | null
) {
  if (input?.activityFocus === "camping") {
    return true;
  }

  const prompt = normalized(input?.tripPrompt);
  return (
    prompt.includes("camp") ||
    prompt.includes("tent") ||
    prompt.includes("campsite")
  );
}

function isSummitHikeFocused(
  input?: Partial<Pick<TripInput, "activityFocus" | "tripPrompt">> | null
) {
  if (input?.activityFocus !== "hiking" && !input?.tripPrompt) {
    return false;
  }

  return (
    deriveTripIntentFromPrompt(input?.tripPrompt).hardConstraints.activityAnchor ===
    "summit_hike"
  );
}

export function isCampingStayLikeText(value?: string) {
  const text = normalized(value);

  return (
    text.includes("campground") ||
    text.includes("campsite") ||
    text.includes("camping") ||
    text.includes("rv park") ||
    text.includes("basecamp") ||
    text.includes("backcountry camp")
  );
}

export function isCampingStayLikeHotel(
  hotel?: Pick<HotelOption, "name" | "shortDescription"> | null
) {
  if (!hotel) return false;
  return isCampingStayLikeText(signalText([hotel.name, hotel.shortDescription]));
}

export function isCampingStayLikeActivity(
  activity?: Pick<Activity, "name" | "type" | "shortDescription"> | null
) {
  if (!activity) return false;
  return isCampingStayLikeText(
    signalText([activity.name, activity.type, activity.shortDescription])
  );
}

export function isBroadDestinationActivity(
  activity: Pick<Activity, "name"> | undefined,
  trip: RecommendationTripLike
) {
  const activityName = normalized(activity?.name);
  if (!activityName) return false;

  const destinationLabels = new Set(
    [
      trip.destinationName,
      trip.destination,
      trip.name,
      trip.homeBaseCity,
      trip.title,
    ]
      .map(normalized)
      .filter(Boolean)
  );

  for (const label of destinationLabels) {
    if (
      activityName === label ||
      activityName === `${label} national park` ||
      activityName === `${label} provincial park` ||
      activityName === `${label} visitor center` ||
      activityName === `${label} visitor centre`
    ) {
      return true;
    }
  }

  return false;
}

export function scenicHikeSpecificityScore(
  activity?: Pick<Activity, "name" | "type" | "shortDescription" | "rating"> | null
) {
  if (!activity) return Number.NEGATIVE_INFINITY;

  const text = signalText([activity.name, activity.type, activity.shortDescription]);
  let score = 0;
  const summitSignal = ["summit", "peak", "ridge", "scramble", "alpine", "mountain"].filter(
    (term) => text.includes(term)
  ).length;
  const hikeSignal = ["trail", "hike", "loop", "backcountry", "scramble"].filter((term) =>
    text.includes(term)
  ).length;
  const scenicSignal = [
    "scenic",
    "view",
    "viewpoint",
    "lookout",
    "panorama",
    "lake",
    "waterfall",
    "canyon",
  ].filter((term) => text.includes(term)).length;

  if (isGenericActivityDisplayName(activity.name)) score -= 120;
  if (text.includes("summit")) score += 90;
  if (text.includes("peak")) score += 84;
  if (text.includes("ridge")) score += 72;
  if (text.includes("scramble")) score += 62;
  if (text.includes("alpine")) score += 54;
  if (text.includes("trail")) score += 38;
  if (text.includes("hike")) score += 34;
  if (text.includes("loop")) score += 24;
  if (text.includes("waterfall")) score += 18;
  if (text.includes("canyon")) score += 18;
  if (text.includes("lake")) score += 12;
  if (text.includes("viewpoint")) score -= 24;
  if (text.includes("trailhead")) score -= 16;
  if (text.includes("dog beach")) score -= 120;
  if (text.includes("beach") && hikeSignal === 0) score -= 80;
  if (text.includes("park") && hikeSignal === 0) score -= 48;
  if (text.endsWith("national park") || text.endsWith("provincial park")) score -= 42;
  if (summitSignal >= 1 && hikeSignal >= 1) score += 42;
  if (hikeSignal >= 1 && scenicSignal >= 1) score += 28;
  if (scenicSignal >= 2 && hikeSignal === 0) score -= 36;
  if (typeof activity.rating === "number") score += activity.rating * 4;

  return score;
}

export function bestScenicHikeCandidate(
  trip: Pick<RecommendationTripLike, "topActivities">
) {
  return [...(trip.topActivities ?? [])].sort(
    (a, b) => scenicHikeSpecificityScore(b) - scenicHikeSpecificityScore(a)
  )[0];
}

export function hasStrongScenicHikeCandidate(
  trip: Pick<RecommendationTripLike, "topActivities">
) {
  return scenicHikeSpecificityScore(bestScenicHikeCandidate(trip)) >= 70;
}

export function coffeeStopSpecificityScore(
  food?: Pick<FoodSpot, "name" | "tags" | "category" | "shortDescription" | "rating"> | null
) {
  if (!food) return Number.NEGATIVE_INFINITY;

  const text = foodSignalText(food);
  let score = 0;

  if (
    text.includes("general store") ||
    text.includes("convenience") ||
    text.includes("convenience store") ||
    text.includes("grocery") ||
    text.includes("supermarket") ||
    text.includes("gas station") ||
    text.includes("liquor store")
  ) {
    score -= 90;
  }

  if (text.includes("grab go") || text.includes("grab & go")) score -= 30;
  if (text.includes("coffee")) score += 48;
  if (text.includes("cafe")) score += 42;
  if (text.includes("espresso") || text.includes("roastery")) score += 36;
  if (text.includes("bakery")) score += 24;
  if (text.includes("brunch")) score += 12;
  if (text.includes("restaurant") && !text.includes("coffee") && !text.includes("cafe")) {
    score -= 16;
  }
  if (typeof food.rating === "number") score += food.rating * 4;

  return score;
}

export function bestCoffeeCandidate(
  trip: Pick<RecommendationTripLike, "foodSpots">
) {
  return [...(trip.foodSpots ?? [])].sort(
    (a, b) => coffeeStopSpecificityScore(b) - coffeeStopSpecificityScore(a)
  )[0];
}

export function hasStrongCoffeeCandidate(
  trip: Pick<RecommendationTripLike, "foodSpots">
) {
  return coffeeStopSpecificityScore(bestCoffeeCandidate(trip)) >= 45;
}

function hikeSpecificityScore(activity: Activity) {
  return scenicHikeSpecificityScore(activity);
}

function campingStayScore(
  activity: Activity,
  trip: RecommendationTripLike
) {
  const text = signalText([activity.name, activity.type, activity.shortDescription]);
  let score = 0;

  if (text.includes("campground")) score += 80;
  if (text.includes("campsite")) score += 74;
  if (text.includes("camping")) score += 68;
  if (text.includes("rv park")) score += 52;
  if (text.includes("basecamp")) score += 40;
  if (text.includes("backcountry")) score -= 24;
  if (text.includes("hike")) score -= 18;
  if (text.includes("trail")) score -= 12;
  if (typeof activity.rating === "number") score += activity.rating * 5;
  if (activity.websiteUrl || activity.bookingLink || activity.mapsUrl) score += 8;

  const baseCoordinate = recommendationBaseCoordinate(trip);
  if (
    baseCoordinate &&
    typeof activity.latitude === "number" &&
    typeof activity.longitude === "number"
  ) {
    score -= haversineDistanceKm(baseCoordinate, {
      latitude: activity.latitude,
      longitude: activity.longitude,
    });
  }

  return score;
}

function selectedTripTotal(trip: PromptFitTripLike) {
  return (
    trip.budgetBreakdown?.totalExpected ??
    trip.budgetBreakdown?.total ??
    trip.estimatedCost
  );
}

function formatMoney(value: number) {
  return `$${Math.round(value)}`;
}

function bestNamedSummitAnchor(trip: Pick<RecommendationTripLike, "topActivities">) {
  return [...(trip.topActivities ?? [])]
    .filter((activity) => !isGenericActivityDisplayName(activity.name))
    .sort((a, b) => hikeSpecificityScore(b) - hikeSpecificityScore(a))[0];
}

function hasLighterRecoveryDays(
  trip: PromptFitTripLike,
  anchorName?: string
) {
  if (!trip.itineraryDays?.length) return false;

  const normalizedAnchor = normalized(anchorName);
  const recoveryDays = trip.itineraryDays.filter((day) => {
    const activityTitles = day.stops
      .filter((stop) => stop.kind === "activity")
      .map((stop) => normalized(stop.title));

    if (activityTitles.length === 0) {
      return true;
    }

    return activityTitles.every((title) => title && title !== normalizedAnchor);
  });

  return recoveryDays.length >= 1;
}

function countSkiFocusedDays(
  trip: PromptSummaryTripLike,
  anchorName?: string
) {
  if (!trip.itineraryDays?.length) return 0;

  const normalizedAnchor = normalized(anchorName);

  return trip.itineraryDays.filter((day) => {
    if (isSkiLikeText([day.title, day.summary].filter(Boolean).join(" "))) {
      return true;
    }

    return day.stops.some((stop) => {
      const stopText = normalized(
        [stop.title, stop.description, stop.kind === "activity" ? stop.time : ""]
          .filter(Boolean)
          .join(" ")
      );

      if (isSkiLikeText(stopText)) {
        return true;
      }

      return Boolean(normalizedAnchor) && stopText.includes(normalizedAnchor);
    });
  }).length;
}

function findSkiAnchorName(trip: PromptSummaryTripLike, baseName: string) {
  const itineraryAnchor = trip.itineraryDays
    ?.flatMap((day) => day.stops)
    .find((stop) => {
      if (stop.kind !== "activity") return false;

      return isSkiLikeText([stop.title, stop.description].filter(Boolean).join(" "));
    });

  const itineraryAnchorName = normalizePlaceDisplayName(itineraryAnchor?.title);
  if (
    itineraryAnchorName &&
    !isGenericActivityDisplayName(itineraryAnchorName) &&
    !isGeneratedSkiPlaceholder(itineraryAnchorName, baseName)
  ) {
    return itineraryAnchorName;
  }

  const describedAnchorName = extractNamedAnchorFromDescription(
    itineraryAnchor?.description
  );
  if (describedAnchorName) {
    return describedAnchorName;
  }

  const selectedSkiAnchor = Object.values(
    trip.savedSelectionState?.activities ?? {}
  ).find((activityName) => {
    const normalizedActivityName = normalizePlaceDisplayName(activityName);
    return (
      isSkiLikeText(normalizedActivityName) &&
      !isGeneratedSkiPlaceholder(normalizedActivityName, baseName)
    );
  });
  if (selectedSkiAnchor?.trim()) {
    return normalizePlaceDisplayName(selectedSkiAnchor);
  }

  const skiAnchor = (trip.topActivities ?? []).find((activity) => {
    const activityText = normalized(
      [activity.name, activity.type, activity.shortDescription ?? ""].join(" ")
    );

    return (
      activityText.includes("ski") ||
      activityText.includes("snowboard") ||
      activityText.includes("lift") ||
      activityText.includes("chairlift") ||
      activityText.includes("resort")
    );
  });

  return normalizePlaceDisplayName(skiAnchor?.name ?? `${baseName} ski day`);
}

export function getPromptConstraintFitSummary(
  trip: PromptFitTripLike,
  input?: Partial<TripInput> | null
) {
  if (!input?.tripPrompt) return undefined;

  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const parts: string[] = [];
  const totalBudget =
    typeof input.budget === "number" && input.budget > 0
      ? input.budget
      : typeof input.budgetPerTraveler === "number" &&
          input.budgetPerTraveler > 0 &&
          typeof input.travelerCount === "number" &&
          input.travelerCount > 0
        ? input.budgetPerTraveler * input.travelerCount
        : undefined;
  const tripTotal = selectedTripTotal(trip);

  let summitAnchorName: string | undefined;

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    const hikeAnchor = bestNamedSummitAnchor(trip);
    const isTwoDayCompromise =
      typeof input?.tripLengthDays === "number" && input.tripLengthDays <= 2;

    if (hikeAnchor?.name?.trim() && hikeSpecificityScore(hikeAnchor) >= 40) {
      summitAnchorName = normalizePlaceDisplayName(hikeAnchor.name);
      parts.push(`Best mountain-fit draft uses ${summitAnchorName} as the main hike anchor`);
    } else {
      parts.push("Best available draft keeps the trip mountain-focused, but the exact summit-style hike match is still loose");
    }

    if (promptIntent.softPreferences.wantsRecoveryDays) {
      parts.push(
        isTwoDayCompromise
          ? "For a short trip window, this keeps the hike day and the drive back in the same plan"
          : trip.itineraryDays?.length
            ? hasLighterRecoveryDays(trip, summitAnchorName)
              ? "Keeps the other days lighter around the main hike"
              : "Still needs clearer recovery-day pacing around the main hike"
            : "Leaves room for lighter recovery time around the main hike"
      );
    }
  }

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    parts.push(
      promptIntent.hardConstraints.mixedDietGroup
        ? "Keeps shared meal options workable for a vegetarian plus non-vegetarian group"
        : "Keeps vegetarian-friendly meals in the plan"
    );
  }

  if (typeof tripTotal === "number" && typeof totalBudget === "number") {
    parts.push(
      tripTotal <= totalBudget
        ? `Stays under the ${formatMoney(totalBudget)} total budget`
        : `Runs above the ${formatMoney(totalBudget)} total budget`
    );
  } else if (
    typeof input.budgetPerTraveler === "number" &&
    input.budgetPerTraveler > 0
  ) {
    parts.push(
      `Targets roughly ${formatMoney(input.budgetPerTraveler)} per traveler`
    );
  }

  if (promptIntent.hardConstraints.hikeDistanceKmTarget) {
    parts.push(
      `The requested ~${promptIntent.hardConstraints.hikeDistanceKmTarget} km round-trip hike length still needs trail-specific verification before you book around it`
    );
  }

  return parts.length > 0 ? `${parts.join(". ")}.` : undefined;
}

export function getPromptAwareTripSummary(trip: PromptSummaryTripLike) {
  if (!trip.tripPrompt) return trip.summary;

  const promptIntent = deriveTripIntentFromPrompt(trip.tripPrompt);
  const baseName =
    trip.homeBaseCity?.trim() ??
    trip.destinationName?.trim() ??
    trip.destination?.trim() ??
    trip.name?.trim() ??
    "This trip";
  const hasVegetarianNeed =
    promptIntent.hardConstraints.requiresVegetarianOptions;
  const hikeDistanceTarget =
    promptIntent.hardConstraints.hikeDistanceKmTarget;
  const isTwoDayCompromise =
    typeof trip.tripLengthDays === "number" && trip.tripLengthDays <= 2;
  const requestedActivityName = promptIntent.requestedActivityName?.trim();
  const requestedAnchor = requestedActivityName
    ? (trip.topActivities ?? []).find((activity) => {
        const activityName = normalized(normalizePlaceDisplayName(activity.name));
        const requestedName = normalized(requestedActivityName);

        return (
          activityName === requestedName ||
          activityName.includes(requestedName) ||
          requestedName.includes(activityName)
        );
      })
    : undefined;

  if (requestedActivityName) {
    const anchorName = normalizePlaceDisplayName(
      requestedAnchor?.name ?? requestedActivityName
    );
    const mealClause = hasVegetarianNeed
      ? "vegetarian-friendly shared meals around it"
      : "lighter food stops around it";
    const distanceClause = hikeDistanceTarget
      ? ` The requested ~${hikeDistanceTarget} km hike length still needs trail-specific verification.`
      : "";

    return isTwoDayCompromise
      ? `${baseName} now centers the trip around ${anchorName} as the main hike, with an easy arrival night, a lighter final-day flow, and ${mealClause}.${distanceClause}`
      : `${baseName} now uses ${anchorName} as the main hike anchor, with recovery-friendly pacing and ${mealClause}.${distanceClause}`;
  }

  const wantsHikingBrief =
    promptIntent.activityFocus === "hiking" ||
    promptIntent.hardConstraints.activityAnchor === "summit_hike" ||
    ((trip.tripPrompt?.toLowerCase().includes("hike") ?? false) &&
      promptIntent.softPreferences.wantsScenery);
  if (wantsHikingBrief && promptIntent.hardConstraints.activityAnchor !== "summit_hike") {
    const namedHike = bestScenicHikeCandidate({
      topActivities: (trip as RecommendationTripLike).topActivities,
    });
    const coffeeStop = bestCoffeeCandidate({
      foodSpots: (trip as RecommendationTripLike).foodSpots,
    });
    const namedHikeText =
      namedHike?.name?.trim() && scenicHikeSpecificityScore(namedHike) >= 55
        ? normalizePlaceDisplayName(namedHike.name)
        : "one named scenic hike";
    const coffeeClause =
      promptExplicitlyWantsCoffee(trip.tripPrompt) &&
      coffeeStop?.name?.trim() &&
      coffeeStopSpecificityScore(coffeeStop) >= 45
        ? `, plus a real coffee stop at ${normalizePlaceDisplayName(coffeeStop.name)}`
        : promptExplicitlyWantsCoffee(trip.tripPrompt)
          ? ", with a coffee stop still needing a more convincing pick"
          : "";

    return isTwoDayCompromise
      ? `${baseName} now keeps the trip centered on ${namedHikeText} as the main scenic hike${coffeeClause}, with an easy arrival and a lighter drive-back finish.`
      : `${baseName} now uses ${namedHikeText} as the main scenic hike${coffeeClause}, with the rest of the plan paced around a simpler mountain weekend.`;
  }

  if (promptIntent.activityFocus === "skiing") {
    const anchorName = findSkiAnchorName(trip, baseName);
    const skiDayCount = countSkiFocusedDays(trip, anchorName);
    const hasNamedSkiAnchor =
      Boolean(anchorName) &&
      !isGenericActivityDisplayName(anchorName) &&
      !isGeneratedSkiPlaceholder(anchorName, baseName);

    return isTwoDayCompromise
      ? hasNamedSkiAnchor
        ? `${baseName} now frames the trip around ${anchorName} as the main ski day, with an easy arrival night and a lighter drive-back finish.`
        : `${baseName} now frames the trip around one main ski day, with an easy arrival night and a lighter drive-back finish.`
      : skiDayCount >= 2
        ? hasNamedSkiAnchor
          ? `${baseName} now uses ${anchorName} as the main ski anchor, with skiing carrying across ${skiDayCount} days instead of collapsing into one short winter-sports window.`
          : `${baseName} now keeps skiing spread across ${skiDayCount} days instead of collapsing the trip into one short winter-sports window.`
        : hasNamedSkiAnchor
          ? `${baseName} now uses ${anchorName} as the main ski anchor, with the rest of the trip paced around one clear winter-sports day.`
          : `${baseName} now keeps one clear ski day as the main winter-sports anchor for the trip.`;
  }

  if (promptIntent.hardConstraints.activityAnchor !== "summit_hike") {
    return trip.summary;
  }

  const mealClause = hasVegetarianNeed
    ? "shared meal options that can still work for a vegetarian plus non-vegetarian group"
    : "shared food stops around the main hike";
  const distanceClause = hikeDistanceTarget
    ? ` The requested ~${hikeDistanceTarget} km hike length still needs trail-specific verification.`
    : "";
  const namedAnchor = bestNamedSummitAnchor({
    topActivities: (trip as RecommendationTripLike).topActivities,
  });
  const anchorClause =
    namedAnchor?.name?.trim() && hikeSpecificityScore(namedAnchor) >= 40
      ? ` with ${normalizePlaceDisplayName(namedAnchor.name)} as the clearest summit-style anchor`
      : "";

  if (isTwoDayCompromise) {
    return `${baseName} works as the best affordable mountain-base match for this brief${anchorClause}: one hard hike day, same-day drive back, and ${mealClause}.${distanceClause}`;
  }

  return `${baseName} works as a mountain base for one hard summit-hike day${anchorClause}, easier recovery time, and ${mealClause}.${distanceClause}`;
}

function buildCampgroundStayOption(
  activity: Activity,
  tripLengthDays?: number
): HotelOption {
  const nights = Math.max((tripLengthDays ?? 2) - 1, 1);
  const nightlyRate =
    typeof activity.estimatedCost === "number" && activity.estimatedCost > 0
      ? Math.max(35, Math.round(activity.estimatedCost / nights))
      : 45;
  const bookingLink =
    activity.bookingLink ?? activity.websiteUrl ?? activity.mapsUrl ?? "";

  return {
    name: activity.name,
    pricePerNight: nightlyRate,
    totalStayPrice: nightlyRate * nights,
    pricingSource: "campground estimate",
    availabilityStatus: "unverified",
    availabilitySource: "campground estimate",
    bookingLink,
    shortDescription:
      activity.shortDescription ??
      "Campground base promoted from the trip brief so the itinerary starts from a real campsite.",
    rating: activity.rating,
    estimatedCost: activity.estimatedCost,
    websiteUrl: activity.websiteUrl,
    mapsUrl: activity.mapsUrl,
    photoRef: activity.photoRef,
    photoUrl: activity.photoUrl,
    latitude: activity.latitude,
    longitude: activity.longitude,
  };
}

function dedupeHotelOptionsByName(hotels: HotelOption[]) {
  const seen = new Set<string>();
  const result: HotelOption[] = [];

  for (const hotel of hotels) {
    const key = normalized(hotel.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(hotel);
  }

  return result;
}

export function refineTripStayRecommendation({
  trip,
  input,
  hotelOptions,
  activities,
}: {
  trip: RecommendationTripLike;
  input?: Partial<TripInput>;
  hotelOptions: HotelOption[];
  activities: Activity[];
}) {
  let nextHotels = [...hotelOptions];
  let nextActivities = [...activities];

  const specificActivities = nextActivities.filter(
    (activity) => !isBroadDestinationActivity(activity, trip)
  );
  if (specificActivities.length >= 2) {
    nextActivities = specificActivities;
  }

  if (!isCampingFocused(input)) {
    return {
      hotelOptions: nextHotels,
      activities: nextActivities,
    };
  }

  const existingCampingStay = nextHotels.find((hotel) =>
    isCampingStayLikeHotel(hotel)
  );
  const promotedCampingActivity = [...nextActivities]
    .filter((activity) => isCampingStayLikeActivity(activity))
    .sort((a, b) => campingStayScore(b, trip) - campingStayScore(a, trip))[0];

  const promotedStay =
    existingCampingStay ??
    (promotedCampingActivity
      ? buildCampgroundStayOption(promotedCampingActivity, input?.tripLengthDays)
      : undefined);

  if (!promotedStay) {
    return {
      hotelOptions: nextHotels,
      activities: nextActivities,
    };
  }

  nextHotels = dedupeHotelOptionsByName([promotedStay, ...nextHotels]);

  const activitiesWithoutPromotedStay = nextActivities.filter(
    (activity) => normalized(activity.name) !== normalized(promotedStay.name)
  );
  const nonCampingActivities = activitiesWithoutPromotedStay.filter(
    (activity) => !isCampingStayLikeActivity(activity)
  );

  nextActivities =
    nonCampingActivities.length >= 2
      ? nonCampingActivities
      : activitiesWithoutPromotedStay;

  return {
    hotelOptions: nextHotels,
    activities: nextActivities,
    recommendedStayName: promotedStay.name,
  };
}

export function getRecommendedTripTitle(
  trip: RecommendationTripLike,
  input?: Partial<TripInput> | null
) {
  const selectedStayName = trip.savedSelectionState?.hotelName?.trim();
  const titleLooksCampingSpecific = isCampingStayLikeText(trip.title);
  const firstHotelLooksCampingSpecific = isCampingStayLikeHotel(
    trip.hotelOptions?.[0]
  );

  if (
    selectedStayName &&
    (isCampingFocused(input) ||
      titleLooksCampingSpecific ||
      firstHotelLooksCampingSpecific ||
      isCampingStayLikeText(selectedStayName))
  ) {
    return selectedStayName;
  }

  if (trip.title?.trim()) {
    if (isSummitHikeFocused(input)) {
      const summitTitle = normalizePlaceDisplayName(trip.title);
      const summitTitleText = normalized(summitTitle);
      const scenicBucketTitle =
        summitTitleText.includes("viewpoint") ||
        summitTitleText.includes("viewpoints") ||
        summitTitleText.includes("ridge scenery") ||
        summitTitleText.includes("mountain views") ||
        summitTitleText.includes("view scenery");

      if (
        summitTitle &&
        !isGenericActivityDisplayName(summitTitle) &&
        !scenicBucketTitle
      ) {
        return summitTitle;
      }

      if (trip.name?.trim()) {
        return trip.name.trim();
      }

      if (trip.homeBaseCity?.trim()) {
        return trip.homeBaseCity.trim();
      }

      if (trip.destinationName?.trim()) {
        return trip.destinationName.trim();
      }

      if (trip.destination?.trim()) {
        return trip.destination.trim();
      }
    }

    return trip.title.trim();
  }

  if (isSummitHikeFocused(input)) {
    if (trip.name?.trim()) {
      return trip.name.trim();
    }

    if (trip.homeBaseCity?.trim()) {
      return trip.homeBaseCity.trim();
    }

    if (trip.destinationName?.trim()) {
      return trip.destinationName.trim();
    }

    if (trip.destination?.trim()) {
      return trip.destination.trim();
    }
  }

  if (isCampingFocused(input) || firstHotelLooksCampingSpecific) {
    const campingStay = trip.hotelOptions?.find((hotel) =>
      isCampingStayLikeHotel(hotel)
    );
    if (campingStay?.name?.trim()) {
      return campingStay.name.trim();
    }

    const campingActivity = [...(trip.topActivities ?? [])]
      .filter((activity) => isCampingStayLikeActivity(activity))
      .sort((a, b) => campingStayScore(b, trip) - campingStayScore(a, trip))[0];
    if (campingActivity?.name?.trim()) {
      return campingActivity.name.trim();
    }
  }

  return (
    trip.name?.trim() ??
    trip.destinationName?.trim() ??
    trip.destination?.trim() ??
    "Trip"
  );
}

export function getRecommendationContextLabel(
  trip: Pick<
    RecommendationTripLike,
    "destinationName" | "destination" | "homeBaseCity" | "name" | "province"
  >,
  title: string
) {
  const destinationName =
    trip.homeBaseCity?.trim() ??
    trip.destinationName?.trim() ??
    trip.destination?.trim() ??
    trip.name?.trim();
  const destinationLabel = [destinationName, trip.province?.trim()]
    .filter(Boolean)
    .join(", ");

  if (!destinationLabel) return undefined;

  const normalizedTitle = normalized(title);
  const normalizedDestinationName = normalized(destinationName);
  const normalizedDestinationLabel = normalized(destinationLabel);

  if (
    !normalizedTitle ||
    normalizedTitle === normalizedDestinationName ||
    normalizedTitle === normalizedDestinationLabel
  ) {
    return undefined;
  }

  return `Base in ${destinationLabel}`;
}
