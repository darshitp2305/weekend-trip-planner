import {
  RankedDestination,
  RankingReason,
  TripDataSource,
  TripInput,
} from "./types";
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

function averageRating(
  items: Array<{ rating?: number }>
): number | undefined {
  const rated = items.filter((item) => typeof item.rating === "number");
  if (rated.length === 0) return undefined;

  const average =
    rated.reduce((sum, item) => sum + (item.rating ?? 0), 0) / rated.length;

  return Number(average.toFixed(1));
}

function buildLiveSummary(
  restaurantItems: Array<{ rating?: number }>,
  activityItems: Array<{ rating?: number }>,
  hotelItems: Array<{ rating?: number }>,
  usedPlacesData: boolean
) {
  return {
    restaurantCount: restaurantItems.length,
    avgRestaurantRating: averageRating(restaurantItems),
    activityCount: activityItems.length,
    avgActivityRating: averageRating(activityItems),
    hotelCount: hotelItems.length,
    usedPlacesData,
    usedFallbackData: !usedPlacesData,
  };
}

export async function enrichRankedTrip(
  trip: RankedDestination,
  input: TripInput
): Promise<{ trip: RankedDestination; source: TripDataSource }> {
  const destinationQuery = `${trip.name}, ${trip.province}`;

  try {
    const [restaurantsRes, cafesRes, activitiesRes, hotelsRes] =
      await Promise.all([
        searchRestaurants(destinationQuery),
        searchCafes(destinationQuery),
        searchActivities(destinationQuery, input.style),
        searchHotels(destinationQuery),
      ]);

    const liveRestaurants = (restaurantsRes.places ?? [])
      .map(mapGooglePlaceToFoodSpot)
      .filter((item) => item.name);

    const liveCafes = (cafesRes.places ?? [])
      .map(mapGooglePlaceToFoodSpot)
      .filter((item) => item.name);

    const liveActivities = (activitiesRes.places ?? [])
      .map(mapGooglePlaceToActivity)
      .filter((item) => item.name);

    const liveHotels = (hotelsRes.places ?? [])
      .map(mapGooglePlaceToHotel)
      .filter((item) => item.name);

    const mergedFoodSpots =
      [...liveRestaurants, ...liveCafes].slice(0, 6).length > 0
        ? [...liveRestaurants, ...liveCafes].slice(0, 6)
        : trip.foodSpots;

    const mergedActivities =
      liveActivities.slice(0, 6).length > 0
        ? liveActivities.slice(0, 6)
        : trip.topActivities;

    const mergedHotels =
      liveHotels.slice(0, 4).length > 0
        ? liveHotels.slice(0, 4)
        : trip.hotelOptions;

    const hasLiveResults =
      [...liveRestaurants, ...liveCafes].length > 0 ||
      liveActivities.length > 0 ||
      liveHotels.length > 0;

    const source: TripDataSource = hasLiveResults
      ? "live-google-places"
      : "static-fallback";

    const liveDataSummary = buildLiveSummary(
      [...liveRestaurants, ...liveCafes],
      liveActivities,
      liveHotels,
      hasLiveResults
    );

    const rankingReasons: RankingReason[] = Array.isArray(trip.rankingReasons)
      ? [...trip.rankingReasons]
      : [];

    if (hasLiveResults) {
      rankingReasons.unshift({
        label: "Backed by live Google Places results",
        impact: "positive",
      });
    } else {
      rankingReasons.unshift({
        label: "Using fallback recommendation data",
        impact: "neutral",
      });
    }

    const mergedTrip: RankedDestination = {
      ...trip,
      foodSpots: mergedFoodSpots,
      topActivities: mergedActivities,
      hotelOptions: mergedHotels,
      liveDataSummary,
      rankingReasons: rankingReasons.slice(0, 4),
    };

    return { trip: mergedTrip, source };
  } catch (error) {
    console.error(
      "Google Places enrichment failed. Falling back to static trip data.",
      error
    );

    const fallbackRankingReasons: RankingReason[] = [
      {
        label: "Using fallback recommendation data",
        impact: "neutral",
      },
      ...(trip.rankingReasons ?? []),
    ];

    return {
      trip: {
        ...trip,
        liveDataSummary: buildLiveSummary(
          trip.foodSpots,
          trip.topActivities,
          trip.hotelOptions,
          false
        ),
        rankingReasons: fallbackRankingReasons.slice(0, 4),
      },
      source: "static-fallback",
    };
  }
}