/**
 * Helper module for trip selections concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import {
  Activity,
  BudgetBreakdown,
  BudgetOptimizationAction,
  BudgetOptimizationSummary,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  ItineraryStop,
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

function selectionStatesEqual(a: TripSelectionState, b: TripSelectionState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function matchByTitle<T extends { name?: string }>(items: T[], title?: string) {
  const target = normalized(title);
  if (!target) return undefined;

  return [...items]
    .sort((a, b) => {
      const aName = normalized(a.name);
      const bName = normalized(b.name);
      const aScore =
        aName === target ? 3 : aName.includes(target) || target.includes(aName) ? 2 : 0;
      const bScore =
        bName === target ? 3 : bName.includes(target) || target.includes(bName) ? 2 : 0;

      return bScore - aScore;
    })
    .find((item) => {
      const itemName = normalized(item.name);
      return itemName === target || itemName.includes(target) || target.includes(itemName);
    });
}

function hotelCostForSelection(
  hotel: HotelOption | undefined,
  nights: number,
  fallbackBreakdown?: Partial<BudgetBreakdown>
) {
  if (!hotel) return Number(fallbackBreakdown?.hotel ?? 0);

  if (typeof hotel.totalStayPrice === "number" && hotel.totalStayPrice > 0) {
    return hotel.totalStayPrice;
  }

  if (typeof hotel.pricePerNight === "number" && hotel.pricePerNight > 0) {
    return hotel.pricePerNight * nights;
  }

  return Number(fallbackBreakdown?.hotel ?? 0);
}

function foodText(spot?: Pick<FoodSpot, "name" | "category" | "tags" | "priceLevel">) {
  return [spot?.name, spot?.category, ...(spot?.tags ?? []), spot?.priceLevel]
    .join(" ")
    .toLowerCase();
}

function activityText(
  activity?: Pick<Activity, "name" | "type" | "shortDescription">
) {
  return [activity?.name, activity?.type, activity?.shortDescription]
    .join(" ")
    .toLowerCase();
}

function stopIntentText(
  stop: Pick<ItineraryStop, "title" | "description" | "time">,
  extra?: string
) {
  return [stop.title, stop.description, stop.time, extra].join(" ").toLowerCase();
}

function isCafeLikeFood(spot?: FoodSpot) {
  const text = foodText(spot);
  return ["cafe", "coffee", "bakery", "breakfast", "brunch", "dessert"].some((term) =>
    text.includes(term)
  );
}

function isMealLikeFood(spot?: FoodSpot) {
  const text = foodText(spot);
  return [
    "restaurant",
    "bistro",
    "bar",
    "grill",
    "steak",
    "tavern",
    "kitchen",
    "lunch",
    "dinner",
  ].some((term) => text.includes(term));
}

function isDessertFood(spot?: FoodSpot) {
  return foodText(spot).includes("dessert");
}

function isSkiActivity(activity?: Activity) {
  const text = activityText(activity);
  return [
    "ski",
    "skiing",
    "snowboard",
    "snowboarding",
    "chairlift",
    "gondola",
    "nordic",
    "resort",
  ].some((term) => text.includes(term));
}

function isHotSpringsActivity(activity?: Activity) {
  return activityText(activity).includes("hot springs");
}

function isHikeActivity(activity?: Activity) {
  const text = activityText(activity);
  return [
    "hike",
    "hiking",
    "trail",
    "summit",
    "ridge",
    "scramble",
    "waterfall",
    "canyon",
  ].some((term) => text.includes(term));
}

function isScenicActivity(activity?: Activity) {
  const text = activityText(activity);
  return ["scenic", "viewpoint", "lookout", "lake", "gondola", "view"].some((term) =>
    text.includes(term)
  );
}

function getBestBudgetFoodCandidate(
  stop: ItineraryStop,
  currentSpot: FoodSpot | undefined,
  foodSpots: FoodSpot[],
  travelers: number
) {
  const intent = stopIntentText(stop, foodText(currentSpot));
  const wantsLight =
    ["coffee", "cafe", "bakery", "breakfast", "brunch"].some((term) =>
      intent.includes(term)
    ) || (!["dinner", "restaurant", "bistro", "bar", "grill"].some((term) => intent.includes(term)) && isCafeLikeFood(currentSpot));
  const wantsDessert = intent.includes("dessert");
  const wantsMeal =
    ["lunch", "dinner", "restaurant", "bistro", "bar", "grill", "tavern"].some((term) =>
      intent.includes(term)
    ) || isMealLikeFood(currentSpot);

  const compatible = foodSpots.filter((candidate) => {
    if (wantsDessert) return isDessertFood(candidate) || isCafeLikeFood(candidate);
    if (wantsLight) return isCafeLikeFood(candidate) || !wantsMeal;
    if (wantsMeal) return isMealLikeFood(candidate) || !isCafeLikeFood(candidate);
    return true;
  });

  const pool = compatible.length > 0 ? compatible : foodSpots;
  return [...pool].sort((a, b) => {
    const costDiff =
      estimateFoodCostForGroup(a, travelers) - estimateFoodCostForGroup(b, travelers);
    if (costDiff !== 0) return costDiff;
    return (b.rating ?? 0) - (a.rating ?? 0);
  })[0];
}

function getBestBudgetActivityCandidate(
  stop: ItineraryStop,
  currentActivity: Activity | undefined,
  activities: Activity[],
  travelers: number
) {
  const intent = stopIntentText(stop, activityText(currentActivity));
  const wantsSki =
    ["ski", "skiing", "snowboard", "snowboarding", "chairlift", "lift", "resort"].some(
      (term) => intent.includes(term)
    ) || isSkiActivity(currentActivity);
  const wantsHotSprings =
    intent.includes("hot springs") || isHotSpringsActivity(currentActivity);
  const wantsHike =
    ["hike", "hiking", "trail", "summit", "ridge", "scramble"].some((term) =>
      intent.includes(term)
    ) || isHikeActivity(currentActivity);
  const wantsScenic =
    ["scenic", "viewpoint", "lookout", "view", "lake", "gondola"].some((term) =>
      intent.includes(term)
    ) || isScenicActivity(currentActivity);

  const compatible = activities.filter((candidate) => {
    if (wantsSki) return isSkiActivity(candidate);
    if (wantsHotSprings) return isHotSpringsActivity(candidate);
    if (wantsHike) return isHikeActivity(candidate);
    if (wantsScenic) return isScenicActivity(candidate) || candidate.type === currentActivity?.type;
    if (currentActivity?.type) return candidate.type === currentActivity.type;
    return true;
  });

  const pool = compatible.length > 0 ? compatible : activities;
  return [...pool].sort((a, b) => {
    const aCost =
      (a.costEstimate ?? a.estimatedCost ?? 0) * Math.max(1, travelers);
    const bCost =
      (b.costEstimate ?? b.estimatedCost ?? 0) * Math.max(1, travelers);
    if (aCost !== bCost) return aCost - bCost;
    return (b.rating ?? 0) - (a.rating ?? 0);
  })[0];
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
  itineraryDays?: ItineraryDayData[];
  selection?: TripSelectionState;
  fallbackBreakdown?: Partial<BudgetBreakdown>;
};

export type BudgetOptimizationResult = {
  baselineSelection: TripSelectionState;
  baselineBudget: BudgetBreakdown;
  optimizedSelection: TripSelectionState;
  optimizedBudget: BudgetBreakdown;
  summary: BudgetOptimizationSummary;
};

export function calculateSelectedBudget({
  tripLengthDays,
  travelerCount,
  hotelOptions,
  foodSpots,
  activities,
  itineraryDays,
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
  const hasStructuredItinerary = Array.isArray(itineraryDays) && itineraryDays.length > 0;
  const includesStayStop = hasStructuredItinerary
    ? itineraryDays.some((day) =>
        (day.stops ?? []).some((stop) => stop.kind === "stay")
      )
    : true;

  const selectedHotel =
    hotelOptions.find((hotel) => hotel.name === safeSelection.hotelName) ??
    hotelOptions[0];

  const hotel =
    hasStructuredItinerary && !includesStayStop
      ? 0
      : typeof selectedHotel?.totalStayPrice === "number"
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
  const itineraryFoodCost = hasStructuredItinerary
    ? itineraryDays.reduce((sum, day, dayIndex) => {
        return (
          sum +
          (day.stops ?? []).reduce((dayTotal, stop, stopIndex) => {
            if (stop.kind !== "food") return dayTotal;

            const key = stopKey(dayIndex, stopIndex);
            const customStop = customReplacementStops[key];
            if (customStop?.kind === "food") {
              return dayTotal + asNumber(customStop.estimatedCost);
            }

            const selectedName = safeSelection.foods[key];
            const selectedSpot = selectedName
              ? foodSpots.find((item) => item.name === selectedName)
              : undefined;
            const stopEstimate = asNumber(stop.estimatedCost);
            const selectedEstimate = selectedSpot
              ? estimateFoodCostForGroup(selectedSpot, safeTravelerCount)
              : 0;

            return dayTotal + (stopEstimate || selectedEstimate);
          }, 0)
        );
      }, 0)
    : Object.entries(safeSelection.foods)
        .filter(([key]) => customReplacementStops[key]?.kind !== "food")
        .reduce((sum, [, selectedName]) => {
          const spot = foodSpots.find((item) => item.name === selectedName);
          if (!spot) return sum;
          return sum + estimateFoodCostForGroup(spot, safeTravelerCount);
        }, 0);

  const itineraryActivityCost = hasStructuredItinerary
    ? itineraryDays.reduce((sum, day, dayIndex) => {
        return (
          sum +
          (day.stops ?? []).reduce((dayTotal, stop, stopIndex) => {
            if (stop.kind !== "activity") return dayTotal;

            const key = stopKey(dayIndex, stopIndex);
            const customStop = customReplacementStops[key];
            if (customStop?.kind === "activity") {
              return dayTotal + asNumber(customStop.estimatedCost);
            }

            const selectedName = safeSelection.activities[key];
            const selectedActivity = selectedName
              ? activities.find((item) => item.name === selectedName)
              : undefined;
            const stopEstimate = asNumber(stop.estimatedCost);
            const selectedEstimate = selectedActivity
              ? (selectedActivity.costEstimate ?? selectedActivity.estimatedCost ?? 0) *
                safeTravelerCount
              : 0;

            return dayTotal + (stopEstimate || selectedEstimate);
          }, 0)
        );
      }, 0)
    : Object.entries(safeSelection.activities)
        .filter(([key]) => customReplacementStops[key]?.kind !== "activity")
        .reduce((sum, [, selectedName]) => {
          const activity = activities.find((item) => item.name === selectedName);
          if (!activity) return sum;
          return (
            sum +
            (activity.costEstimate ?? activity.estimatedCost ?? 0) * safeTravelerCount
          );
        }, 0);

  const addedFoodCost = Object.values(safeSelection.addedStops ?? {}).reduce((sum, stops) => {
    return (
      sum +
      (stops ?? []).reduce((dayTotal, stop) => {
        if (stop.kind !== "food") return dayTotal;
        return dayTotal + asNumber(stop.estimatedCost);
      }, 0)
    );
  }, 0);

  const addedActivityCost = Object.values(safeSelection.addedStops ?? {}).reduce(
    (sum, stops) => {
      return (
        sum +
        (stops ?? []).reduce((dayTotal, stop) => {
          if (stop.kind !== "activity") return dayTotal;
          return dayTotal + asNumber(stop.estimatedCost);
        }, 0)
      );
    },
    0
  );

  const customFoodReplacementCost = hasStructuredItinerary
    ? 0
    : Object.values(customReplacementStops).reduce((sum, stop) => {
        if (stop.kind !== "food") return sum;
        return sum + asNumber(stop.estimatedCost);
      }, 0);

  const customActivityReplacementCost = hasStructuredItinerary
    ? 0
    : Object.values(customReplacementStops).reduce((sum, stop) => {
        if (stop.kind !== "activity") return sum;
        return sum + asNumber(stop.estimatedCost);
      }, 0);

  const food = itineraryFoodCost + customFoodReplacementCost + addedFoodCost;
  const activitiesTotal =
    itineraryActivityCost + customActivityReplacementCost + addedActivityCost;

  const resolvedFood = hasStructuredItinerary
    ? food
    : food || Number(fallbackBreakdown?.food ?? 0);
  const resolvedActivities = hasStructuredItinerary
    ? activitiesTotal
    : activitiesTotal || Number(fallbackBreakdown?.activities ?? 0);

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

export function optimizeSelectionForBudget(
  input: SelectionBudgetInput & { targetTotalBudget?: number }
): BudgetOptimizationResult {
  const safeTravelerCount =
    Number.isFinite(Number(input.travelerCount)) && Number(input.travelerCount) > 0
      ? Number(input.travelerCount)
      : 1;
  const safeTripLengthDays =
    Number.isFinite(Number(input.tripLengthDays)) && Number(input.tripLengthDays) > 0
      ? Number(input.tripLengthDays)
      : 2;
  const nights = Math.max(1, safeTripLengthDays - 1);
  const targetTotalBudget =
    Number.isFinite(Number(input.targetTotalBudget)) && Number(input.targetTotalBudget) > 0
      ? Number(input.targetTotalBudget)
      : undefined;
  const baselineSelection = normalizeSelectionState(
    input.selection ??
      buildDefaultSelectionState(
        input.itineraryDays ?? [],
        input.hotelOptions,
        input.foodSpots,
        input.activities
      )
  );
  const baselineBudget = calculateSelectedBudget({
    ...input,
    tripLengthDays: safeTripLengthDays,
    travelerCount: safeTravelerCount,
    selection: baselineSelection,
  });

  if (!targetTotalBudget) {
    return {
      baselineSelection,
      baselineBudget,
      optimizedSelection: baselineSelection,
      optimizedBudget: baselineBudget,
      summary: {
        status: "no_target",
        baselineTotal: baselineBudget.totalExpected,
        optimizedTotal: baselineBudget.totalExpected,
        totalSavings: 0,
        actions: [],
      },
    };
  }

  type PotentialReplacement = {
    key: string;
    savings: number;
    action: BudgetOptimizationAction;
    apply(selection: TripSelectionState): TripSelectionState;
  };

  const replacements: PotentialReplacement[] = [];
  const selectedHotel =
    input.hotelOptions.find((hotel) => hotel.name === baselineSelection.hotelName) ??
    input.hotelOptions[0];
  const currentHotelCost = hotelCostForSelection(
    selectedHotel,
    nights,
    input.fallbackBreakdown
  );
  const bestBudgetHotel = [...input.hotelOptions]
    .filter((hotel) => hotel.availabilityStatus !== "sold_out")
    .sort((a, b) => {
      const costDiff =
        hotelCostForSelection(a, nights, input.fallbackBreakdown) -
        hotelCostForSelection(b, nights, input.fallbackBreakdown);
      if (costDiff !== 0) return costDiff;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })[0];

  if (
    selectedHotel?.name &&
    bestBudgetHotel?.name &&
    selectedHotel.name !== bestBudgetHotel.name
  ) {
    const savings = Math.max(
      0,
      currentHotelCost -
        hotelCostForSelection(bestBudgetHotel, nights, input.fallbackBreakdown)
    );

    if (savings > 0) {
      replacements.push({
        key: "hotel",
        savings,
        action: {
          kind: "hotel",
          label: "Swapped stay",
          from: selectedHotel.name,
          to: bestBudgetHotel.name,
          savings: Math.round(savings),
        },
        apply(selection) {
          return {
            ...normalizeSelectionState(selection),
            hotelName: bestBudgetHotel.name,
          };
        },
      });
    }
  }

  (input.itineraryDays ?? []).forEach((day, dayIndex) => {
    (day.stops ?? []).forEach((stop, stopIndex) => {
      const key = stopKey(dayIndex, stopIndex);
      const customStop = baselineSelection.customStops?.[key];
      if (customStop) return;

      if (stop.kind === "food") {
        const currentName =
          baselineSelection.foods[key] ?? matchByTitle(input.foodSpots, stop.title)?.name;
        const currentSpot = currentName
          ? input.foodSpots.find((spot) => spot.name === currentName)
          : undefined;
        const candidate = getBestBudgetFoodCandidate(
          stop,
          currentSpot,
          input.foodSpots,
          safeTravelerCount
        );
        const currentCost =
          stop.estimatedCost ||
          (currentSpot ? estimateFoodCostForGroup(currentSpot, safeTravelerCount) : 0);
        const candidateCost = candidate
          ? estimateFoodCostForGroup(candidate, safeTravelerCount)
          : 0;

        if (
          candidate?.name &&
          candidate.name !== currentName &&
          candidateCost > 0 &&
          currentCost > candidateCost
        ) {
          replacements.push({
            key,
            savings: currentCost - candidateCost,
            action: {
              kind: "food",
              label: stop.time ? `Lower-cost meal at ${stop.time}` : "Lower-cost meal",
              from: currentName ?? stop.title,
              to: candidate.name,
              savings: Math.round(currentCost - candidateCost),
            },
            apply(selection) {
              const next = normalizeSelectionState(selection);
              next.foods[key] = candidate.name;
              return next;
            },
          });
        }
      }

      if (stop.kind === "activity") {
        const currentName =
          baselineSelection.activities[key] ??
          matchByTitle(input.activities, stop.title)?.name;
        const currentActivity = currentName
          ? input.activities.find((activity) => activity.name === currentName)
          : undefined;
        const candidate = getBestBudgetActivityCandidate(
          stop,
          currentActivity,
          input.activities,
          safeTravelerCount
        );
        const currentCost =
          stop.estimatedCost ||
          (currentActivity
            ? (currentActivity.costEstimate ?? currentActivity.estimatedCost ?? 0) *
              safeTravelerCount
            : 0);
        const candidateCost = candidate
          ? (candidate.costEstimate ?? candidate.estimatedCost ?? 0) * safeTravelerCount
          : 0;

        if (
          candidate?.name &&
          candidate.name !== currentName &&
          currentCost > candidateCost
        ) {
          replacements.push({
            key,
            savings: currentCost - candidateCost,
            action: {
              kind: "activity",
              label: stop.time ? `Lower-cost activity at ${stop.time}` : "Lower-cost activity",
              from: currentName ?? stop.title,
              to: candidate.name,
              savings: Math.round(currentCost - candidateCost),
            },
            apply(selection) {
              const next = normalizeSelectionState(selection);
              next.activities[key] = candidate.name;
              return next;
            },
          });
        }
      }
    });
  });

  const sortedReplacements = replacements.sort((a, b) => {
    if (b.savings !== a.savings) return b.savings - a.savings;
    return a.key.localeCompare(b.key);
  });

  let optimizedSelection = baselineSelection;
  let optimizedBudget = baselineBudget;
  const actions: BudgetOptimizationAction[] = [];

  for (const replacement of sortedReplacements) {
    const nextSelection = replacement.apply(optimizedSelection);
    if (selectionStatesEqual(nextSelection, optimizedSelection)) {
      continue;
    }

    optimizedSelection = nextSelection;
    optimizedBudget = calculateSelectedBudget({
      ...input,
      tripLengthDays: safeTripLengthDays,
      travelerCount: safeTravelerCount,
      selection: optimizedSelection,
    });
    actions.push(replacement.action);

    if (optimizedBudget.totalExpected <= targetTotalBudget) {
      break;
    }
  }

  const totalSavings = Math.max(
    0,
    baselineBudget.totalExpected - optimizedBudget.totalExpected
  );
  const status =
    baselineBudget.totalExpected <= targetTotalBudget
      ? "already_within_target"
      : optimizedBudget.totalExpected <= targetTotalBudget
        ? "optimized_to_target"
        : "optimized_but_over";

  return {
    baselineSelection,
    baselineBudget,
    optimizedSelection,
    optimizedBudget,
    summary: {
      status,
      targetTotalBudget,
      baselineTotal: baselineBudget.totalExpected,
      optimizedTotal: optimizedBudget.totalExpected,
      totalSavings,
      actions,
    },
  };
}
