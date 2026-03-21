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

export async function searchRestaurants(
  destination: string,
  options?: FoodSearchOptions
) {
  const textQuery = options?.veganFriendly
    ? `best vegan and vegetarian restaurants in ${destination}`
    : `best restaurants in ${destination}`;

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery,
      maxResultCount: 10,
    },
    FIELD_MASK
  );
}

export async function searchCafes(destination: string, options?: FoodSearchOptions) {
  const textQuery = options?.veganFriendly
    ? `best vegan cafes, plant-based brunch, and coffee shops in ${destination}`
    : `best cafes and coffee shops in ${destination}`;

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery,
      maxResultCount: 8,
    },
    FIELD_MASK
  );
}

export async function searchActivities(destination: string, style: string) {
  const normalizedStyle = style.trim().toLowerCase();
  const styleQuery =
    normalizedStyle === "foodie"
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
                : `${style} attractions`;

  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `top ${styleQuery} in ${destination}`,
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
