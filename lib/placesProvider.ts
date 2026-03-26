import {
  searchActivities,
  searchCafes,
  searchHotels,
  searchRestaurants,
  type GooglePlace,
} from "./googlePlaces";
import { deriveTripIntentFromPrompt } from "./tripIntent";

export type PlacesProviderResult = {
  restaurants: GooglePlace[];
  cafes: GooglePlace[];
  activities: GooglePlace[];
  hotels: GooglePlace[];
};

export async function fetchPlacesProviderData(options: {
  destination: string;
  style: string;
  activityFocus?: "skiing" | "hiking" | "camping";
  veganFriendly: boolean;
  tripPrompt?: string;
  tripStartDate?: string;
  tripEndDate?: string;
}): Promise<PlacesProviderResult> {
  const promptIntent = deriveTripIntentFromPrompt(options.tripPrompt);

  const [restaurantsRes, cafesRes, activitiesRes, hotelsRes] =
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
      searchActivities(options.destination, options.style, {
        activityFocus: options.activityFocus,
        hardConstraints: promptIntent.hardConstraints,
        softPreferences: promptIntent.softPreferences,
      }),
      searchHotels(options.destination, {
        tripStartDate: options.tripStartDate,
        tripEndDate: options.tripEndDate,
      }),
    ]);

  return {
    restaurants: restaurantsRes.places ?? [],
    cafes: cafesRes.places ?? [],
    activities: activitiesRes.places ?? [],
    hotels: hotelsRes.places ?? [],
  };
}
