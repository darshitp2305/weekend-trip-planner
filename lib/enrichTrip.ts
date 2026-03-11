import { RankedDestination, TripInput, TripDataSource } from "./types";
import {
  searchActivities,
  searchCafes,
  searchHotels,
  searchRestaurants,
} from "./googlePlaces";
import {
  mapGooglePlaceToActivity,
  mapGooglePlaceToFoodSpot,
  mapGooglePlaceToHotel,
} from "./placeMappers";

export async function enrichRankedTrip(
  trip: RankedDestination,
  input: TripInput
): Promise<{ trip: RankedDestination; source: TripDataSource }> {
  const destinationQuery = `${trip.name}, ${trip.province}`;

  try {
    const [restaurantsRes, cafesRes, activitiesRes, hotelsRes] = await Promise.all([
      searchRestaurants(destinationQuery),
      searchCafes(destinationQuery),
      searchActivities(destinationQuery, input.style),
      searchHotels(destinationQuery),
    ]);

    const liveRestaurants = (restaurantsRes.places ?? []).map(mapGooglePlaceToFoodSpot);
    const liveCafes = (cafesRes.places ?? []).map(mapGooglePlaceToFoodSpot);
    const liveActivities = (activitiesRes.places ?? []).map(mapGooglePlaceToActivity);
    const liveHotels = (hotelsRes.places ?? []).map(mapGooglePlaceToHotel);

    const mergedTrip: RankedDestination = {
      ...trip,
      foodSpots:
        [...liveRestaurants, ...liveCafes].filter((item) => item.name).slice(0, 6).length > 0
          ? [...liveRestaurants, ...liveCafes].filter((item) => item.name).slice(0, 6)
          : trip.foodSpots,
      topActivities:
        liveActivities.filter((item) => item.name).slice(0, 6).length > 0
          ? liveActivities.filter((item) => item.name).slice(0, 6)
          : trip.topActivities,
      hotelOptions:
        liveHotels.filter((item) => item.name).slice(0, 4).length > 0
          ? liveHotels.filter((item) => item.name).slice(0, 4)
          : trip.hotelOptions,
    };

    const hasLiveResults =
      mergedTrip.foodSpots !== trip.foodSpots ||
      mergedTrip.topActivities !== trip.topActivities ||
      mergedTrip.hotelOptions !== trip.hotelOptions;

    return {
      trip: mergedTrip,
      source: hasLiveResults ? "live-google-places" : "static-fallback",
    };
  } catch (error) {
    console.error("Google Places enrichment failed. Falling back to static trip data.", error);
    return {
      trip,
      source: "static-fallback",
    };
  }
}