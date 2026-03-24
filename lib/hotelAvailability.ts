import { HotelOption } from "./types";

type HotelAvailabilityStatus = NonNullable<HotelOption["availabilityStatus"]>;

const availabilityPriority: Record<HotelAvailabilityStatus, number> = {
  available: 3,
  unverified: 2,
  sold_out: 1,
};

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

export function sortHotelOptions<T extends Pick<
  HotelOption,
  "name" | "availabilityStatus" | "pricePerNight" | "totalStayPrice" | "rating"
>>(hotels: T[]) {
  return [...hotels].sort((a, b) => {
    const availabilityDiff =
      hotelAvailabilityPriorityFor(b.availabilityStatus) -
      hotelAvailabilityPriorityFor(a.availabilityStatus);
    if (availabilityDiff !== 0) return availabilityDiff;

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

    const aComparablePrice =
      typeof a.totalStayPrice === "number"
        ? a.totalStayPrice
        : typeof a.pricePerNight === "number"
          ? a.pricePerNight
          : Number.POSITIVE_INFINITY;
    const bComparablePrice =
      typeof b.totalStayPrice === "number"
        ? b.totalStayPrice
        : typeof b.pricePerNight === "number"
          ? b.pricePerNight
          : Number.POSITIVE_INFINITY;
    if (aComparablePrice !== bComparablePrice) {
      return aComparablePrice - bComparablePrice;
    }

    return a.name.localeCompare(b.name);
  });
}
