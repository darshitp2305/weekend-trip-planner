import { Activity, HotelOption, TripInput, TripSelectionState } from "./types";

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

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
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
    return trip.title.trim();
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
