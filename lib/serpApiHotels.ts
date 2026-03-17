const SERPAPI_BASE_URL = "https://serpapi.com/search.json";

type SearchHotelsOptions = {
  destination: string;
  tripStartDate: string;
  tripEndDate: string;
  adults?: number;
};

type SerpApiPrice = {
  extracted_before_taxes_fees?: number;
  extracted_lowest?: number;
  extracted_rate?: number;
  extracted_total_rate?: number;
  before_taxes_fees?: string;
  lowest?: string;
  rate_per_night?: string;
  total_rate?: string;
};

type SerpApiHotelResult = {
  name?: string;
  description?: string;
  link?: string;
  source?: string;
  overall_rating?: number;
  rating?: number;
  type?: string;
  gps_coordinates?: {
    latitude?: number;
    longitude?: number;
  };
  prices?: SerpApiPrice[];
  rate_per_night?: {
    lowest?: string;
    extracted_lowest?: number;
    before_taxes_fees?: string;
    extracted_before_taxes_fees?: number;
  };
  total_rate?: {
    lowest?: string;
    extracted_lowest?: number;
    before_taxes_fees?: string;
    extracted_before_taxes_fees?: number;
  };
  price?: string;
  extracted_price?: number;
  images?: Array<{
    thumbnail?: string;
    original_image?: string;
  }>;
};

type SerpApiHotelsResponse = {
  ads?: SerpApiHotelResult[];
  properties?: SerpApiHotelResult[];
  hotel_results?: SerpApiHotelResult[];
};

export type LiveHotelRate = {
  name: string;
  bookingLink: string;
  rating?: number;
  shortDescription?: string;
  pricePerNight?: number;
  totalStayPrice?: number;
  pricingSource: "SerpApi Google Hotels";
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
};

function numericRateFromPrice(price?: SerpApiPrice): number | undefined {
  if (!price) return undefined;

  return (
    price.extracted_rate ??
    price.extracted_lowest ??
    price.extracted_before_taxes_fees
  );
}

function numericTotalFromPrice(price?: SerpApiPrice): number | undefined {
  if (!price) return undefined;

  return price.extracted_total_rate;
}

function pickBestPrice(result: SerpApiHotelResult): {
  nightly?: number;
  total?: number;
} {
  const firstPrice = Array.isArray(result.prices) ? result.prices[0] : undefined;
  const nightly =
    result.rate_per_night?.extracted_lowest ??
    result.rate_per_night?.extracted_before_taxes_fees ??
    result.extracted_price ??
    numericRateFromPrice(firstPrice);
  const total =
    result.total_rate?.extracted_lowest ??
    result.total_rate?.extracted_before_taxes_fees ??
    numericTotalFromPrice(firstPrice);

  return { nightly, total };
}

export async function searchHotelsWithSerpApi(
  options: SearchHotelsOptions
): Promise<LiveHotelRate[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SERPAPI_API_KEY in .env.local");
  }

  const url = new URL(SERPAPI_BASE_URL);
  url.searchParams.set("engine", "google_hotels");
  url.searchParams.set("q", options.destination);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "ca");
  url.searchParams.set("currency", "CAD");
  url.searchParams.set("check_in_date", options.tripStartDate);
  url.searchParams.set("check_out_date", options.tripEndDate);
  url.searchParams.set("adults", String(Math.max(1, options.adults ?? 2)));
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SerpApi hotel search failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as SerpApiHotelsResponse;
  const rawResults = [
    ...(data.ads ?? []),
    ...(data.properties ?? []),
    ...(data.hotel_results ?? []),
  ];

  return rawResults
    .map((result) => {
      const { nightly, total } = pickBestPrice(result);

      return {
        name: result.name ?? "",
        bookingLink: result.link ?? "",
        rating: result.overall_rating ?? result.rating,
        shortDescription: result.description,
        pricePerNight: nightly,
        totalStayPrice: total,
        pricingSource: "SerpApi Google Hotels" as const,
        photoUrl:
          result.images?.[0]?.original_image || result.images?.[0]?.thumbnail,
        latitude: result.gps_coordinates?.latitude,
        longitude: result.gps_coordinates?.longitude,
      };
    })
    .filter((hotel) => Boolean(hotel.name))
    .slice(0, 8);
}
