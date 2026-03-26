import type {
  PromptHardConstraints,
  PromptSoftPreferences,
} from "./tripIntent";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 1000 * 60 * 30;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const textSearchCache = new Map<string, CacheEntry>();

type TextSearchRequest = {
  textQuery: string;
  maxResultCount?: number;
};

function getGoogleMapsApiKey() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY in .env.local");
  }

  return apiKey;
}

async function placesTextSearch<T>(
  body: TextSearchRequest,
  fieldMask: string
): Promise<T> {
  const apiKey = getGoogleMapsApiKey();

  const cacheKey = JSON.stringify({ body, fieldMask });
  const cached = textSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Google Places Text Search timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places Text Search failed: ${res.status} ${text}`);
  }

  const parsed = (await res.json()) as T;
  textSearchCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: parsed,
  });

  return parsed;
}

export type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
  priceLevel?: string;
  userRatingCount?: number;
  photos?: Array<{
    name?: string;
  }>;
};

type HotelSearchOptions = {
  tripStartDate?: string;
  tripEndDate?: string;
};

type FoodSearchOptions = {
  veganFriendly?: boolean;
  requiresVegetarianOptions?: boolean;
  mixedDietGroup?: boolean;
  wantsGoodFood?: boolean;
};

type ActivitySearchOptions = {
  activityFocus?: "skiing" | "hiking" | "camping";
  hardConstraints?: PromptHardConstraints;
  softPreferences?: PromptSoftPreferences;
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryType",
  "places.priceLevel",
  "places.photos.name",
].join(",");

export function buildRestaurantTextQuery(
  destination: string,
  options?: FoodSearchOptions
) {
  if (options?.requiresVegetarianOptions) {
    const mixedGroupContext = options.mixedDietGroup
      ? "vegetarian-friendly restaurants for mixed groups"
      : options.veganFriendly
        ? "vegan and vegetarian restaurants"
        : "vegetarian-friendly restaurants";
    const qualityContext = options.wantsGoodFood ? " and good dinner spots" : "";

    return `best ${mixedGroupContext}${qualityContext} in ${destination}`;
  }

  if (options?.wantsGoodFood) {
    return `best restaurants and dinner spots in ${destination}`;
  }

  return options?.veganFriendly
    ? `best vegan and vegetarian restaurants in ${destination}`
    : `best restaurants in ${destination}`;
}

export async function searchRestaurants(
  destination: string,
  options?: FoodSearchOptions
) {
  const textQuery = buildRestaurantTextQuery(destination, options);

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery,
      maxResultCount: 10,
    },
    FIELD_MASK
  );
}

export function buildCafeTextQuery(
  destination: string,
  options?: FoodSearchOptions
) {
  if (options?.requiresVegetarianOptions) {
    const plantForwardContext = options.veganFriendly
      ? "vegan cafes, plant-based brunch, and vegetarian-friendly coffee shops"
      : "vegetarian-friendly cafes, brunch spots, and coffee shops";

    return `best ${plantForwardContext} in ${destination}`;
  }

  return options?.veganFriendly
    ? `best vegan cafes, plant-based brunch, and coffee shops in ${destination}`
    : `best cafes and coffee shops in ${destination}`;
}

export async function searchCafes(destination: string, options?: FoodSearchOptions) {
  const textQuery = buildCafeTextQuery(destination, options);

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery,
      maxResultCount: 8,
    },
    FIELD_MASK
  );
}

export function buildActivityTextQuery(
  destination: string,
  style: string,
  options?: ActivitySearchOptions
) {
  const activityFocus = options?.activityFocus;
  const hardConstraints = options?.hardConstraints;
  const softPreferences = options?.softPreferences;
  const normalizedStyle = style.trim().toLowerCase();

  if (activityFocus === "hiking" && hardConstraints?.activityAnchor === "summit_hike") {
    const distanceContext = hardConstraints.hikeDistanceKmTarget
      ? ` around ${Math.round(hardConstraints.hikeDistanceKmTarget)} km round trip`
      : "";
    const scenicContext = hardConstraints.requiresScenicView
      ? " with mountain views and scenic lookouts"
      : "";

    return `best summit hikes, peak trails, and mountain ridge walks${distanceContext}${scenicContext} in ${destination}`;
  }

  if (activityFocus === "camping" && hardConstraints?.activityAnchor === "campground_base") {
    const scenicContext = hardConstraints.requiresScenicView
      ? " with scenic views"
      : "";

    return `best campgrounds, campsites, and outdoor basecamps${scenicContext} in ${destination}`;
  }

  const activityFocusQuery =
    activityFocus === "skiing"
      ? "ski hills, ski resorts, nordic skiing, winter lookouts"
      : activityFocus === "hiking"
        ? hardConstraints?.requiresScenicView
          ? "scenic hiking trails, lookouts, mountain walks, lakes, and canyons"
          : "hiking trails, lakes, canyons, ridge walks, and scenic lookouts"
        : activityFocus === "camping"
          ? "campgrounds, campsites, provincial parks, outdoor bases"
          : null;
  const styleQuery =
    activityFocusQuery ??
    (normalizedStyle === "foodie"
      ? "food tours, markets, cooking classes, scenic walks"
      : normalizedStyle === "adventure"
        ? "hikes, lakes, viewpoints, outdoor adventure"
        : normalizedStyle === "outdoors"
          ? "trails, lakes, parks, scenic lookouts"
          : normalizedStyle === "chill"
            ? "scenic spots, spas, easy walks, relaxing attractions"
            : normalizedStyle === "solo reset"
              ? "quiet cafes, scenic spots, spas, easy walks"
              : normalizedStyle === "hidden gems"
                ? "local landmarks, heritage sites, lookouts, lesser-known attractions"
              : `${style} attractions`);

  if (softPreferences?.wantsScenery && activityFocus !== "hiking") {
    return `top ${styleQuery} with scenic views in ${destination}`;
  }

  return `top ${styleQuery} in ${destination}`;
}

export async function searchActivities(
  destination: string,
  style: string,
  options?: ActivitySearchOptions
) {
  const textQuery = buildActivityTextQuery(destination, style, options);

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery,
      maxResultCount: 12,
    },
    FIELD_MASK
  );
}

export async function searchHotels(
  destination: string,
  options?: HotelSearchOptions
) {
  const dateContext =
    options?.tripStartDate && options?.tripEndDate
      ? ` from ${options.tripStartDate} to ${options.tripEndDate}`
      : "";

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `best hotels in ${destination}${dateContext}`,
      maxResultCount: 8,
    },
    FIELD_MASK
  );
}
