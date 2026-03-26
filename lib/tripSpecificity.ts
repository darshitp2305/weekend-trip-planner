import {
  Activity,
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
  savedSelectionState?: Pick<TripSelectionState, "hotelName">;
};

type PromptFitTripLike = Pick<RecommendationTripLike, "topActivities"> & {
  budgetBreakdown?: {
    total?: number;
    totalExpected?: number;
  };
  estimatedCost?: number;
  itineraryDays?: Pick<ItineraryDayData, "stops">[];
};

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePlaceDisplayName(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(/\s*trailhead$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\-]\s*$/g, "")
    .trim();
}

function signalText(parts: Array<string | undefined>) {
  return normalized(parts.filter(Boolean).join(" "));
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

function hikeSpecificityScore(activity: Activity) {
  const text = signalText([activity.name, activity.type, activity.shortDescription]);
  let score = 0;

  if (text.includes("summit")) score += 80;
  if (text.includes("peak")) score += 72;
  if (text.includes("ridge")) score += 64;
  if (text.includes("scramble")) score += 56;
  if (text.includes("alpine")) score += 48;
  if (text.includes("trail")) score += 30;
  if (text.includes("hike")) score += 26;
  if (text.includes("lookout")) score += 18;
  if (text.includes("viewpoint")) score += 16;
  if (text.includes("mountain")) score += 16;
  if (text.includes("trailhead")) score -= 8;
  if (text.endsWith("national park") || text.endsWith("provincial park")) score -= 30;
  if (typeof activity.rating === "number") score += activity.rating * 4;

  return score;
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
    const hikeAnchor = [...(trip.topActivities ?? [])]
      .sort((a, b) => hikeSpecificityScore(b) - hikeSpecificityScore(a))[0];

    if (hikeAnchor?.name?.trim() && hikeSpecificityScore(hikeAnchor) >= 40) {
      summitAnchorName = normalizePlaceDisplayName(hikeAnchor.name);
      parts.push(`Locks onto ${summitAnchorName} as the signature summit-style hike`);
    } else {
      parts.push("Closest match is still only an approximate summit-style hike fit");
    }

    if (promptIntent.softPreferences.wantsRecoveryDays) {
      parts.push(
        trip.itineraryDays?.length
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
      `The ~${promptIntent.hardConstraints.hikeDistanceKmTarget} km round-trip target is still approximate from place signals, not trail-specific distance data`
    );
  }

  return parts.length > 0 ? `${parts.join(". ")}.` : undefined;
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
    return isSummitHikeFocused(input)
      ? normalizePlaceDisplayName(trip.title)
      : trip.title.trim();
  }

  if (isSummitHikeFocused(input)) {
    const hikeAnchor = [...(trip.topActivities ?? [])]
      .filter((activity) => !isBroadDestinationActivity(activity, trip))
      .sort((a, b) => hikeSpecificityScore(b) - hikeSpecificityScore(a))[0];

    if (hikeAnchor?.name?.trim() && hikeSpecificityScore(hikeAnchor) >= 40) {
      return normalizePlaceDisplayName(hikeAnchor.name);
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
    "destinationName" | "destination" | "name" | "province"
  >,
  title: string
) {
  const destinationName =
    trip.destinationName?.trim() ?? trip.destination?.trim() ?? trip.name?.trim();
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
