import {
  Activity,
  BudgetBreakdown,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripCustomStop,
  TripSelectionState,
} from "./types";
import { estimateFoodCostForGroup } from "./foodPricing";

function normalized(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function dayKey(dayIndex: number) {
  return `day-${dayIndex}`;
}

function asNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeSelectionState(
  selection?: Partial<TripSelectionState> | null
): TripSelectionState {
  return {
    hotelName: selection?.hotelName,
    foods: { ...(selection?.foods ?? {}) },
    activities: { ...(selection?.activities ?? {}) },
    customStops: { ...(selection?.customStops ?? {}) },
    addedStops: Object.fromEntries(
      Object.entries(selection?.addedStops ?? {}).map(([key, stops]) => [
        key,
        Array.isArray(stops) ? [...stops] : [],
      ])
    ),
  };
}

export function emptySelectionState(): TripSelectionState {
  return normalizeSelectionState();
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
    customStops: {},
    addedStops: {},
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

export function getCustomStopForKey(
  selection: TripSelectionState | null | undefined,
  key: string
) {
  return selection?.customStops?.[key];
}

export function getAddedStopsForDay(
  selection: TripSelectionState | null | undefined,
  dayIndex: number
) {
  return [...(selection?.addedStops?.[dayKey(dayIndex)] ?? [])].sort(
    (a, b) => (a.insertAfterStopIndex ?? Number.MAX_SAFE_INTEGER) - (b.insertAfterStopIndex ?? Number.MAX_SAFE_INTEGER)
  );
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

  const customReplacementStops = Object.entries(safeSelection.customStops ?? {}).reduce(
    (result, [key, stop]) => {
      result[key] = stop;
      return result;
    },
    {} as Record<string, TripCustomStop>
  );

  const selectedFoodNames = Object.entries(safeSelection.foods)
    .filter(([key]) => customReplacementStops[key]?.kind !== "food")
    .map(([, selectedName]) => selectedName);
  const food =
    selectedFoodNames.reduce((sum, selectedName) => {
      const spot = foodSpots.find((item) => item.name === selectedName);
      if (!spot) return sum;
      return sum + estimateFoodCostForGroup(spot, safeTravelerCount);
    }, 0) +
    Object.values(customReplacementStops).reduce((sum, stop) => {
      if (stop.kind !== "food") return sum;
      return sum + asNumber(stop.estimatedCost);
    }, 0) +
    Object.values(safeSelection.addedStops ?? {}).reduce((sum, stops) => {
      return (
        sum +
        (stops ?? []).reduce((dayTotal, stop) => {
          if (stop.kind !== "food") return dayTotal;
          return dayTotal + asNumber(stop.estimatedCost);
        }, 0)
      );
    }, 0);

  const selectedActivityNames = Object.entries(safeSelection.activities)
    .filter(([key]) => customReplacementStops[key]?.kind !== "activity")
    .map(([, selectedName]) => selectedName);
  const activitiesTotal =
    selectedActivityNames.reduce((sum, selectedName) => {
      const activity = activities.find((item) => item.name === selectedName);
      if (!activity) return sum;
      return (
        sum +
        (activity.costEstimate ?? activity.estimatedCost ?? 0) * safeTravelerCount
      );
    }, 0) +
    Object.values(customReplacementStops).reduce((sum, stop) => {
      if (stop.kind !== "activity") return sum;
      return sum + asNumber(stop.estimatedCost);
    }, 0) +
    Object.values(safeSelection.addedStops ?? {}).reduce((sum, stops) => {
      return (
        sum +
        (stops ?? []).reduce((dayTotal, stop) => {
          if (stop.kind !== "activity") return dayTotal;
          return dayTotal + asNumber(stop.estimatedCost);
        }, 0)
      );
    }, 0);

  const resolvedFood = food || Number(fallbackBreakdown?.food ?? 0);
  const resolvedActivities =
    activitiesTotal || Number(fallbackBreakdown?.activities ?? 0);

  const gas = Number(fallbackBreakdown?.gas ?? 0);
  const misc = Math.round((hotel + resolvedFood + gas + resolvedActivities) * 0.1);
  const totalExpected = Math.round(
    hotel + resolvedFood + gas + resolvedActivities + misc
  );

  return {
    hotel: Math.round(hotel),
    food: Math.round(resolvedFood),
    gas: Math.round(gas),
    activities: Math.round(resolvedActivities),
    misc,
    total: totalExpected,
    totalLow: Math.round(totalExpected * 0.9),
    totalExpected,
    totalHigh: Math.round(totalExpected * 1.15),
  };
}
