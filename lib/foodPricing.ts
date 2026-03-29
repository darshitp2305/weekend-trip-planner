/**
 * Helper module for food pricing concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import type { FoodSpot } from "./types";

type FoodPricingInput = Pick<FoodSpot, "category" | "tags" | "name" | "estimatedCost"> & {
  priceLevel?: string;
};

// Collapse the available text signals into one searchable string so the
// heuristic can stay simple and consistent across the app.
function normalizedFoodText(spot: FoodPricingInput) {
  return [spot.category, ...(spot.tags ?? []), spot.name]
    .join(" ")
    .toLowerCase();
}

// These are intentionally coarse buckets. The UI presents them as estimates,
// not live menu pricing, because provider data does not expose real menu totals.
function categoryBaseCost(text: string) {
  if (
    text.includes("cafe") ||
    text.includes("coffee") ||
    text.includes("bakery") ||
    text.includes("dessert")
  ) {
    return 14;
  }

  if (
    text.includes("breakfast") ||
    text.includes("brunch") ||
    text.includes("deli") ||
    text.includes("sandwich")
  ) {
    return 18;
  }

  if (
    text.includes("restaurant") ||
    text.includes("bistro") ||
    text.includes("kitchen") ||
    text.includes("bar") ||
    text.includes("grill") ||
    text.includes("steak") ||
    text.includes("tavern")
  ) {
    return 32;
  }

  return 22;
}

function priceLevelAdjustment(priceLevel?: string) {
  switch ((priceLevel ?? "").toUpperCase()) {
    case "PRICE_LEVEL_FREE":
      return -10;
    case "PRICE_LEVEL_INEXPENSIVE":
      return -4;
    case "PRICE_LEVEL_MODERATE":
      return 4;
    case "PRICE_LEVEL_EXPENSIVE":
      return 14;
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return 26;
    default:
      return 0;
  }
}

// Preserve any upstream estimate first, then fall back to our type + priceLevel
// heuristic so mapped places and stored trips behave the same way.
export function estimateFoodCostPerTraveler(spot: FoodPricingInput) {
  if (typeof spot.estimatedCost === "number" && spot.estimatedCost > 0) {
    return spot.estimatedCost;
  }

  const text = normalizedFoodText(spot);
  const estimate = categoryBaseCost(text) + priceLevelAdjustment(spot.priceLevel);

  return Math.max(10, Math.round(estimate));
}

// Builder cards and budget summaries reason in group totals, so this helper is
// the single place where per-traveler estimates become trip-level spend.
export function estimateFoodCostForGroup(
  spot: FoodPricingInput,
  travelers: number
) {
  return estimateFoodCostPerTraveler(spot) * Math.max(1, travelers);
}

// Show a band instead of a fake exact number to make the heuristic nature of
// the estimate clear in the UI.
export function estimateFoodCostRangeForGroup(
  spot: FoodPricingInput,
  travelers: number
) {
  const expected = estimateFoodCostForGroup(spot, travelers);
  const low = Math.max(8, Math.round(expected * 0.8));
  const high = Math.max(low + 4, Math.round(expected * 1.2));

  return { low, expected, high };
}

// Keep the UI copy honest about where the estimate came from.
export function foodPricingSourceLabel(spot: FoodPricingInput) {
  const category = spot.category?.trim();

  if (spot.priceLevel) {
    return category
      ? `Estimated from Google price level and ${category.toLowerCase()} type.`
      : "Estimated from Google price level and venue type.";
  }

  if (category) {
    return `Estimated from ${category.toLowerCase()} type.`;
  }

  return "Estimated from venue type.";
}
