import { deriveSeasonFromDateRange, deriveTripLengthDays } from "./tripDates";
import { isStartCity } from "./startCities";
import { deriveTripIntentFromPrompt } from "./tripIntent";
import {
  RankedDestination,
  TripInput,
  TripPlan,
  TripStyle,
} from "./types";

function asFiniteNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function inferStartCity(plan: TripPlan): TripInput["startCity"] {
  if (isStartCity(plan.startCity)) {
    return plan.startCity;
  }

  const raw = `${plan.routeSummary?.origin?.label ?? ""} ${plan.summary ?? ""}`.toLowerCase();
  if (raw.includes("calgary")) return "Calgary";
  return "Edmonton";
}

function inferTripStyle(plan: TripPlan): TripStyle {
  const prompt = plan.tripPrompt?.trim();
  if (prompt) {
    return deriveTripIntentFromPrompt(prompt).style;
  }

  const joined = [
    plan.summary,
    ...(plan.rawVibes ?? []),
    ...(plan.topActivities ?? []).map((activity) => `${activity.name} ${activity.type}`),
    ...(plan.foodSpots ?? []).map((spot) => `${spot.name} ${spot.category}`),
  ]
    .join(" ")
    .toLowerCase();

  if (["cafe", "bakery", "restaurant", "food", "brew"].some((term) => joined.includes(term))) {
    return "foodie";
  }
  if (
    [
      "iconic",
      "famous",
      "must see",
      "must-see",
      "landmark",
      "sightseeing",
      "gondola",
      "museum",
    ].some((term) => joined.includes(term))
  ) {
    return "must see";
  }
  if (["reset", "relax", "spa", "hot springs", "slow"].some((term) => joined.includes(term))) {
    return "chill";
  }
  if (["trail", "hike", "summit", "ridge", "gondola", "waterfall"].some((term) => joined.includes(term))) {
    return "outdoors";
  }

  return "adventure";
}

export function buildTripInputFromPlan(plan: TripPlan): TripInput {
  const travelerCount = Math.max(1, Math.round(asFiniteNumber(plan.travelerCount) ?? 1));
  const totalBudget = Math.max(
    0,
    Math.round(
      asFiniteNumber(plan.totalBudget) ??
        asFiniteNumber(plan.budgetBreakdown?.totalExpected) ??
        asFiniteNumber(plan.budgetBreakdown?.total) ??
        0
    )
  );
  const budgetPerTraveler = Math.max(
    1,
    Math.round(
      asFiniteNumber(plan.budgetPerTraveler) ??
        (totalBudget > 0 ? totalBudget / travelerCount : 300)
    )
  );
  const tripLengthDays = Math.max(
    1,
    Math.round(
      asFiniteNumber(plan.tripLengthDays) ??
        deriveTripLengthDays(plan.tripStartDate, plan.tripEndDate) ??
        plan.itineraryDays?.length ??
        2
    )
  );
  const promptIntent = deriveTripIntentFromPrompt(plan.tripPrompt ?? "");
  const maxDriveHours = Math.max(
    plan.isStaycation ? 0.5 : 1,
    Number(
      asFiniteNumber(plan.driveHoursFromStart) ??
        (typeof plan.routeSummary?.durationSeconds === "number"
          ? Math.round((plan.routeSummary.durationSeconds / 3600) * 10) / 10
          : 3)
    )
  );

  return {
    startCity: inferStartCity(plan),
    maxDriveHours,
    maxDriveMinutesBetweenStops: Math.max(
      15,
      Math.round(asFiniteNumber(plan.maxDriveMinutesBetweenStops) ?? 45)
    ),
    budget: totalBudget > 0 ? totalBudget : travelerCount * budgetPerTraveler,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    season: deriveSeasonFromDateRange(plan.tripStartDate, plan.tripEndDate),
    style: inferTripStyle(plan),
    tripPrompt: plan.tripPrompt,
    activityFocus: promptIntent.activityFocus,
    veganFriendly: promptIntent.veganFriendly,
    includeStaycations: Boolean(plan.isStaycation || promptIntent.includeStaycations),
    strictBudget: promptIntent.strictBudget,
    preferredDestination: plan.destinationName || plan.name,
    tripStartDate: plan.tripStartDate,
    tripEndDate: plan.tripEndDate,
    departureTime: plan.departureTime,
  };
}

export function rankedDestinationFromTripPlan(plan: TripPlan): RankedDestination {
  const style = inferTripStyle(plan);
  const estimatedCost = Math.round(
    asFiniteNumber(plan.budgetBreakdown?.totalExpected) ??
      asFiniteNumber(plan.budgetBreakdown?.total) ??
      asFiniteNumber(plan.totalBudget) ??
      0
  );

  return {
    name: plan.destinationName || plan.name || "Trip",
    province: plan.province || plan.region || "Canada",
    driveHoursFromStart: Number(
      asFiniteNumber(plan.driveHoursFromStart) ??
        (typeof plan.routeSummary?.durationSeconds === "number"
          ? Math.round((plan.routeSummary.durationSeconds / 3600) * 10) / 10
          : 0)
    ),
    bestSeasons: [],
    avoidSeasons: [],
    tripStyles: [style],
    styleScores: {
      chill: style === "chill" || style === "solo reset" ? 3 : 1,
      outdoors: style === "outdoors" ? 3 : 1,
      foodie: style === "foodie" ? 3 : 1,
      "solo reset": style === "solo reset" ? 3 : 1,
      adventure: style === "adventure" || style === "must see" ? 3 : 1,
    },
    budgetLevel:
      estimatedCost > 900 ? "high" : estimatedCost > 450 ? "medium" : "low",
    veganFriendly: deriveTripIntentFromPrompt(plan.tripPrompt ?? "").veganFriendly,
    summary: plan.summary,
    imageUrl: plan.imageUrl,
    imageUrlLight: plan.imageUrlLight,
    imageUrlDark: plan.imageUrlDark,
    latitude: plan.latitude,
    longitude: plan.longitude,
    topActivities: plan.topActivities ?? [],
    hotelOptions: plan.hotelOptions ?? [],
    foodSpots: plan.foodSpots ?? [],
    homeBaseCity: plan.homeBaseCity ?? plan.destinationName,
    rawVibes: plan.rawVibes ?? plan.tags ?? [],
    isStaycation: Boolean(plan.isStaycation),
    score: Number(asFiniteNumber(plan.score) ?? 0),
    estimatedCost,
    budgetBreakdown: plan.budgetBreakdown,
    matchReasons: [],
    warnings: [],
    styleMatchStrength: plan.styleMatchStrength ?? "medium",
    confidence: plan.confidence,
    liveDataSummary: plan.liveDataSummary,
    rankingReasons: plan.rankingReasons,
    aiSummary: plan.aiSummary,
    aiBudgetNote: plan.aiBudgetNote,
    aiBestFit: plan.aiBestFit,
    routeSummary: plan.routeSummary,
    sourceCheckedAt: plan.sourceCheckedAt,
    providerStatus: plan.providerStatus,
  };
}
