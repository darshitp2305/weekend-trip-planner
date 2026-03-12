import type { BudgetBreakdown, RankedDestination, TripInput } from "./types";

type BudgetTripLike = {
  driveHoursFromStart?: number;
  estimatedCost?: number;
  liveDataSummary?: RankedDestination["liveDataSummary"];
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

  const driveHours = Math.max(0, trip.driveHoursFromStart ?? 0);
  const estimatedCost = Math.max(0, trip.estimatedCost ?? 0);

  const hotelBase =
    driveHours <= 0.5
      ? estimatedCost * 0.22
      : tripLengthDays >= 2
      ? estimatedCost * 0.38
      : estimatedCost * 0.3;

  const foodBase =
    input?.style === "foodie"
      ? estimatedCost * 0.3
      : input?.style === "chill" || input?.style === "solo reset"
      ? estimatedCost * 0.22
      : estimatedCost * 0.2;

  const gasBase =
    driveHours <= 0.5 ? estimatedCost * 0.04 : estimatedCost * 0.09 + driveHours * 8;

  const activitiesBase =
    input?.style === "adventure" || input?.style === "outdoors"
      ? estimatedCost * 0.16
      : input?.style === "foodie"
      ? estimatedCost * 0.08
      : estimatedCost * 0.1;

  let hotel = roundToNearest5(clamp(hotelBase, 0, estimatedCost));
  let food = roundToNearest5(clamp(foodBase, 0, estimatedCost));
  let gas = roundToNearest5(clamp(gasBase, 0, estimatedCost));
  let activities = roundToNearest5(clamp(activitiesBase, 0, estimatedCost));

  let subtotal = hotel + food + gas + activities;
  let misc = roundToNearest5(Math.max(15, estimatedCost - subtotal));

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