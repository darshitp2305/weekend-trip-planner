import { BudgetBreakdown, Destination } from "./types";

export function estimateTripBreakdown(
  destination: Destination,
  tripLengthDays: number
): BudgetBreakdown {
  const hotelPerNight = destination.hotelOptions[0]?.pricePerNight ?? 180;

  const foodPerDay =
    destination.budgetLevel === "high"
      ? 85
      : destination.budgetLevel === "medium"
      ? 65
      : 45;

  const gas = Math.round(destination.driveHoursFromStart * 30);

  const activities = destination.topActivities.reduce(
    (sum, activity) => sum + activity.costEstimate,
    0
  );

  const nights = Math.max(tripLengthDays - 1, 1);
  const hotel = hotelPerNight * nights;
  const food = foodPerDay * tripLengthDays;
  const total = hotel + food + gas + activities;

  return {
    hotel,
    food,
    gas,
    activities,
    total,
  };
}

export function estimateTripCost(
  destination: Destination,
  tripLengthDays: number
): number {
  return estimateTripBreakdown(destination, tripLengthDays).total;
}