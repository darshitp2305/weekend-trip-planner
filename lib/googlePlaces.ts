const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

type TextSearchRequest = {
  textQuery: string;
  maxResultCount?: number;
};

async function placesTextSearch<T>(
  body: TextSearchRequest,
  fieldMask: string
): Promise<T> {
  if (!API_KEY) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY in .env.local");
  }

  const res = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places Text Search failed: ${res.status} ${text}`);
  }

  return res.json();
}

export type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
  priceLevel?: string;
  userRatingCount?: number;
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.primaryType",
  "places.priceLevel",
].join(",");

export async function searchRestaurants(destination: string) {
  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `best restaurants in ${destination}`,
      maxResultCount: 10,
    },
    FIELD_MASK
  );
}

export async function searchCafes(destination: string) {
  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `best cafes and coffee shops in ${destination}`,
      maxResultCount: 8,
    },
    FIELD_MASK
  );
}

export async function searchActivities(destination: string, style: string) {
  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `top attractions and activities in ${destination} for ${style} travelers`,
      maxResultCount: 12,
    },
    FIELD_MASK
  );
}

export async function searchHotels(destination: string) {
  return placesTextSearch<{ places?: GooglePlace[] }>(
    {
      textQuery: `best hotels in ${destination}`,
      maxResultCount: 8,
    },
    FIELD_MASK
  );
}