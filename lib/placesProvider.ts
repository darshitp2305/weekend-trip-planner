import {
  searchActivities,
  searchCafes,
  searchHotels,
  searchRestaurants,
  type GooglePlace,
} from "./googlePlaces";

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
  tripStartDate?: string;
  tripEndDate?: string;
}): Promise<PlacesProviderResult> {
  const [restaurantsRes, cafesRes, activitiesRes, hotelsRes] =
    await Promise.all([
      searchRestaurants(options.destination, {
        veganFriendly: options.veganFriendly,
      }),
      searchCafes(options.destination, {
        veganFriendly: options.veganFriendly,
      }),
      searchActivities(options.destination, options.style, options.activityFocus),
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
