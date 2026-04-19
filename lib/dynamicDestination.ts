/**
 * Live destination resolver for user-named Canadian places that are not yet in
 * the curated static catalog.
 */

import destinationCatalog from "./destinationCatalog";
import {
  CANADIAN_PROVINCES_AND_TERRITORIES,
  getDepartureLocation,
  type ProvinceOrTerritory,
} from "./canadaGeography";
import { searchDestinationIdentity, type GooglePlace } from "./googlePlaces";
import {
  mapGooglePlaceToFoodSpot,
  mapGooglePlaceToHotel,
} from "./placeMappers";
import { fetchPlacesProviderData } from "./placesProvider";
import { reportProviderEvent } from "./providerTelemetry";
import type { RawDestination, TripInput } from "./types";

function normalizeSearchText(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.reduce(
    (total, keyword) => total + Number(text.includes(keyword)),
    0
  );
}

function destinationSearchBlob(raw: RawDestination): string {
  return normalizeSearchText(
    [
      raw.name,
      raw.home_base_city,
      raw.region,
      ...(raw.vibes ?? []),
      ...(raw.anchor_experiences ?? []).map((item) => item.title),
      ...(raw.neighborhoods ?? []).map((item) => item.name),
    ].join(" ")
  );
}

export function hasCatalogDestinationMatch(query?: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;

  return (destinationCatalog as RawDestination[]).some((raw) => {
    const haystack = destinationSearchBlob(raw);
    if (!haystack) return false;

    if (haystack.includes(normalizedQuery)) return true;

    const tokens = normalizedQuery.split(" ").filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  });
}

function isCanadianFormattedAddress(value?: string): boolean {
  const normalized = normalizeSearchText(value);
  if (!normalized) return false;

  if (normalized.includes("canada")) {
    return true;
  }

  return CANADIAN_PROVINCES_AND_TERRITORIES.some((province) => {
    const phrases = [province.name, ...(province.aliases ?? [])];
    return phrases.some((phrase) => normalized.includes(normalizeSearchText(phrase)));
  });
}

function resolveProvince(value?: string): ProvinceOrTerritory | undefined {
  const normalized = normalizeSearchText(value);
  if (!normalized) return undefined;

  return CANADIAN_PROVINCES_AND_TERRITORIES.find((province) => {
    const phrases = [province.name, ...(province.aliases ?? [])];
    return phrases.some((phrase) => normalized.includes(normalizeSearchText(phrase)));
  });
}

function getPhotoPath(place?: GooglePlace): string | undefined {
  const photoName = place?.photos?.[0]?.name?.trim();
  if (!photoName) return undefined;
  return `/api/place-photo?ref=${encodeURIComponent(photoName)}&w=1600&h=1200`;
}

function isObviousNonActivityType(primaryType?: string): boolean {
  const normalized = normalizeSearchText(primaryType);
  if (!normalized) return false;

  return [
    "restaurant",
    "cafe",
    "bakery",
    "hotel",
    "lodging",
    "store",
    "gas station",
    "supermarket",
    "bar",
    "bank",
    "atm",
    "hospital",
    "locality",
    "city hall",
    "real estate",
    "school",
  ].some((term) => normalized.includes(term));
}

function dedupePlaces(places: GooglePlace[]): GooglePlace[] {
  const seen = new Set<string>();

  return places.filter((place) => {
    const key = [
      place.id?.trim().toLowerCase(),
      place.displayName?.text?.trim().toLowerCase(),
      place.formattedAddress?.trim().toLowerCase(),
    ]
      .filter(Boolean)
      .join("|");

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dynamicActivityScore(place: GooglePlace, input: TripInput): number {
  const text = normalizeSearchText(
    [
      place.displayName?.text,
      place.primaryType,
      place.formattedAddress,
    ].join(" ")
  );
  let score = 0;

  if (isObviousNonActivityType(place.primaryType)) {
    score -= 40;
  }

  if (
    [
      "hiking",
      "trail",
      "waterfall",
      "canyon",
      "lookout",
      "viewpoint",
      "lake",
      "beach",
      "park",
      "forest",
      "river",
      "mountain",
      "summit",
      "gondola",
      "hot spring",
      "ski",
      "scenic",
    ].some((term) => text.includes(term))
  ) {
    score += 18;
  }

  if (
    input.style === "adventure" ||
    input.style === "outdoors" ||
    input.activityFocus === "hiking"
  ) {
    if (
      [
        "trail",
        "hiking",
        "waterfall",
        "lookout",
        "lake",
        "park",
        "mountain",
        "summit",
        "canyon",
      ].some((term) => text.includes(term))
    ) {
      score += 24;
    }

    if (text.includes("museum") || text.includes("gallery")) {
      score -= 14;
    }
  }

  if (input.style === "must see") {
    if (
      ["landmark", "iconic", "viewpoint", "lookout", "waterfall"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 14;
    }
  }

  if (input.style === "chill" || input.style === "solo reset") {
    if (
      ["easy walk", "garden", "waterfront", "viewpoint", "beach", "lake"].some((term) =>
        text.includes(term)
      )
    ) {
      score += 10;
    }
  }

  score += (place.rating ?? 0) * 3;
  score += Math.min(12, Math.log10(Math.max(1, place.userRatingCount ?? 0)) * 8);

  return score;
}

function rankDynamicActivities(
  places: GooglePlace[],
  input: TripInput
): GooglePlace[] {
  const deduped = dedupePlaces(places);
  const ranked = deduped
    .map((place) => ({
      place,
      score: dynamicActivityScore(place, input),
    }))
    .sort((left, right) => right.score - left.score);

  const strong = ranked
    .filter(({ score }) => score >= 12)
    .map(({ place }) => place);

  if (strong.length > 0) {
    return strong;
  }

  return ranked.map(({ place }) => place);
}

function isObviousNonDestinationType(primaryType?: string): boolean {
  const normalized = normalizeSearchText(primaryType);
  if (!normalized) return false;

  return [
    "restaurant",
    "cafe",
    "bakery",
    "hotel",
    "lodging",
    "store",
    "gas station",
    "supermarket",
    "bar",
    "gym",
    "hospital",
  ].some((term) => normalized.includes(term));
}

function scoreDestinationIdentity(place: GooglePlace, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const displayName = normalizeSearchText(place.displayName?.text);
  const address = normalizeSearchText(place.formattedAddress);
  const primaryType = normalizeSearchText(place.primaryType);

  let score = 0;

  if (displayName === normalizedQuery) score += 120;
  else if (displayName.includes(normalizedQuery)) score += 85;
  else if (normalizedQuery.includes(displayName) && displayName) score += 64;

  if (address.includes(normalizedQuery)) score += 44;
  if (isCanadianFormattedAddress(place.formattedAddress)) score += 35;
  if (!isObviousNonDestinationType(primaryType)) score += 12;
  else score -= 40;

  score += (place.rating ?? 0) * 4;
  score += Math.min(10, Math.log10(Math.max(1, place.userRatingCount ?? 0)) * 6);

  return score;
}

function pickDestinationIdentity(
  places: GooglePlace[] | undefined,
  query: string
): GooglePlace | undefined {
  return [...(places ?? [])]
    .filter((place) => {
      const displayName = normalizeSearchText(place.displayName?.text);
      const address = normalizeSearchText(place.formattedAddress);
      const normalizedQuery = normalizeSearchText(query);

      return Boolean(
        normalizedQuery &&
          (displayName.includes(normalizedQuery) ||
            normalizedQuery.includes(displayName) ||
            address.includes(normalizedQuery))
      );
    })
    .sort((left, right) => scoreDestinationIdentity(right, query) - scoreDestinationIdentity(left, query))[0];
}

function inferCostLevelFromPlaces(places: GooglePlace[]): RawDestination["cost_level"] {
  const joined = normalizeSearchText(
    places.map((place) => place.priceLevel ?? "").join(" ")
  );

  if (joined.includes("very expensive") || joined.includes("expensive")) {
    return "high";
  }

  if (joined.includes("moderate")) {
    return "mid";
  }

  if (joined.includes("inexpensive")) {
    return "low_mid";
  }

  return "mid";
}

function inferVibes(args: {
  text: string;
  input: TripInput;
  hasFood: boolean;
  hasActivities: boolean;
  hasHotels: boolean;
}): string[] {
  const vibes = new Set<string>();
  const { text, input, hasFood, hasActivities, hasHotels } = args;

  if (countMatches(text, ["mountain", "trail", "lake", "coast", "park", "forest", "hike"]) >= 2) {
    vibes.add("nature");
  }

  if (countMatches(text, ["scenic", "view", "lookout", "beach", "waterfront", "island"]) >= 1) {
    vibes.add("scenic");
  }

  if (countMatches(text, ["restaurant", "cafe", "coffee", "bakery", "market", "brewery"]) >= 2 || hasFood) {
    vibes.add("food");
  }

  if (countMatches(text, ["spa", "quiet", "relax", "retreat", "garden", "waterfront"]) >= 1 || hasHotels) {
    vibes.add("relax");
  }

  if (countMatches(text, ["adventure", "trail", "summit", "ridge", "ski", "paddle"]) >= 1 || hasActivities) {
    vibes.add("adventure");
  }

  if (countMatches(text, ["museum", "historic", "heritage", "gallery", "old town"]) >= 1) {
    vibes.add("culture");
  }

  if (input.style === "foodie") vibes.add("food");
  if (input.style === "chill" || input.style === "solo reset") vibes.add("relax");
  if (input.style === "adventure" || input.style === "outdoors") vibes.add("nature");

  if (vibes.size === 0) {
    vibes.add("scenic");
    vibes.add("adventure");
  }

  return Array.from(vibes).slice(0, 5);
}

function deriveStyleScores(text: string, input: TripInput) {
  const outdoors = countMatches(text, [
    "trail",
    "hike",
    "mountain",
    "lake",
    "coast",
    "park",
    "forest",
    "island",
    "outdoor",
  ]);
  const foodie = countMatches(text, [
    "restaurant",
    "cafe",
    "coffee",
    "bakery",
    "market",
    "brewery",
    "bistro",
  ]);
  const chill = countMatches(text, [
    "spa",
    "quiet",
    "relax",
    "retreat",
    "waterfront",
    "garden",
    "stroll",
  ]);
  const adventure = countMatches(text, [
    "adventure",
    "trail",
    "summit",
    "ridge",
    "ski",
    "kayak",
    "paddle",
    "gondola",
  ]);
  const soloReset = countMatches(text, [
    "quiet",
    "scenic",
    "relax",
    "retreat",
    "waterfront",
    "coffee",
  ]);

  const boostForRequestedStyle = (style: TripInput["style"], current: number) =>
    input.style === style ? current + 2 : current;

  return {
    chill: Math.max(1, Math.min(4, boostForRequestedStyle("chill", chill || 1))),
    outdoors: Math.max(1, Math.min(4, boostForRequestedStyle("outdoors", outdoors || 1))),
    foodie: Math.max(1, Math.min(4, boostForRequestedStyle("foodie", foodie || 1))),
    "solo reset": Math.max(
      1,
      Math.min(4, boostForRequestedStyle("solo reset", soloReset || chill || 1))
    ),
    adventure: Math.max(
      1,
      Math.min(4, boostForRequestedStyle("adventure", Math.max(adventure, outdoors) || 1))
    ),
  };
}

function firstLine(value?: string): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

function buildDynamicSummary(args: {
  destinationName: string;
  provinceName?: string;
  vibes: string[];
  activityTitles: string[];
}): string {
  const vibeText = args.vibes.slice(0, 4).join(", ");
  const highlightText = args.activityTitles.slice(0, 2).join(" and ");
  const locationText = args.provinceName ? ` in ${args.provinceName}` : "";

  return `${args.destinationName}${locationText} is a Canada trip pick known for ${
    vibeText || "scenic travel"
  }${highlightText ? `, with highlights like ${highlightText}` : ""}.`;
}

function buildFallbackAnchor(title: string, destinationName: string) {
  return {
    title,
    type: "scenic",
    description: `Live geography pick centered on ${destinationName}.`,
    link: "",
  };
}

function buildDynamicRawDestination(args: {
  query: string;
  place: GooglePlace;
  input: TripInput;
  providerData: Awaited<ReturnType<typeof fetchPlacesProviderData>>;
}): RawDestination {
  const { place, input, providerData, query } = args;
  const province = resolveProvince(place.formattedAddress);
  const destinationName = place.displayName?.text?.trim() || query.trim();
  const provinceName =
    province?.name ??
    firstLine((place.formattedAddress ?? "").split(",").slice(-2, -1)[0]);
  const homeBaseCity = firstLine(place.formattedAddress) || destinationName;
  const rankedActivities = rankDynamicActivities(providerData.activities, input);
  const activities = rankedActivities.slice(0, 8);
  const restaurants = providerData.restaurants.slice(0, 5);
  const cafes = providerData.cafes.slice(0, 4);
  const hotels = providerData.hotels.slice(0, 5);
  const textBlob = normalizeSearchText(
    [
      destinationName,
      place.formattedAddress,
      ...activities.map((item) => item.displayName?.text),
      ...activities.map((item) => item.primaryType),
      ...restaurants.map((item) => item.displayName?.text),
      ...cafes.map((item) => item.displayName?.text),
      ...hotels.map((item) => item.displayName?.text),
    ].join(" ")
  );
  const vibes = inferVibes({
    text: textBlob,
    input,
    hasFood: restaurants.length + cafes.length > 0,
    hasActivities: activities.length > 0,
    hasHotels: hotels.length > 0,
  });
  const photoUrl =
    getPhotoPath(activities.find((item) => item.photos?.length)) ??
    getPhotoPath(restaurants[0]) ??
    getPhotoPath(cafes[0]) ??
    getPhotoPath(hotels[0]) ??
    getPhotoPath(place) ??
    undefined;
  const styleScores = deriveStyleScores(textBlob, input);
  const destinationSummary = buildDynamicSummary({
    destinationName,
    provinceName,
    vibes,
    activityTitles: activities.map((item) => item.displayName?.text ?? "").filter(Boolean),
  });
  const departureLocation = getDepartureLocation(input.startCity);
  const isStaycation =
    normalizeSearchText(destinationName) === normalizeSearchText(input.startCity) ||
    normalizeSearchText(homeBaseCity) === normalizeSearchText(input.startCity) ||
    (typeof departureLocation?.latitude === "number" &&
      typeof departureLocation?.longitude === "number" &&
      departureLocation.latitude === place.location?.latitude &&
      departureLocation.longitude === place.location?.longitude);

  const neighborhoods = [...restaurants, ...cafes].slice(0, 4).map((spot) => ({
    name: spot.displayName?.text ?? homeBaseCity,
    reason: spot.formattedAddress || `Popular stop around ${destinationName}.`,
    link: spot.googleMapsUri || spot.websiteUri || "",
  }));

  return {
    id: `dynamic_${normalizeSlug(destinationName)}_${normalizeSlug(province?.code ?? "ca")}`,
    name: destinationName,
    region: provinceName || "Canada",
    home_base_city: homeBaseCity,
    is_staycation: isStaycation,
    image_url: photoUrl,
    image_url_light: photoUrl,
    image_url_dark: photoUrl,
    image_source_url: place.googleMapsUri || place.websiteUri,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    drive_time_hours_from: {},
    distance_km_from: {},
    cost_level: inferCostLevelFromPlaces([
      place,
      ...restaurants,
      ...cafes,
      ...hotels,
    ]),
    vibes,
    best_seasons: ["spring", "summer", "fall", "winter"],
    avoid_seasons: [],
    style_scores: styleScores,
    anchor_experiences:
      activities.length > 0
        ? activities.map((activity) => ({
            title: activity.displayName?.text ?? destinationName,
            type: normalizeSlug(activity.primaryType) || "scenic",
            description: activity.formattedAddress || destinationSummary,
            link: activity.googleMapsUri || activity.websiteUri || "",
            latitude: activity.location?.latitude,
            longitude: activity.location?.longitude,
          }))
        : [buildFallbackAnchor(`Explore ${destinationName}`, destinationName)],
    neighborhoods:
      neighborhoods.length > 0
        ? neighborhoods
        : [
            {
              name: homeBaseCity,
              reason: destinationSummary,
              link: place.googleMapsUri || place.websiteUri || "",
            },
          ],
    hotel_options: hotels.slice(0, 4).map((hotel) => {
      const mapped = mapGooglePlaceToHotel(hotel);
      return {
        name: mapped.name,
        booking_link: mapped.bookingLink,
        description: mapped.shortDescription,
        latitude: mapped.latitude,
        longitude: mapped.longitude,
      };
    }),
    food_spots: [...restaurants, ...cafes].slice(0, 6).map((spot) => {
      const mapped = mapGooglePlaceToFoodSpot(spot);
      return {
        name: mapped.name,
        tags: mapped.tags,
        link: mapped.mapsUrl || mapped.websiteUrl || mapped.link,
        description: mapped.shortDescription,
        latitude: mapped.latitude,
        longitude: mapped.longitude,
      };
    }),
  };
}

export async function resolveDynamicPreferredDestination(
  input: TripInput
): Promise<RawDestination | null> {
  const preferredDestination = input.preferredDestination?.trim();
  if (!preferredDestination) {
    return null;
  }

  if (hasCatalogDestinationMatch(preferredDestination)) {
    return null;
  }

  try {
    const identity = await searchDestinationIdentity(preferredDestination);
    const place = pickDestinationIdentity(identity.places, preferredDestination);

    if (!place || !isCanadianFormattedAddress(place.formattedAddress)) {
      return null;
    }

    const providerData = await fetchPlacesProviderData({
      destination: `${place.displayName?.text ?? preferredDestination}, ${
        resolveProvince(place.formattedAddress)?.name ?? "Canada"
      }`,
      style: input.style,
      activityFocus: input.activityFocus,
      veganFriendly: input.veganFriendly,
      tripPrompt: input.tripPrompt,
      tripStartDate: input.tripStartDate,
      tripEndDate: input.tripEndDate,
      latitude: place.location?.latitude,
      longitude: place.location?.longitude,
    });

    return buildDynamicRawDestination({
      query: preferredDestination,
      place,
      input,
      providerData,
    });
  } catch (error) {
    reportProviderEvent({
      provider: "google_places",
      operation: "resolve_preferred_destination",
      outcome: "live_unavailable",
      destination: preferredDestination,
      detail:
        "Dynamic geography lookup failed. Falling back to the curated destination catalog.",
      error,
    });

    return null;
  }
}
