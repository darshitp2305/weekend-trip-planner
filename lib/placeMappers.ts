import { Activity, FoodSpot, HotelOption } from "./types";
import { GooglePlace } from "./googlePlaces";

function getLatitude(place: GooglePlace): number | undefined {
  return typeof place.location?.latitude === "number" &&
    Number.isFinite(place.location.latitude)
    ? place.location.latitude
    : undefined;
}

function getLongitude(place: GooglePlace): number | undefined {
  return typeof place.location?.longitude === "number" &&
    Number.isFinite(place.location.longitude)
    ? place.location.longitude
    : undefined;
}

function inferActivityCost(primaryType?: string): number {
  if (!primaryType) return 0;
  if (primaryType.includes("museum")) return 25;
  if (primaryType.includes("amusement")) return 40;
  if (primaryType.includes("spa")) return 35;
  return 0;
}

function humanizePrimaryType(primaryType?: string): string | undefined {
  if (!primaryType) return undefined;

  return primaryType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function mapGooglePlaceToFoodSpot(place: GooglePlace): FoodSpot {
  return {
    name: place.displayName?.text ?? "Unnamed food spot",
    tags: humanizePrimaryType(place.primaryType)
      ? [humanizePrimaryType(place.primaryType)!]
      : [],
    link: place.googleMapsUri || place.websiteUri || "",
    websiteUrl: place.websiteUri || "",
    mapsUrl: place.googleMapsUri || "",
    rating: place.rating,
    shortDescription: place.formattedAddress || "Live Google Places result.",
    photoRef: place.photos?.[0]?.name,
    latitude: getLatitude(place),
    longitude: getLongitude(place),
  };
}

export function mapGooglePlaceToActivity(place: GooglePlace): Activity {
  const cost = inferActivityCost(place.primaryType);

  return {
    name: place.displayName?.text ?? "Unnamed activity",
    type: humanizePrimaryType(place.primaryType) || "Activity",
    costEstimate: cost,
    bookingLink: place.googleMapsUri || place.websiteUri || "",
    websiteUrl: place.websiteUri || "",
    mapsUrl: place.googleMapsUri || "",
    rating: place.rating,
    shortDescription: place.formattedAddress || "Live Google Places result.",
    estimatedCost: cost,
    photoRef: place.photos?.[0]?.name,
    latitude: getLatitude(place),
    longitude: getLongitude(place),
  };
}

export function mapGooglePlaceToHotel(place: GooglePlace): HotelOption {
  return {
    name: place.displayName?.text ?? "Unnamed hotel",
    pricePerNight: undefined,
    totalStayPrice: undefined,
    pricingSource: undefined,
    bookingLink: place.googleMapsUri || place.websiteUri || "",
    websiteUrl: place.websiteUri || "",
    mapsUrl: place.googleMapsUri || "",
    rating: place.rating,
    shortDescription: place.formattedAddress || "Live Google Places result.",
    estimatedCost: undefined,
    photoRef: place.photos?.[0]?.name,
    latitude: getLatitude(place),
    longitude: getLongitude(place),
  };
}
