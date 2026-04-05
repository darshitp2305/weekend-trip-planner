/**
 * Helper module for hotel availability concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import { HotelOption } from "./types";

type HotelAvailabilityStatus = NonNullable<HotelOption["availabilityStatus"]>;

const availabilityPriority: Record<HotelAvailabilityStatus, number> = {
  available: 3,
  unverified: 2,
  sold_out: 1,
};

function hotelPricingSignals(
  hotel: Pick<HotelOption, "name" | "shortDescription" | "rating">
) {
  const text = `${hotel.name ?? ""} ${hotel.shortDescription ?? ""}`.toLowerCase();

  return {
    luxury:
      /\b(fairmont|gold experience|luxury|premium|five star|5 star|spa resort|residence club|castle|chateau)\b/.test(
        text
      ) ||
      (/\b(resort|spa|boutique|experience)\b/.test(text) &&
        (hotel.rating ?? 0) >= 4.5),
    value:
      /\b(hostel|motel|motor inn|budget|affordable|value stay)\b/.test(text) ||
      /\b(inn|lodge|guesthouse|basecamp|suites)\b/.test(text),
  };
}

export function hotelAvailabilityPriorityFor(
  status?: HotelOption["availabilityStatus"]
) {
  if (!status) return availabilityPriority.unverified;
  return availabilityPriority[status];
}

export function hotelAvailabilityLabel(
  hotel: Pick<HotelOption, "availabilityStatus">,
  hasDates = false
) {
  switch (hotel.availabilityStatus) {
    case "available":
      return hasDates ? "Available for your dates" : "Availability confirmed";
    case "sold_out":
      return hasDates ? "Sold out for your dates" : "Sold out";
    default:
      return hasDates ? "Availability unverified" : "Availability unknown";
  }
}

export function hotelAvailabilityTone(
  status?: HotelOption["availabilityStatus"]
) {
  switch (status) {
    case "available":
      return "green" as const;
    case "sold_out":
      return "rose" as const;
    default:
      return "amber" as const;
  }
}

export function estimatedHotelStayCost(
  hotel: Pick<
    HotelOption,
    "name" | "shortDescription" | "pricePerNight" | "totalStayPrice" | "rating"
  >,
  options?: {
    nights?: number;
    fallbackTotalStayCost?: number;
  }
) {
  const nights =
    typeof options?.nights === "number" &&
    Number.isFinite(options.nights) &&
    options.nights > 0
      ? Math.round(options.nights)
      : 1;

  if (typeof hotel.totalStayPrice === "number" && hotel.totalStayPrice > 0) {
    return hotel.totalStayPrice;
  }

  if (typeof hotel.pricePerNight === "number" && hotel.pricePerNight > 0) {
    return hotel.pricePerNight * nights;
  }

  const fallbackTotalStayCost =
    typeof options?.fallbackTotalStayCost === "number" &&
    Number.isFinite(options.fallbackTotalStayCost) &&
    options.fallbackTotalStayCost > 0
      ? options.fallbackTotalStayCost
      : 180 * nights;
  const signals = hotelPricingSignals(hotel);
  let multiplier = 1;

  if (signals.luxury) {
    multiplier += 0.95;
  } else if ((hotel.rating ?? 0) >= 4.7) {
    multiplier += 0.2;
  } else if ((hotel.rating ?? 0) >= 4.4) {
    multiplier += 0.08;
  }

  if (signals.value) {
    multiplier -= 0.18;
  }

  const estimatedCost = fallbackTotalStayCost * multiplier;

  return Math.round(
    Math.min(
      Math.max(estimatedCost, fallbackTotalStayCost * 0.72),
      fallbackTotalStayCost * 2.6
    )
  );
}

export function sortHotelOptions<T extends Pick<
  HotelOption,
  | "name"
  | "shortDescription"
  | "availabilityStatus"
  | "pricePerNight"
  | "totalStayPrice"
  | "rating"
>>(
  hotels: T[],
  options?: { nights?: number; fallbackTotalStayCost?: number }
) {
  return [...hotels].sort((a, b) => {
    const availabilityDiff =
      hotelAvailabilityPriorityFor(b.availabilityStatus) -
      hotelAvailabilityPriorityFor(a.availabilityStatus);
    if (availabilityDiff !== 0) return availabilityDiff;

    const aComparablePrice = estimatedHotelStayCost(a, options);
    const bComparablePrice = estimatedHotelStayCost(b, options);
    if (aComparablePrice !== bComparablePrice) {
      return aComparablePrice - bComparablePrice;
    }

    const pricedDiff =
      Number(
        typeof b.pricePerNight === "number" || typeof b.totalStayPrice === "number"
      ) -
      Number(
        typeof a.pricePerNight === "number" || typeof a.totalStayPrice === "number"
    );
    if (pricedDiff !== 0) return pricedDiff;

    const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingDiff !== 0) return ratingDiff;

    return a.name.localeCompare(b.name);
  });
}
