import {
  HotelOption,
  RankedDestination,
  RankingReason,
  TripDataSource,
  TripInput,
} from "./types";
import { type GooglePlace } from "./googlePlaces";
import {
  mapGooglePlaceToActivity,
  mapGooglePlaceToFoodSpot,
  mapGooglePlaceToHotel,
} from "./placeMappers";
import { sortHotelOptions } from "./hotelAvailability";
import { fetchHotelsDotComHotelData } from "./hotelsDotComHotelProvider";
import { fetchPlacesProviderData } from "./placesProvider";
import { reportProviderEvent } from "./providerTelemetry";
import { searchHotelsWithSerpApi } from "./serpApiHotels";
import { deriveTripIntentFromPrompt } from "./tripIntent";
import { isGenericActivityDisplayName } from "./tripSpecificity";

const ENRICH_CACHE_TTL_MS = 1000 * 60 * 20;

type EnrichmentCacheEntry = {
  expiresAt: number;
  value: { trip: RankedDestination; source: TripDataSource };
};

const enrichCache = new Map<string, EnrichmentCacheEntry>();

// Use averages only as a supporting signal for ranking copy and confidence.
// Missing ratings are common in provider responses, so undefined is meaningful.
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

function mergeNamedPlaces<T extends { name?: string }>(
  preferred: T[],
  fallback: T[],
  limit: number
) {
  return dedupeByName([...preferred, ...fallback]).slice(0, limit);
}

function normalizeLocationText(value?: string) {
  return normalizeText(value)
    .replace(/\(.*?\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_LOCATION_TERMS = new Set([
  "alberta",
  "canada",
  "area",
  "region",
  "national",
  "provincial",
  "park",
  "county",
  "district",
  "town",
  "city",
  "staycation",
]);

type DestinationLocationContext = {
  primaryPhrases: string[];
  secondaryPhrases: string[];
  primaryWords: string[];
  secondaryWords: string[];
};

function wordsFromLocationText(value?: string) {
  return normalizeLocationText(value)
    .split(/\s+/)
    .filter(
      (token) => token.length >= 4 && !GENERIC_LOCATION_TERMS.has(token)
    );
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean))
  ) as string[];
}

function destinationLocationContext(
  trip: RankedDestination
): DestinationLocationContext {
  const primaryPhrases = uniqueStrings([normalizeLocationText(trip.name)]);
  const secondaryPhrases = uniqueStrings([
    normalizeLocationText(trip.homeBaseCity),
  ]);

  return {
    primaryPhrases,
    secondaryPhrases,
    primaryWords: Array.from(
      new Set(primaryPhrases.flatMap((phrase) => wordsFromLocationText(phrase)))
    ),
    secondaryWords: Array.from(
      new Set(secondaryPhrases.flatMap((phrase) => wordsFromLocationText(phrase)))
    ),
  };
}

function locationMatchSignal(
  value: string,
  context: DestinationLocationContext
) {
  const normalized = normalizeLocationText(value);
  const words = new Set(normalized.split(/\s+/).filter(Boolean));
  const primaryPhraseMatches = context.primaryPhrases.filter(
    (phrase) => phrase && normalized.includes(phrase)
  ).length;
  const secondaryPhraseMatches = context.secondaryPhrases.filter(
    (phrase) => phrase && normalized.includes(phrase)
  ).length;
  const primaryWordMatches = context.primaryWords.filter((word) =>
    words.has(word)
  ).length;
  const secondaryWordMatches = context.secondaryWords.filter((word) =>
    words.has(word)
  ).length;

  return {
    primaryPhraseMatches,
    secondaryPhraseMatches,
    primaryWordMatches,
    secondaryWordMatches,
  };
}

function hasStrongLocationMatch(
  value: string,
  context: DestinationLocationContext
) {
  const signal = locationMatchSignal(value, context);

  return (
    signal.primaryPhraseMatches > 0 ||
    signal.secondaryPhraseMatches > 0 ||
    signal.primaryWordMatches > 0 ||
    signal.secondaryWordMatches >= 2
  );
}

function destinationTokens(trip: RankedDestination) {
  const context = destinationLocationContext(trip);
  return Array.from(
    new Set([
      ...context.primaryWords,
      ...context.secondaryWords,
      ...((trip.rawVibes ?? [])
        .flatMap((value) =>
          normalizeText(value)
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
        )
        .filter((token) => token.length >= 4)),
    ])
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

function placeDisplayName(place: GooglePlace) {
  return (place.displayName?.text ?? "").trim();
}

function hasStrongSummitIdentity(text: string) {
  return ["summit", "peak", "ridge", "scramble", "alpine"].some((term) =>
    text.includes(term)
  );
}

function isNumericOnlyPlaceName(value?: string) {
  const normalized = (value ?? "").trim();
  return /^\d+[a-z]?$/i.test(normalized);
}

function countTextMatches(text: string, keywords: string[]) {
  return keywords.reduce((total, keyword) => {
    return total + (text.includes(keyword) ? 1 : 0);
  }, 0);
}

function promptActivitySignal(text: string, input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const strongSummitSignal = countTextMatches(text, [
    "summit",
    "peak",
    "ridge",
    "scramble",
    "alpine",
    "mountain",
  ]);
  const hikeSignal = countTextMatches(text, [
    "trail",
    "hike",
    "loop",
    "lookout",
    "viewpoint",
    "canyon",
    "waterfall",
    "lake",
    "backcountry",
  ]);
  const scenicSignal = countTextMatches(text, [
    "scenic",
    "view",
    "lookout",
    "viewpoint",
    "panorama",
    "panoramic",
    "mountain",
    "lake",
  ]);

  let score = 0;

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    if (strongSummitSignal >= 1) {
      score += 24;
    } else if (hikeSignal >= 2) {
      score += 8;
    } else {
      score -= 16;
    }

    if (text.includes("trailhead") && strongSummitSignal === 0) {
      score -= 12;
    }

    if (text.includes("viewpoint") && strongSummitSignal === 0) {
      score -= 10;
    }

    if (
      (text.endsWith("national park") || text.endsWith("provincial park")) &&
      strongSummitSignal === 0
    ) {
      score -= 18;
    }
  }

  if (promptIntent.hardConstraints.hikeDistanceKmTarget) {
    if (
      strongSummitSignal >= 1 ||
      text.includes("backcountry") ||
      text.includes("loop")
    ) {
      score += 6;
    } else if (!text.includes("trail") && !text.includes("hike")) {
      score -= 8;
    }

    if (
      (text.includes("trailhead") || text.includes("viewpoint")) &&
      strongSummitSignal === 0
    ) {
      score -= 6;
    }
  }

  if (promptIntent.hardConstraints.requiresScenicView) {
    score += scenicSignal >= 1 ? 12 : -8;
  }

  return score;
}

function promptFoodSignal(text: string, input: TripInput) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  let score = 0;

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    if (
      ["vegetarian", "vegan", "plant", "salad", "falafel", "mediterranean", "indian", "thai", "mexican", "asian", "fusion"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 18;
    } else if (
      ["restaurant", "bistro", "kitchen", "dining", "cafe", "bakery", "brunch"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 4;
    } else {
      score -= 8;
    }

    if (
      promptIntent.hardConstraints.mixedDietGroup &&
      ["restaurant", "bistro", "kitchen", "fusion", "grill", "dining"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 6;
    }
  }

  if (promptIntent.softPreferences.wantsGoodFood) {
    if (
      ["restaurant", "bistro", "kitchen", "bakery", "brunch", "chef", "fusion", "trattoria", "cafe"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 8;
    }
  }

  return score;
}

function shouldRejectPlace(
  place: GooglePlace,
  trip: RankedDestination,
  kind: "food" | "activity" | "hotel",
  input: TripInput
) {
  const text = placeSearchText(place);
  const displayName = placeDisplayName(place);

  // Broad text searches bring back plenty of operational or utility locations
  // that technically match the query but should never shape trip quality.
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

  if (
    (kind === "food" || kind === "activity") &&
    isNumericOnlyPlaceName(displayName)
  ) {
    return true;
  }

  if (kind === "food") {
    const foodBanned = [
      "gas station",
      "convenience store",
      "grocery store",
      "general store",
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

  if (kind === "activity") {
    const obviousHotelTerms = [
      "hotel",
      "resort hotel",
      "inn",
      "lodge",
      "suites",
      "lodging",
      "spa resort",
    ];
    const activityOverrideTerms = [
      "ski",
      "gondola",
      "trail",
      "hike",
      "park",
      "lake",
      "museum",
      "viewpoint",
      "canyon",
      "waterfall",
      "hot spring",
      "historic",
      "landmark",
      "tour",
    ];

    if (
      obviousHotelTerms.some((term) => text.includes(term)) &&
      !activityOverrideTerms.some((term) => text.includes(term))
    ) {
      return true;
    }

    const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
    if (
      promptIntent.hardConstraints.activityAnchor === "summit_hike" &&
      (displayName.toLowerCase().endsWith("national park") ||
        displayName.toLowerCase().endsWith("provincial park")) &&
      !["summit", "peak", "ridge", "trail", "hike", "lookout", "viewpoint"].some(
        (term) => text.includes(term)
      )
    ) {
      return true;
    }

    if (
      promptIntent.hardConstraints.activityAnchor === "summit_hike" &&
      isGenericActivityDisplayName(displayName) &&
      !hasStrongSummitIdentity(text)
    ) {
      return true;
    }
  }

  if (!hasStrongLocationMatch(text, destinationLocationContext(trip))) {
    return true;
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
  const locationSignal = locationMatchSignal(
    text,
    destinationLocationContext(trip)
  );
  let score = 0;

  score += locationSignal.primaryPhraseMatches * 30;
  score += locationSignal.secondaryPhraseMatches * 22;
  score += locationSignal.primaryWordMatches * 12;
  score += locationSignal.secondaryWordMatches * 8;

  // Reward places that clearly belong to the destination instead of generic
  // regional results returned from broad travel queries.
  for (const token of tokens) {
    if (normalizeLocationText(text).split(/\s+/).includes(token)) {
      score += 8;
    }
  }

  const rating = place.rating ?? 0;
  const userRatingCount = place.userRatingCount ?? 0;
  // Ratings without review volume are noisy, so count helps stabilize ordering.
  score += rating * 8;
  score += Math.min(18, Math.log10(Math.max(1, userRatingCount)) * 8);

  if (kind === "food") {
    const foodSignals = ["restaurant", "cafe", "coffee", "bakery", "brunch", "bistro"];
    if (foodSignals.some((term) => text.includes(term))) score += 10;
    if (input.style === "foodie" && ["market", "brew", "chef", "dining"].some((term) => text.includes(term))) {
      score += 8;
    }
    if (input.veganFriendly) {
      if (["vegan", "vegetarian", "plant", "salad", "organic"].some((term) => text.includes(term))) {
        score += 18;
      } else {
        score -= 6;
      }
    }
    score += promptFoodSignal(text, input);
  }

  if (kind === "activity") {
    // Activity relevance depends heavily on trip style, so we bias the score
    // toward terms that match the user's stated intent.
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

    if (isGenericActivityDisplayName(placeDisplayName(place))) {
      score -= 36;
    }

    score += promptActivitySignal(text, input);
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
  // Filter first, then sort by trip-specific relevance so downstream mapping
  // sees the best provider candidates in a stable order.
  return [...places]
    .filter((place) => !shouldRejectPlace(place, trip, kind, input))
    .sort(
      (a, b) =>
        placeRelevanceScore(b, trip, kind, input) -
        placeRelevanceScore(a, trip, kind, input)
    );
}

function hotelSearchText(hotel: {
  name?: string;
  shortDescription?: string;
}) {
  return normalizeLocationText([hotel.name, hotel.shortDescription].join(" "));
}

function normalizeHotelIdentity(value?: string) {
  return normalizeLocationText(value)
    .replace(/\b(the|by|at)\b/gu, " ")
    .replace(
      /\b(hotel|hotels|resort|resorts|inn|inns|lodge|lodges|suite|suites|motel|spa|retreat|accommodation|accommodations|lodging|guesthouse|apartments|apartment|chalets|chalet)\b/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function hotelNameTokens(value?: string) {
  return normalizeHotelIdentity(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function countSharedTokens(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.reduce((count, token) => count + Number(rightSet.has(token)), 0);
}

function toFiniteNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function distanceBetweenCoordinatesKm(
  leftLat?: number,
  leftLon?: number,
  rightLat?: number,
  rightLon?: number
) {
  const lat1 = toFiniteNumber(leftLat);
  const lon1 = toFiniteNumber(leftLon);
  const lat2 = toFiniteNumber(rightLat);
  const lon2 = toFiniteNumber(rightLon);

  if (
    lat1 === undefined ||
    lon1 === undefined ||
    lat2 === undefined ||
    lon2 === undefined
  ) {
    return undefined;
  }

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hotelMatchKey(hotel: {
  name?: string;
  shortDescription?: string;
  latitude?: number;
  longitude?: number;
}) {
  const identityKey = normalizeHotelIdentity(hotel.name) || normalizeName(hotel.name);
  if (identityKey) return identityKey;

  return [
    normalizeLocationText(hotel.shortDescription),
    toFiniteNumber(hotel.latitude)?.toFixed(4) ?? "",
    toFiniteNumber(hotel.longitude)?.toFixed(4) ?? "",
  ].join("|");
}

function hotelMatchSignal(
  baseHotel: Pick<
    HotelOption,
    "name" | "shortDescription" | "latitude" | "longitude" | "availabilityStatus"
  >,
  candidateHotel: Pick<
    HotelOption,
    "name" | "shortDescription" | "latitude" | "longitude" | "availabilityStatus"
  >
) {
  const normalizedBaseName = normalizeName(baseHotel.name);
  const normalizedCandidateName = normalizeName(candidateHotel.name);
  const baseIdentity = normalizeHotelIdentity(baseHotel.name);
  const candidateIdentity = normalizeHotelIdentity(candidateHotel.name);
  const baseTokens = hotelNameTokens(baseHotel.name);
  const candidateTokens = hotelNameTokens(candidateHotel.name);
  const tokenOverlap = countSharedTokens(baseTokens, candidateTokens);
  const baseAddressTokens = wordsFromLocationText(baseHotel.shortDescription);
  const candidateAddressTokens = wordsFromLocationText(
    candidateHotel.shortDescription
  );
  const addressOverlap = countSharedTokens(
    baseAddressTokens,
    candidateAddressTokens
  );
  const distanceKm = distanceBetweenCoordinatesKm(
    baseHotel.latitude,
    baseHotel.longitude,
    candidateHotel.latitude,
    candidateHotel.longitude
  );
  const exactNameMatch =
    Boolean(normalizedBaseName) && normalizedBaseName === normalizedCandidateName;
  const exactIdentityMatch =
    Boolean(baseIdentity) && baseIdentity === candidateIdentity;
  const partialIdentityMatch =
    Boolean(baseIdentity) &&
    Boolean(candidateIdentity) &&
    baseIdentity !== candidateIdentity &&
    (baseIdentity.includes(candidateIdentity) ||
      candidateIdentity.includes(baseIdentity));

  let score = 0;

  if (exactNameMatch) score += 120;
  if (exactIdentityMatch) score += 100;
  if (partialIdentityMatch) score += 44;
  score += tokenOverlap * 18;

  const normalizedBaseAddress = normalizeLocationText(baseHotel.shortDescription);
  const normalizedCandidateAddress = normalizeLocationText(
    candidateHotel.shortDescription
  );

  if (
    normalizedBaseAddress &&
    normalizedCandidateAddress &&
    normalizedBaseAddress === normalizedCandidateAddress
  ) {
    score += 60;
  } else {
    score += Math.min(30, addressOverlap * 8);
  }

  if (typeof distanceKm === "number") {
    if (distanceKm <= 0.2) {
      score += 72;
    } else if (distanceKm <= 0.75) {
      score += 54;
    } else if (distanceKm <= 2) {
      score += 34;
    } else if (distanceKm <= 5) {
      score += 16;
    } else if (distanceKm > 25) {
      score -= 90;
    } else if (distanceKm > 12) {
      score -= 36;
    }
  }

  if (
    baseHotel.availabilityStatus !== "available" &&
    candidateHotel.availabilityStatus === "available"
  ) {
    score += 8;
  }

  return {
    score,
    tokenOverlap,
    addressOverlap,
    distanceKm,
    exactNameMatch,
    exactIdentityMatch,
  };
}

function isStrongHotelMatch(
  signal: ReturnType<typeof hotelMatchSignal>
) {
  if (signal.exactNameMatch || signal.exactIdentityMatch) return true;
  if (signal.tokenOverlap >= 2 && signal.addressOverlap >= 2) return true;
  if (
    signal.tokenOverlap >= 2 &&
    typeof signal.distanceKm === "number" &&
    signal.distanceKm <= 2
  ) {
    return true;
  }
  if (
    signal.addressOverlap >= 3 &&
    typeof signal.distanceKm === "number" &&
    signal.distanceKm <= 1
  ) {
    return true;
  }

  return signal.score >= 90;
}

function mergeHotelRecords(baseHotel: HotelOption, candidateHotel: HotelOption) {
  return {
    ...candidateHotel,
    ...baseHotel,
    name: baseHotel.name || candidateHotel.name,
    pricePerNight: candidateHotel.pricePerNight ?? baseHotel.pricePerNight,
    totalStayPrice: candidateHotel.totalStayPrice ?? baseHotel.totalStayPrice,
    pricingSource: candidateHotel.pricingSource ?? baseHotel.pricingSource,
    availabilityStatus:
      candidateHotel.availabilityStatus ?? baseHotel.availabilityStatus,
    availabilitySource:
      candidateHotel.availabilitySource ?? baseHotel.availabilitySource,
    hotelId: candidateHotel.hotelId ?? baseHotel.hotelId,
    destinationId: candidateHotel.destinationId ?? baseHotel.destinationId,
    bookingLink: candidateHotel.bookingLink || baseHotel.bookingLink,
    shortDescription:
      baseHotel.shortDescription || candidateHotel.shortDescription,
    rating: baseHotel.rating ?? candidateHotel.rating,
    photoRef: baseHotel.photoRef ?? candidateHotel.photoRef,
    photoUrl: baseHotel.photoUrl ?? candidateHotel.photoUrl,
    mapsUrl: baseHotel.mapsUrl ?? candidateHotel.mapsUrl,
    websiteUrl: baseHotel.websiteUrl ?? candidateHotel.websiteUrl,
    latitude: baseHotel.latitude ?? candidateHotel.latitude,
    longitude: baseHotel.longitude ?? candidateHotel.longitude,
  };
}

function mergeHotelCollections(
  baseHotels: HotelOption[],
  enrichmentHotels: HotelOption[]
) {
  const usedMatches = new Set<string>();

  const mergedBaseHotels = baseHotels.map((hotel) => {
    let bestMatch:
      | { hotel: HotelOption; score: number }
      | undefined;

    for (const candidateHotel of enrichmentHotels) {
      const candidateKey = hotelMatchKey(candidateHotel);
      if (usedMatches.has(candidateKey)) continue;

      const signal = hotelMatchSignal(hotel, candidateHotel);
      if (!isStrongHotelMatch(signal)) continue;

      if (!bestMatch || signal.score > bestMatch.score) {
        bestMatch = { hotel: candidateHotel, score: signal.score };
      }
    }

    if (!bestMatch) return hotel;

    usedMatches.add(hotelMatchKey(bestMatch.hotel));
    return mergeHotelRecords(hotel, bestMatch.hotel);
  });

  const unmatchedEnrichmentHotels = enrichmentHotels.filter(
    (hotel) => !usedMatches.has(hotelMatchKey(hotel))
  );

  return [...mergedBaseHotels, ...unmatchedEnrichmentHotels];
}

function dedupeHotelOptions(hotels: HotelOption[]) {
  const mergedByIdentity = new Map<string, HotelOption>();

  for (const hotel of hotels) {
    const key = hotelMatchKey(hotel);
    if (!key) continue;

    const existing = mergedByIdentity.get(key);
    if (!existing) {
      mergedByIdentity.set(key, hotel);
      continue;
    }

    mergedByIdentity.set(key, mergeHotelRecords(existing, hotel));
  }

  return Array.from(mergedByIdentity.values());
}

async function fetchSerpApiHotelInventory(options: {
  destination: string;
  tripStartDate?: string;
  tripEndDate?: string;
  adults: number;
}) {
  if (!options.tripStartDate || !options.tripEndDate) {
    return [];
  }

  try {
    return await searchHotelsWithSerpApi({
      destination: options.destination,
      tripStartDate: options.tripStartDate,
      tripEndDate: options.tripEndDate,
      adults: options.adults,
    });
  } catch (error) {
    reportProviderEvent({
      provider: "serpapi",
      operation: "hotel_search",
      outcome: "live_unavailable",
      destination: options.destination,
      detail:
        "SerpApi hotel availability lookup failed. Falling back to other hotel sources.",
      error,
    });
    return [];
  }
}

function createEnrichCacheKey(trip: RankedDestination, input: TripInput) {
  return JSON.stringify({
    name: trip.name,
    province: trip.province,
    startCity: input.startCity,
    style: input.style,
    tripPrompt: input.tripPrompt,
    veganFriendly: input.veganFriendly,
    tripStartDate: input.tripStartDate,
    tripEndDate: input.tripEndDate,
    travelerCount: input.travelerCount,
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

function deriveProviderOutcome(options: {
  hadResults: boolean;
  attempted: boolean;
  usedFallback: boolean;
}) {
  if (options.hadResults) return "live_success" as const;
  if (options.attempted) return "live_unavailable" as const;
  if (options.usedFallback) return "fallback_used" as const;
  return "fallback_used" as const;
}

function evaluateLivePromptFit(
  activities: Array<{ name?: string; type?: string; shortDescription?: string }>,
  foods: Array<{ name?: string; category?: string; shortDescription?: string; tags?: string[] }>,
  input: TripInput
) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const warnings: string[] = [];
  const rankingReasons: RankingReason[] = [];
  let scoreAdjustment = 0;

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    const strongSummitMatches = activities.filter((activity) =>
      normalizeText(
        [activity.name, activity.type, activity.shortDescription].join(" ")
      ).match(/\b(summit|peak|ridge|scramble|alpine|mountain)\b/)
    ).length;
    const scenicHikeMatches = activities.filter((activity) => {
      const text = normalizeText(
        [activity.name, activity.type, activity.shortDescription].join(" ")
      );

      return (
        ["trail", "hike", "loop", "backcountry"].some((term) =>
          text.includes(term)
        ) &&
        ["view", "lookout", "viewpoint", "scenic", "mountain", "lake"].some(
          (term) => text.includes(term)
        )
      );
    }).length;

    if (strongSummitMatches >= 1) {
      scoreAdjustment += 12;
      rankingReasons.push({
        label: "Live options include a stronger summit-hike anchor",
        impact: "positive",
      });
    } else if (scenicHikeMatches >= 1) {
      scoreAdjustment += 4;
      rankingReasons.push({
        label: "Live options show a more specific scenic hike",
        impact: "positive",
      });
    } else {
      scoreAdjustment -= 14;
      warnings.push("Live results did not surface a convincing summit-hike anchor");
      rankingReasons.push({
        label: "Live options still miss the summit-hike brief",
        impact: "negative",
      });
    }
  }

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    const vegetarianFriendlyFoods = foods.filter((food) => {
      const text = normalizeText(
        [food.name, food.category, food.shortDescription, ...(food.tags ?? [])].join(" ")
      );

      return [
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
      ].some((term) => text.includes(term));
    }).length;

    if (vegetarianFriendlyFoods >= 1) {
      scoreAdjustment += 8;
      rankingReasons.push({
        label: "Live food picks support the dietary constraint better",
        impact: "positive",
      });
    } else if (foods.length === 0) {
      scoreAdjustment -= 6;
      warnings.push("Live food results are too thin to confirm vegetarian support");
    }
  }

  return {
    scoreAdjustment,
    warnings,
    rankingReasons,
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
  const hotelDestinationQuery = `${trip.homeBaseCity || trip.name}, ${trip.province}`;
  const sourceCheckedAt = new Date().toISOString();

  try {
    const locationContext = destinationLocationContext(trip);
    const [placesData, hotelsDotComHotels, serpApiHotels] =
      await Promise.all([
        fetchPlacesProviderData({
          destination: destinationQuery,
          style: input.style,
          activityFocus: input.activityFocus,
          veganFriendly: input.veganFriendly,
          tripPrompt: input.tripPrompt,
          tripStartDate: input.tripStartDate,
          tripEndDate: input.tripEndDate,
        }),
        fetchHotelsDotComHotelData({
          destination: hotelDestinationQuery,
          tripStartDate: input.tripStartDate,
          tripEndDate: input.tripEndDate,
          adults: input.travelerCount,
        }),
        fetchSerpApiHotelInventory({
          destination: hotelDestinationQuery,
          tripStartDate: input.tripStartDate,
          tripEndDate: input.tripEndDate,
          adults: input.travelerCount,
        }),
      ]);

    const liveRestaurants = dedupeByName(
      rankPlaces(placesData.restaurants, trip, "food", input)
        .map(mapGooglePlaceToFoodSpot)
        .filter(hasName)
    );

    const liveCafes = dedupeByName(
      rankPlaces(placesData.cafes, trip, "food", input)
        .map(mapGooglePlaceToFoodSpot)
        .filter(hasName)
    );

    const liveActivities = dedupeByName(
      rankPlaces(placesData.activities, trip, "activity", input)
        .map(mapGooglePlaceToActivity)
        .filter(hasName)
    );

    const staticHotels = dedupeHotelOptions(
      sortHotelOptions((trip.hotelOptions ?? []).filter(hasName))
    );

    const providerInventoryHotels = dedupeHotelOptions([
      ...hotelsDotComHotels.filter(hasName),
      ...serpApiHotels.filter(hasName),
    ]);

    const locationMatchedProviderHotels = providerInventoryHotels.filter(
      (hotel) => hasStrongLocationMatch(hotelSearchText(hotel), locationContext)
    );

    const placesHotels = dedupeByName(
      rankPlaces(placesData.hotels, trip, "hotel", input)
        .map(mapGooglePlaceToHotel)
        .filter(hasName)
    );

    const baseHotels = dedupeHotelOptions(
      mergeHotelCollections(
        placesHotels.length > 0 ? placesHotels : staticHotels,
        staticHotels
      )
    );

    const inventoryHotels = sortHotelOptions(
      locationMatchedProviderHotels.length > 0
        ? locationMatchedProviderHotels
        : providerInventoryHotels
    );
    const liveHotels = sortHotelOptions(
      dedupeHotelOptions(
        inventoryHotels.length > 0
          ? mergeHotelCollections(baseHotels, inventoryHotels)
          : baseHotels
      )
    );

    const balancedFoodSpots = dedupeByName(
      interleaveArrays(liveRestaurants, liveCafes)
    );

    const mergedFoodSpots =
      balancedFoodSpots.length > 0
        ? balancedFoodSpots.slice(0, 12)
        : trip.foodSpots;

    const mergedActivities =
      liveActivities.length > 0
        ? deriveTripIntentFromPrompt(input.tripPrompt).hardConstraints.activityAnchor ===
          "summit_hike"
          ? mergeNamedPlaces(
              liveActivities,
              (trip.topActivities ?? []).filter(hasName),
              12
            )
          : liveActivities.slice(0, 12)
        : trip.topActivities;

    const mergedHotels =
      liveHotels.length > 0
        ? liveHotels.slice(0, 6)
        : sortHotelOptions(trip.hotelOptions ?? []);

    const hasLiveResults =
      balancedFoodSpots.length > 0 ||
      liveActivities.length > 0 ||
      liveHotels.length > 0;
    const providerStatus = {
      places: deriveProviderOutcome({
        hadResults:
          balancedFoodSpots.length > 0 ||
          liveActivities.length > 0 ||
          placesHotels.length > 0,
        attempted: true,
        usedFallback:
          balancedFoodSpots.length === 0 &&
          liveActivities.length === 0 &&
          placesHotels.length === 0,
      }),
      hotels: deriveProviderOutcome({
        hadResults: inventoryHotels.length > 0,
        attempted: Boolean(input.tripStartDate && input.tripEndDate),
        usedFallback: liveHotels.length === 0 || inventoryHotels.length === 0,
      }),
      tripCopy: trip.providerStatus?.tripCopy,
    };

    const source: TripDataSource = hasLiveResults
      ? "live-google-places"
      : "static-fallback";

    const liveDataSummary = buildLiveSummary(
      balancedFoodSpots as Array<{ rating?: number }>,
      liveActivities as Array<{ rating?: number }>,
      liveHotels as Array<{ rating?: number }>,
      hasLiveResults
    );
    const promptFit = evaluateLivePromptFit(
      mergedActivities,
      mergedFoodSpots,
      input
    );

    const rankingReasons: RankingReason[] = Array.isArray(trip.rankingReasons)
      ? [...trip.rankingReasons]
      : [];
    const warnings = Array.isArray(trip.warnings) ? [...trip.warnings] : [];

    if (inventoryHotels.length > 0) {
      rankingReasons.unshift({
        label: "Hotels checked against live booking inventory",
        impact: "positive",
      });
    } else if (input.tripStartDate && input.tripEndDate) {
      rankingReasons.unshift({
        label: "Hotel availability could not be confirmed live",
        impact: "neutral",
      });
    }

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

    if (promptFit.rankingReasons.length > 0) {
      rankingReasons.unshift(...promptFit.rankingReasons);
    }

    if (promptFit.warnings.length > 0) {
      warnings.unshift(...promptFit.warnings);
    }

    const mergedTrip: RankedDestination = {
      ...trip,
      score: Math.round((trip.score + promptFit.scoreAdjustment) * 100) / 100,
      foodSpots: mergedFoodSpots,
      topActivities: mergedActivities,
      hotelOptions: mergedHotels as HotelOption[],
      liveDataSummary,
      sourceCheckedAt,
      providerStatus,
      warnings: Array.from(new Set(warnings)),
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
    reportProviderEvent({
      provider: "trip_enrichment",
      operation: "enrich_ranked_trip",
      outcome: "live_unavailable",
      destination: destinationQuery,
      detail: "Places enrichment failed. Using static trip fallback data.",
      error,
    });

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
        hotelOptions: sortHotelOptions(trip.hotelOptions ?? []),
        liveDataSummary: buildLiveSummary(
          trip.foodSpots,
          trip.topActivities,
          sortHotelOptions(trip.hotelOptions ?? []),
          false
        ),
        sourceCheckedAt,
        providerStatus: {
          places: "live_unavailable",
          hotels:
            input.tripStartDate && input.tripEndDate
              ? "live_unavailable"
              : "fallback_used",
          tripCopy: trip.providerStatus?.tripCopy,
        },
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
