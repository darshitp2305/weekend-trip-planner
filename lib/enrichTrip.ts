import {
  HotelOption,
  RankedDestination,
  RankingReason,
  TripDataSource,
  TripInput,
} from "./types";
import { GooglePlace } from "./googlePlaces";
import {
  searchActivities,
  searchCafes,
  searchHotels,
  searchRestaurants,
} from "./googlePlaces";
import {
  mapGooglePlaceToActivity,
  mapGooglePlaceToFoodSpot,
  mapGooglePlaceToHotel,
} from "./placeMappers";
import { searchHotelsWithSerpApi } from "./serpApiHotels";

const ENRICH_CACHE_TTL_MS = 1000 * 60 * 20;

type EnrichmentCacheEntry = {
  expiresAt: number;
  value: { trip: RankedDestination; source: TripDataSource };
};

const enrichCache = new Map<string, EnrichmentCacheEntry>();

function averageRating(
  items: Array<{ rating?: number }>
): number | undefined {
  const rated = items.filter((item) => typeof item.rating === "number");
  if (rated.length === 0) return undefined;

  const average =
    rated.reduce((sum, item) => sum + (item.rating ?? 0), 0) / rated.length;

  return Number(average.toFixed(1));
}

function dedupeByName<T extends { name?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = (item.name ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function normalizeName(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function normalizeText(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function destinationTokens(trip: RankedDestination) {
  return Array.from(
    new Set(
      [
        trip.name,
        trip.province,
        trip.homeBaseCity,
        ...(trip.rawVibes ?? []),
      ]
        .flatMap((value) =>
          normalizeText(value)
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
        )
        .filter((token) => token.length >= 4)
    )
  );
}

function placeSearchText(place: GooglePlace) {
  return normalizeText(
    [
      place.displayName?.text,
      place.formattedAddress,
      place.primaryType,
    ].join(" ")
  );
}

function shouldRejectPlace(place: GooglePlace, kind: "food" | "activity" | "hotel") {
  const text = placeSearchText(place);

  const bannedTerms = [
    "visitor centre",
    "visitor center",
    "tourism office",
    "information centre",
    "information center",
    "government office",
    "corporate office",
    "office tower",
    "city hall",
    "administration",
  ];

  if (bannedTerms.some((term) => text.includes(term))) {
    return true;
  }

  if (kind === "food") {
    const foodBanned = [
      "gas station",
      "convenience store",
      "grocery store",
      "supermarket",
      "liquor store",
    ];
    if (foodBanned.some((term) => text.includes(term))) {
      return true;
    }
  }

  if (kind === "hotel") {
    const hotelBanned = ["rv park", "campground", "hostel desk"];
    if (hotelBanned.some((term) => text.includes(term))) {
      return true;
    }
  }

  return false;
}

function placeRelevanceScore(
  place: GooglePlace,
  trip: RankedDestination,
  kind: "food" | "activity" | "hotel",
  input: TripInput
) {
  const text = placeSearchText(place);
  const tokens = destinationTokens(trip);
  let score = 0;

  for (const token of tokens) {
    if (text.includes(token)) {
      score += 8;
    }
  }

  const rating = place.rating ?? 0;
  const userRatingCount = place.userRatingCount ?? 0;
  score += rating * 8;
  score += Math.min(18, Math.log10(Math.max(1, userRatingCount)) * 8);

  if (kind === "food") {
    const foodSignals = ["restaurant", "cafe", "coffee", "bakery", "brunch", "bistro"];
    if (foodSignals.some((term) => text.includes(term))) score += 10;
    if (input.style === "foodie" && ["market", "brew", "chef", "dining"].some((term) => text.includes(term))) {
      score += 8;
    }
  }

  if (kind === "activity") {
    const styleSignals =
      input.style === "foodie"
        ? ["market", "tour", "museum", "downtown"]
        : input.style === "adventure" || input.style === "outdoors"
          ? ["trail", "hike", "lake", "viewpoint", "park", "gondola", "canyon", "waterfall"]
          : input.style === "chill" || input.style === "solo reset"
            ? ["spa", "scenic", "viewpoint", "garden", "lake", "walk"]
            : ["heritage", "museum", "lookout", "historic", "local"];

    if (styleSignals.some((term) => text.includes(term))) {
      score += 12;
    }
  }

  if (kind === "hotel") {
    const hotelSignals = ["hotel", "resort", "inn", "lodge", "suites"];
    if (hotelSignals.some((term) => text.includes(term))) score += 10;
  }

  return score;
}

function rankPlaces(
  places: GooglePlace[],
  trip: RankedDestination,
  kind: "food" | "activity" | "hotel",
  input: TripInput
) {
  return [...places]
    .filter((place) => !shouldRejectPlace(place, kind))
    .sort(
      (a, b) =>
        placeRelevanceScore(b, trip, kind, input) -
        placeRelevanceScore(a, trip, kind, input)
    );
}

function createEnrichCacheKey(trip: RankedDestination, input: TripInput) {
  return JSON.stringify({
    name: trip.name,
    province: trip.province,
    startCity: input.startCity,
    style: input.style,
    tripStartDate: input.tripStartDate,
    tripEndDate: input.tripEndDate,
    travelerCount: input.travelerCount,
  });
}

function mergeHotelSources<
  TPrimary extends {
    name?: string;
    photoRef?: string;
    photoUrl?: string;
    mapsUrl?: string;
    websiteUrl?: string;
    bookingLink?: string;
    shortDescription?: string;
    rating?: number;
  },
  TFallback extends {
    name?: string;
    photoRef?: string;
    photoUrl?: string;
    mapsUrl?: string;
    websiteUrl?: string;
    bookingLink?: string;
    shortDescription?: string;
    rating?: number;
  },
>(primary: TPrimary[], fallback: TFallback[]) {
  const fallbackByName = new Map(
    fallback.map((item) => [normalizeName(item.name), item] as const)
  );

  return primary.map((item) => {
    const match = fallbackByName.get(normalizeName(item.name));

    if (!match) return item;

    return {
      ...match,
      ...item,
      photoRef: item.photoRef ?? match.photoRef,
      photoUrl: item.photoUrl ?? match.photoUrl,
      mapsUrl: item.mapsUrl ?? match.mapsUrl,
      websiteUrl: item.websiteUrl ?? match.websiteUrl,
      bookingLink: item.bookingLink ?? match.bookingLink,
      shortDescription: item.shortDescription ?? match.shortDescription,
      rating: item.rating ?? match.rating,
    };
  });
}

function hasName<T extends { name?: string }>(item: T): item is T & { name: string } {
  return typeof item.name === "string" && item.name.trim().length > 0;
}

function interleaveArrays<T>(...arrays: T[][]): T[] {
  const result: T[] = [];
  const maxLength = Math.max(...arrays.map((arr) => arr.length), 0);

  for (let i = 0; i < maxLength; i += 1) {
    for (const arr of arrays) {
      if (arr[i] !== undefined) {
        result.push(arr[i]);
      }
    }
  }

  return result;
}

function buildLiveSummary(
  restaurantItems: Array<{ rating?: number }>,
  activityItems: Array<{ rating?: number }>,
  hotelItems: Array<{ rating?: number }>,
  usedPlacesData: boolean
) {
  return {
    restaurantCount: restaurantItems.length,
    avgRestaurantRating: averageRating(restaurantItems),
    activityCount: activityItems.length,
    avgActivityRating: averageRating(activityItems),
    hotelCount: hotelItems.length,
    usedPlacesData,
    usedFallbackData: !usedPlacesData,
  };
}

export async function enrichRankedTrip(
  trip: RankedDestination,
  input: TripInput
): Promise<{ trip: RankedDestination; source: TripDataSource }> {
  const cacheKey = createEnrichCacheKey(trip, input);
  const cached = enrichCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const destinationQuery = `${trip.name}, ${trip.province}`;

  try {
    const hotelSearchPromise =
      input.tripStartDate && input.tripEndDate
        ? searchHotelsWithSerpApi({
            destination: destinationQuery,
            tripStartDate: input.tripStartDate,
            tripEndDate: input.tripEndDate,
            adults: input.travelerCount,
          }).catch(async (error) => {
            console.error("SerpApi hotel search failed, falling back to Places:", error);
            return null;
          })
        : Promise.resolve(null);

    const [restaurantsRes, cafesRes, activitiesRes, hotelsRes, serpHotels] =
      await Promise.all([
        searchRestaurants(destinationQuery),
        searchCafes(destinationQuery),
        searchActivities(destinationQuery, input.style),
        searchHotels(destinationQuery, {
          tripStartDate: input.tripStartDate,
          tripEndDate: input.tripEndDate,
        }),
        hotelSearchPromise,
      ]);

    const liveRestaurants = dedupeByName(
      rankPlaces(restaurantsRes.places ?? [], trip, "food", input)
        .map(mapGooglePlaceToFoodSpot)
        .filter(hasName)
    );

    const liveCafes = dedupeByName(
      rankPlaces(cafesRes.places ?? [], trip, "food", input)
        .map(mapGooglePlaceToFoodSpot)
        .filter(hasName)
    );

    const liveActivities = dedupeByName(
      rankPlaces(activitiesRes.places ?? [], trip, "activity", input)
        .map(mapGooglePlaceToActivity)
        .filter(hasName)
    );

    const serpApiHotels = dedupeByName(
      (serpHotels ?? []).filter(hasName)
    );

    const placesHotels = dedupeByName(
      rankPlaces(hotelsRes.places ?? [], trip, "hotel", input)
        .map(mapGooglePlaceToHotel)
        .filter(hasName)
    );

    const liveHotels =
      serpApiHotels.length > 0
        ? mergeHotelSources(serpApiHotels, placesHotels)
        : placesHotels;

    const balancedFoodSpots = dedupeByName(
      interleaveArrays(liveRestaurants, liveCafes)
    );

    const mergedFoodSpots =
      balancedFoodSpots.length > 0
        ? balancedFoodSpots.slice(0, 12)
        : trip.foodSpots;

    const mergedActivities =
      liveActivities.length > 0
        ? liveActivities.slice(0, 12)
        : trip.topActivities;

    const mergedHotels =
      liveHotels.length > 0
        ? liveHotels.slice(0, 6)
        : trip.hotelOptions;

    const hasLiveResults =
      balancedFoodSpots.length > 0 ||
      liveActivities.length > 0 ||
      liveHotels.length > 0;

    const source: TripDataSource = hasLiveResults
      ? "live-google-places"
      : "static-fallback";

    const liveDataSummary = buildLiveSummary(
      balancedFoodSpots as Array<{ rating?: number }>,
      liveActivities as Array<{ rating?: number }>,
      liveHotels as Array<{ rating?: number }>,
      hasLiveResults
    );

    const rankingReasons: RankingReason[] = Array.isArray(trip.rankingReasons)
      ? [...trip.rankingReasons]
      : [];

    if (hasLiveResults) {
      rankingReasons.unshift({
        label: "Backed by live Google Places results",
        impact: "positive",
      });
    } else {
      rankingReasons.unshift({
        label: "Using fallback recommendation data",
        impact: "neutral",
      });
    }

    const mergedTrip: RankedDestination = {
      ...trip,
      foodSpots: mergedFoodSpots,
      topActivities: mergedActivities,
      hotelOptions: mergedHotels as HotelOption[],
      liveDataSummary,
      rankingReasons: rankingReasons.slice(0, 4),
    };

    const result: { trip: RankedDestination; source: TripDataSource } = {
      trip: mergedTrip,
      source,
    };
    enrichCache.set(cacheKey, {
      expiresAt: Date.now() + ENRICH_CACHE_TTL_MS,
      value: result,
    });

    return result;
  } catch (error) {
    console.error(
      "Google Places enrichment failed. Falling back to static trip data.",
      error
    );

    const fallbackRankingReasons: RankingReason[] = [
      {
        label: "Using fallback recommendation data",
        impact: "neutral",
      },
      ...(trip.rankingReasons ?? []),
    ];

    const result: { trip: RankedDestination; source: TripDataSource } = {
      trip: {
        ...trip,
        liveDataSummary: buildLiveSummary(
          trip.foodSpots,
          trip.topActivities,
          trip.hotelOptions,
          false
        ),
        rankingReasons: fallbackRankingReasons.slice(0, 4),
      },
      source: "static-fallback",
    };

    enrichCache.set(cacheKey, {
      expiresAt: Date.now() + ENRICH_CACHE_TTL_MS,
      value: result,
    });

    return result;
  }
}
