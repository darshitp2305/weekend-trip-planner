import type { FoodSpot } from "./types";

type FoodPricingInput = Pick<FoodSpot, "category" | "tags" | "name" | "estimatedCost"> & {
  priceLevel?: string;
};

function normalizedFoodText(spot: FoodPricingInput) {
  return [spot.category, ...(spot.tags ?? []), spot.name]
    .join(" ")
    .toLowerCase();
}

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

export function estimateFoodCostPerTraveler(spot: FoodPricingInput) {
  if (typeof spot.estimatedCost === "number" && spot.estimatedCost > 0) {
    return spot.estimatedCost;
  }

  const text = normalizedFoodText(spot);
  const estimate = categoryBaseCost(text) + priceLevelAdjustment(spot.priceLevel);

  return Math.max(10, Math.round(estimate));
}

export function estimateFoodCostForGroup(
  spot: FoodPricingInput,
  travelers: number
) {
  return estimateFoodCostPerTraveler(spot) * Math.max(1, travelers);
}

export function estimateFoodCostRangeForGroup(
  spot: FoodPricingInput,
  travelers: number
) {
  const expected = estimateFoodCostForGroup(spot, travelers);
  const low = Math.max(8, Math.round(expected * 0.8));
  const high = Math.max(low + 4, Math.round(expected * 1.2));

  return { low, expected, high };
}

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
