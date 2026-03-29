/**
 * Helper module for serp api hotel provider concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  searchHotelsWithSerpApi,
} from "./serpApiHotels";
import { reportProviderEvent } from "./providerTelemetry";
import { HotelOption } from "./types";

export async function fetchSerpApiHotelData(options: {
  destination: string;
  tripStartDate?: string;
  tripEndDate?: string;
  adults: number;
}): Promise<HotelOption[]> {
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
      detail: "Hotel rate lookup failed. Falling back to Places-derived hotel data.",
      error,
    });
    return [];
  }
}
