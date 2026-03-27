import {
  Activity,
  BudgetBreakdown,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripSelectionState,
} from "./types";
import { estimateFoodCostForGroup } from "./foodPricing";

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

export function emptySelectionState(): TripSelectionState {
  return {
    hotelName: undefined,
    foods: {},
    activities: {},
  };
}

export function buildDefaultSelectionState(
  days: ItineraryDayData[],
  hotels: HotelOption[],
  foodSpots: FoodSpot[],
  activities: Activity[]
): TripSelectionState {
  const initial: TripSelectionState = {
    hotelName: hotels[0]?.name,
    foods: {},
    activities: {},
  };

  days.forEach((day, dayIndex) => {
    (day.stops ?? []).forEach((stop, stopIndex) => {
      const key = stopKey(dayIndex, stopIndex);

      if (stop.kind === "food") {
        const match = foodSpots.find(
          (spot) => normalized(spot.name) === normalized(stop.title)
        );
        if (match?.name) initial.foods[key] = match.name;
      }

      if (stop.kind === "activity") {
        const match = activities.find(
          (item) => normalized(item.name) === normalized(stop.title)
        );
        if (match?.name) initial.activities[key] = match.name;
      }

      if (stop.kind === "stay") {
        const hotelName = stop.title?.replace(/^Check in at\s+/i, "");
        const match = hotels.find(
          (item) => normalized(item.name) === normalized(hotelName)
        );
        if (match?.name) initial.hotelName = match.name;
      }
    });
  });

  return initial;
}

type SelectionBudgetInput = {
  tripLengthDays?: number;
  travelerCount?: number;
  hotelOptions: HotelOption[];
  foodSpots: FoodSpot[];
  activities: Activity[];
  selection?: TripSelectionState;
  fallbackBreakdown?: Partial<BudgetBreakdown>;
};

export function calculateSelectedBudget({
  tripLengthDays,
  travelerCount,
  hotelOptions,
  foodSpots,
  activities,
  selection,
  fallbackBreakdown,
}: SelectionBudgetInput): BudgetBreakdown {
  const safeTravelerCount =
    Number.isFinite(Number(travelerCount)) && Number(travelerCount) > 0
      ? Number(travelerCount)
      : 1;
  const safeTripLengthDays =
    Number.isFinite(Number(tripLengthDays)) && Number(tripLengthDays) > 0
      ? Number(tripLengthDays)
      : 2;
  const nights = Math.max(1, safeTripLengthDays - 1);
  const safeSelection = selection ?? emptySelectionState();

  const selectedHotel =
    hotelOptions.find((hotel) => hotel.name === safeSelection.hotelName) ??
    hotelOptions[0];

  const hotel =
    typeof selectedHotel?.totalStayPrice === "number"
      ? selectedHotel.totalStayPrice
      : typeof selectedHotel?.pricePerNight === "number"
        ? selectedHotel.pricePerNight * nights
        : Number(fallbackBreakdown?.hotel ?? 0);

  const selectedFoodNames = Object.values(safeSelection.foods);
  const food =
    selectedFoodNames.reduce((sum, selectedName) => {
      const spot = foodSpots.find((item) => item.name === selectedName);
      if (!spot) return sum;
      return sum + estimateFoodCostForGroup(spot, safeTravelerCount);
    }, 0) || Number(fallbackBreakdown?.food ?? 0);

  const selectedActivityNames = Object.values(safeSelection.activities);
  const activitiesTotal =
    selectedActivityNames.reduce((sum, selectedName) => {
      const activity = activities.find((item) => item.name === selectedName);
      if (!activity) return sum;
      return (
        sum +
        (activity.costEstimate ?? activity.estimatedCost ?? 0) * safeTravelerCount
      );
    }, 0) || Number(fallbackBreakdown?.activities ?? 0);

  const gas = Number(fallbackBreakdown?.gas ?? 0);
  const misc = Math.round((hotel + food + gas + activitiesTotal) * 0.1);
  const totalExpected = Math.round(hotel + food + gas + activitiesTotal + misc);

  return {
    hotel: Math.round(hotel),
    food: Math.round(food),
    gas: Math.round(gas),
    activities: Math.round(activitiesTotal),
    misc,
    total: totalExpected,
    totalLow: Math.round(totalExpected * 0.9),
    totalExpected,
    totalHigh: Math.round(totalExpected * 1.15),
  };
}
