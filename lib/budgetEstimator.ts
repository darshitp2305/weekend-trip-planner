/**
 * Helper module for budget estimator concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import type { BudgetBreakdown, RankedDestination, TripInput } from "./types";

type BudgetTripLike = {
  driveHoursFromStart?: number;
  estimatedCost?: number;
  liveDataSummary?: RankedDestination["liveDataSummary"];
  isStaycation?: boolean;
};

function roundToNearest5(value: number): number {
  return Math.round(value / 5) * 5;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function estimateBudgetBreakdown(
  trip: BudgetTripLike,
  tripLengthDaysOrInput?: number | TripInput
): BudgetBreakdown {
  const tripLengthDays =
    typeof tripLengthDaysOrInput === "number"
      ? Math.max(1, tripLengthDaysOrInput)
      : Math.max(1, tripLengthDaysOrInput?.tripLengthDays ?? 2);

  const input =
    typeof tripLengthDaysOrInput === "object" && tripLengthDaysOrInput !== null
      ? tripLengthDaysOrInput
      : undefined;

  const travelerCount = Math.max(1, input?.travelerCount ?? 1);
  const driveHours = Math.max(0, trip.driveHoursFromStart ?? 0);
  const estimatedCost = Math.max(0, trip.estimatedCost ?? 0);
  const isStaycation = Boolean(trip.isStaycation || driveHours <= 0.5);

  const nights = Math.max(1, tripLengthDays - 1);

  const foodPerDayPerTraveler =
    input?.style === "foodie"
      ? 65
      : input?.style === "chill" || input?.style === "solo reset"
        ? 45
        : 50;

  const activitiesPerTravelerPerDay =
    input?.style === "adventure" || input?.style === "outdoors"
      ? 35
      : input?.style === "foodie"
        ? 20
        : 25;

  const hotelBase = isStaycation ? 0 : 150 * nights;
  const foodBase = foodPerDayPerTraveler * tripLengthDays * travelerCount;
  const gasBase = isStaycation ? 0 : Math.max(25, driveHours * 18);
  const activitiesBase = activitiesPerTravelerPerDay * travelerCount * tripLengthDays * 0.6;

  let hotel = roundToNearest5(Math.max(0, hotelBase));
  let food = roundToNearest5(Math.max(0, foodBase));
  let gas = roundToNearest5(Math.max(0, gasBase));
  let activities = roundToNearest5(Math.max(0, activitiesBase));

  let subtotal = hotel + food + gas + activities;

  if (estimatedCost > 0) {
    const scale = estimatedCost / Math.max(subtotal, 1);

    hotel = roundToNearest5(clamp(hotel * scale, 0, estimatedCost));
    food = roundToNearest5(clamp(food * scale, 0, estimatedCost));
    gas = roundToNearest5(clamp(gas * scale, 0, estimatedCost));
    activities = roundToNearest5(clamp(activities * scale, 0, estimatedCost));

    subtotal = hotel + food + gas + activities;
  }

  let misc = roundToNearest5(
    Math.max(estimatedCost > 0 ? 0 : 15, estimatedCost - subtotal)
  );

  let totalExpected = hotel + food + gas + activities + misc;

  if (estimatedCost > 0 && totalExpected !== estimatedCost) {
    const diff = estimatedCost - totalExpected;
    misc = roundToNearest5(Math.max(0, misc + diff));
    totalExpected = hotel + food + gas + activities + misc;
  }

  const totalLow = roundToNearest5(totalExpected * 0.9);
  const totalHigh = roundToNearest5(totalExpected * 1.15);

  return {
    hotel,
    food,
    gas,
    activities,
    misc,
    total: totalExpected,
    totalLow,
    totalExpected,
    totalHigh,
  };
}