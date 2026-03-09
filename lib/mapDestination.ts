import { Destination, RawDestination, TripInput, TripStyle } from "./types";

function deriveTripStylesFromScores(styleScores: Record<TripStyle, number>): TripStyle[] {
  return (Object.entries(styleScores) as [TripStyle, number][])
    .filter(([, score]) => score >= 2)
    .map(([style]) => style);
}

function mapCostLevel(
  costLevel: RawDestination["cost_level"]
): "low" | "medium" | "high" {
  if (costLevel === "low") return "low";
  if (costLevel === "high") return "high";
  return "medium";
}

function estimateHotelPrice(costLevel: RawDestination["cost_level"]): number {
  switch (costLevel) {
    case "high":
      return 260;
    case "mid":
      return 190;
    case "low_mid":
      return 155;
    case "low":
    default:
      return 120;
  }
}

function buildSummary(raw: RawDestination): string {
  const topHighlights = raw.anchor_experiences
    .slice(0, 2)
    .map((exp) => exp.title)
    .join(" and ");

  return `${raw.name} is a ${raw.vibes.join(", ")} getaway in ${raw.region} with highlights like ${topHighlights}.`;
}

export function mapRawDestination(
  raw: RawDestination,
  input: TripInput
): Destination {
  const startKey = input.startCity.toLowerCase();
  const driveHours = raw.drive_time_hours_from[startKey] ?? 999;

  return {
    name: raw.name,
    province: raw.region,
    driveHoursFromStart: driveHours,
    bestSeasons: raw.best_seasons,
    avoidSeasons: raw.avoid_seasons,
    tripStyles: deriveTripStylesFromScores(raw.style_scores),
    styleScores: raw.style_scores,
    budgetLevel: mapCostLevel(raw.cost_level),
    veganFriendly: false,
    summary: buildSummary(raw),
    topActivities: raw.anchor_experiences.map((exp) => ({
      name: exp.title,
      type: exp.type,
      costEstimate: 0,
      bookingLink: "",
    })),
    hotelOptions: [
      {
        name: raw.home_base_city,
        pricePerNight: estimateHotelPrice(raw.cost_level),
        bookingLink: "",
      }
    ],
    foodSpots: raw.neighborhoods.map((n) => ({
      name: n.name,
      tags: [n.reason],
      link: "",
    })),
    homeBaseCity: raw.home_base_city,
    rawVibes: raw.vibes,
    isStaycation: raw.is_staycation,
  };
}