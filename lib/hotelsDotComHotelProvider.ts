import { HotelOption } from "./types";
import { reportProviderEvent } from "./providerTelemetry";

const HOTELS_DOT_COM_HOST = "hotels4.p.rapidapi.com";
const HOTELS_DOT_COM_BASE_URL = `https://${HOTELS_DOT_COM_HOST}`;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 1000 * 60 * 30;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const providerCache = new Map<string, CacheEntry>();

type DestinationEntity = {
  destinationId?: string;
  type?: string;
};

type DestinationSearchResponse = {
  suggestions?: Array<{
    entities?: DestinationEntity[];
  }>;
};

type HotelListResult = {
  id?: number | string;
  name?: string;
  optimizedThumbUrls?: {
    srpDesktop?: string;
  };
  guestReviews?: {
    rating?: string | number;
  };
  coordinate?: {
    lat?: number;
    lon?: number;
  };
  address?: {
    streetAddress?: string;
    locality?: string;
    region?: string;
    countryName?: string;
  };
  landmarks?: Array<{
    label?: string;
    distance?: string;
  }>;
  ratePlan?: {
    price?: {
      exactCurrent?: number;
    };
  };
};

type HotelListResponse = {
  data?: {
    body?: {
      searchResults?: {
        results?: HotelListResult[];
      };
    };
  };
};

function getHotelsDotComApiKey() {
  const apiKey = process.env.HOTELS_DOT_COM_KEY;

  if (!apiKey) {
    throw new Error("Missing HOTELS_DOT_COM_KEY in .env.local");
  }

  return apiKey;
}

async function requestHotelsDotCom<T>(pathWithQuery: string): Promise<T | null> {
  const cached = providerCache.get(pathWithQuery);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const apiKey = getHotelsDotComApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${HOTELS_DOT_COM_BASE_URL}${pathWithQuery}`, {
      cache: "no-store",
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": HOTELS_DOT_COM_HOST,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Hotels.com RapidAPI timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Hotels.com RapidAPI request failed: ${response.status} ${text}`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const parsed = (await response.json()) as T;
  providerCache.set(pathWithQuery, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: parsed,
  });

  return parsed;
}

function destinationPriority(entity: DestinationEntity) {
  switch ((entity.type ?? "").toUpperCase()) {
    case "CITY":
      return 4;
    case "NEIGHBORHOOD":
      return 3;
    case "LANDMARK":
      return 2;
    case "HOTEL":
      return 1;
    default:
      return 0;
  }
}

async function findDestinationId(destination: string) {
  const response = await requestHotelsDotCom<DestinationSearchResponse>(
    `/locations/v2/search?query=${encodeURIComponent(
      destination
    )}&locale=en_US&currency=CAD`
  );

  return (response?.suggestions ?? [])
    .flatMap((group) => group.entities ?? [])
    .filter((entity) => Boolean(entity.destinationId))
    .sort((a, b) => destinationPriority(b) - destinationPriority(a))[0]
    ?.destinationId;
}

function toNumber(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildHotelDescription(result: HotelListResult) {
  const address = [
    result.address?.streetAddress,
    result.address?.locality,
    result.address?.region,
    result.address?.countryName,
  ]
    .filter(Boolean)
    .join(", ");

  if (address) return address;

  const landmark = result.landmarks?.[0];
  if (landmark?.label && landmark.distance) {
    return `${landmark.distance} from ${landmark.label}`;
  }

  return "Hotels.com availability-checked result.";
}

export async function fetchHotelsDotComHotelData(options: {
  destination: string;
  tripStartDate?: string;
  tripEndDate?: string;
  adults: number;
}): Promise<HotelOption[]> {
  if (!options.tripStartDate || !options.tripEndDate) {
    return [];
  }

  try {
    const destinationId = await findDestinationId(options.destination);
    if (!destinationId) {
      return [];
    }

    const query = new URLSearchParams({
      destinationId,
      pageNumber: "1",
      pageSize: "25",
      checkIn: options.tripStartDate,
      checkOut: options.tripEndDate,
      adults1: String(Math.max(1, options.adults)),
      sortOrder: "PRICE",
      locale: "en_US",
      currency: "CAD",
    });
    const response = await requestHotelsDotCom<HotelListResponse>(
      `/properties/list?${query.toString()}`
    );

    const results = response?.data?.body?.searchResults?.results ?? [];
    return results
      .map((result) => ({
        name: result.name ?? "",
        hotelId:
          typeof result.id === "number" || typeof result.id === "string"
            ? String(result.id)
            : undefined,
        destinationId,
        pricePerNight: result.ratePlan?.price?.exactCurrent,
        pricingSource: "Hotels.com live rate" as const,
        availabilityStatus: "available" as const,
        availabilitySource: "Hotels.com via RapidAPI",
        bookingLink: "",
        shortDescription: buildHotelDescription(result),
        rating: toNumber(result.guestReviews?.rating),
        photoUrl: result.optimizedThumbUrls?.srpDesktop,
        latitude: result.coordinate?.lat,
        longitude: result.coordinate?.lon,
      }))
      .filter(
        (hotel) =>
          Boolean(hotel.name) && typeof hotel.pricePerNight === "number"
      )
      .slice(0, 8);
  } catch (error) {
    reportProviderEvent({
      provider: "hotels_dot_com",
      operation: "hotel_search",
      outcome: "live_unavailable",
      destination: options.destination,
      detail:
        "Hotels.com availability lookup failed. Falling back to other hotel sources.",
      error,
    });
    return [];
  }
}
