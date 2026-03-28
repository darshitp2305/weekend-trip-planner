import { isIsoDate } from "./tripDates";
import { HotelOption } from "./types";
import { sanitizeExternalNavigationUrl } from "./urlSafety";

type ExpediaStayLinkOptions = {
  hotel?: Pick<HotelOption, "name"> &
    Partial<Pick<HotelOption, "websiteUrl" | "bookingLink" | "mapsUrl">>;
  destination?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  travelerCount?: number;
};

function cleanUrl(value?: string) {
  return sanitizeExternalNavigationUrl(value);
}

function toCanadianExpediaUrl(value?: string) {
  const cleaned = cleanUrl(value);
  if (!cleaned) return undefined;

  try {
    const url = new URL(cleaned);
    if (!/(^|\.)expedia\.[a-z.]+$/i.test(url.hostname)) {
      return cleaned;
    }

    url.hostname = "www.expedia.ca";
    url.searchParams.set("currency", "CAD");

    return url.toString();
  } catch {
    return cleaned;
  }
}

export function directHotelPropertyUrl(options: ExpediaStayLinkOptions) {
  const cleanedBooking = toCanadianExpediaUrl(options.hotel?.bookingLink);
  const cleanedWebsite = toCanadianExpediaUrl(options.hotel?.websiteUrl);

  return cleanedBooking ?? cleanedWebsite;
}

function isExpediaUrl(value?: string) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return /(^|\.)expedia\.[a-z.]+$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function directExpediaPropertyUrl(options: ExpediaStayLinkOptions) {
  const directUrl = directHotelPropertyUrl(options);
  return isExpediaUrl(directUrl) ? directUrl : undefined;
}

export function buildExpediaHotelSearchUrl({
  hotel,
  destination,
  tripStartDate,
  tripEndDate,
  travelerCount,
}: ExpediaStayLinkOptions) {
  const url = new URL("https://www.expedia.ca/Hotel-Search");
  const destinationQuery = [hotel?.name, destination].filter(Boolean).join(", ").trim();

  if (destinationQuery) {
    url.searchParams.set("destination", destinationQuery);
  } else if (destination) {
    url.searchParams.set("destination", destination);
  }

  if (isIsoDate(tripStartDate)) {
    url.searchParams.set("startDate", tripStartDate);
  }

  if (isIsoDate(tripEndDate)) {
    url.searchParams.set("endDate", tripEndDate);
  }

  url.searchParams.set("rooms", "1");
  url.searchParams.set("adults", String(Math.max(1, travelerCount ?? 2)));
  url.searchParams.set("currency", "CAD");

  return url.toString();
}

export function preferredHotelBookingUrl(options: ExpediaStayLinkOptions) {
  const directHotelUrl = directHotelPropertyUrl(options);
  const cleanedMaps = cleanUrl(options.hotel?.mapsUrl);

  return (
    directHotelUrl ??
    buildExpediaHotelSearchUrl(options) ??
    cleanedMaps
  );
}
