/**
 * Helper module for places provider concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  searchActivities,
  searchActivitiesByPreference,
  searchCafes,
  searchHotels,
  searchRestaurants,
  type GooglePlace,
} from "./googlePlaces";
import {
  deriveTripIntentFromPrompt,
  type PromptHardConstraints,
  type PromptSoftPreferences,
} from "./tripIntent";

export type PlacesProviderResult = {
  restaurants: GooglePlace[];
  cafes: GooglePlace[];
  activities: GooglePlace[];
  hotels: GooglePlace[];
};

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

function dedupeTextValues(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function buildActivityPreferenceQueries(options: {
  style: string;
  activityFocus?: "skiing" | "hiking" | "camping";
  hardConstraints: PromptHardConstraints;
  softPreferences: PromptSoftPreferences;
  requestedActivityName?: string;
}): string[] {
  const queries: string[] = [];
  const style = options.style.trim().toLowerCase();

  if (options.requestedActivityName?.trim()) {
    queries.push(options.requestedActivityName.trim());
  }

  if (
    options.activityFocus === "hiking" ||
    options.hardConstraints.activityAnchor === "summit_hike" ||
    style === "outdoors" ||
    style === "adventure"
  ) {
    queries.push("scenic hike");
    queries.push("waterfall trail");
    queries.push("mountain lookout");
    queries.push("lake trail");
  }

  if (options.activityFocus === "camping") {
    queries.push("provincial park");
    queries.push("campground");
  }

  if (style === "must see") {
    queries.push("iconic viewpoint");
    queries.push("landmark");
  }

  if (style === "hidden gems") {
    queries.push("local trail");
    queries.push("scenic lookout");
  }

  if (style === "chill" || style === "solo reset") {
    queries.push("easy scenic walk");
    queries.push("waterfront viewpoint");
  }

  if (options.softPreferences.wantsScenery) {
    queries.push("scenic viewpoint");
  }

  return dedupeTextValues(queries).slice(0, 5);
}

export async function fetchPlacesProviderData(options: {
  destination: string;
  style: string;
  activityFocus?: "skiing" | "hiking" | "camping";
  veganFriendly: boolean;
  tripPrompt?: string;
  tripStartDate?: string;
  tripEndDate?: string;
  latitude?: number;
  longitude?: number;
}): Promise<PlacesProviderResult> {
  const promptIntent = deriveTripIntentFromPrompt(options.tripPrompt);
  const activityPreferenceQueries = buildActivityPreferenceQueries({
    style: options.style,
    activityFocus: options.activityFocus,
    hardConstraints: promptIntent.hardConstraints,
    softPreferences: promptIntent.softPreferences,
    requestedActivityName: promptIntent.requestedActivityName,
  });

  const [restaurantsRes, cafesRes, activityResults, hotelsRes] =
    await Promise.all([
      searchRestaurants(options.destination, {
        veganFriendly: options.veganFriendly,
        requiresVegetarianOptions:
          promptIntent.hardConstraints.requiresVegetarianOptions,
        mixedDietGroup: promptIntent.hardConstraints.mixedDietGroup,
        wantsGoodFood: promptIntent.softPreferences.wantsGoodFood,
      }),
      searchCafes(options.destination, {
        veganFriendly: options.veganFriendly,
        requiresVegetarianOptions:
          promptIntent.hardConstraints.requiresVegetarianOptions,
        mixedDietGroup: promptIntent.hardConstraints.mixedDietGroup,
        wantsGoodFood: promptIntent.softPreferences.wantsGoodFood,
      }),
      Promise.all([
        searchActivities(options.destination, options.style, {
          activityFocus: options.activityFocus,
          hardConstraints: promptIntent.hardConstraints,
          softPreferences: promptIntent.softPreferences,
          requestedActivityName: promptIntent.requestedActivityName,
        }),
        ...activityPreferenceQueries.map((preference) =>
          searchActivitiesByPreference(options.destination, preference, {
            latitude: options.latitude,
            longitude: options.longitude,
            radiusKm: 40,
          })
        ),
      ]),
      searchHotels(options.destination, {
        tripStartDate: options.tripStartDate,
        tripEndDate: options.tripEndDate,
      }),
    ]);

  return {
    restaurants: restaurantsRes.places ?? [],
    cafes: cafesRes.places ?? [],
    activities: dedupePlaces(
      activityResults.flatMap((result) => result.places ?? [])
    ),
    hotels: hotelsRes.places ?? [],
  };
}
