import { isIsoDate } from "./tripDates";
import { HotelOption } from "./types";

type ExpediaStayLinkOptions = {
  hotel?: Pick<HotelOption, "name"> &
    Partial<Pick<HotelOption, "websiteUrl" | "bookingLink" | "mapsUrl">>;
  destination?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  travelerCount?: number;
};

function cleanUrl(value?: string) {
  if (!value) return undefined;

  try {
    const url = new URL(value);

    if (
      (url.hostname === "www.google.com" || url.hostname === "google.com") &&
      url.pathname === "/aclk"
    ) {
      return undefined;
    }

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "gbraid",
      "wbraid",
      "fbclid",
      "msclkid",
      "dclid",
      "mc_cid",
      "mc_eid",
    ].forEach((param) => url.searchParams.delete(param));

    return url.toString();
  } catch {
    return value;
  }
}

export function directHotelPropertyUrl(options: ExpediaStayLinkOptions) {
  const cleanedBooking = cleanUrl(options.hotel?.bookingLink);
  const cleanedWebsite = cleanUrl(options.hotel?.websiteUrl);

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
  const url = new URL("https://www.expedia.com/Hotel-Search");
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
