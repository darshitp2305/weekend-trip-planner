/**
 * Helper module for prompt builder concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import { RankedDestination, TripInput } from "./types";
import { deriveTripIntentFromPrompt } from "./tripIntent";

export function buildTripPrompt(input: TripInput, trips: RankedDestination[]) {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);

  return `
You are a practical Alberta trip planner.

Use ONLY the provided destination data.
Do not invent destinations, businesses, restaurants, hotels, attractions, prices, or drive times.
Keep the writing realistic, concise, and helpful.

User preferences:
- Start city: ${input.startCity}
- Max drive hours: ${input.maxDriveHours}
- Budget: $${input.budget}
- Trip length: ${input.tripLengthDays} days
- Season: ${input.season}
- Trip style: ${input.style}
- Activity focus: ${input.activityFocus ?? "None"}
- Vegan-friendly only: ${input.veganFriendly ? "Yes" : "No"}
- Include staycations: ${input.includeStaycations ? "Yes" : "No"}
- Strict budget: ${input.strictBudget ? "Yes" : "No"}
- Hard constraints: ${JSON.stringify(promptIntent.hardConstraints)}
- Soft preferences: ${JSON.stringify(promptIntent.softPreferences)}

For each destination, provide:
- aiSummary: 1–2 sentence destination summary tailored to the user
- aiItinerary: array of short day-by-day itinerary bullets
- aiBudgetNote: short budget comment grounded in the estimate
- aiBestFit: one short sentence explaining why it fits this user

Destinations:
${JSON.stringify(
  trips.map((trip) => ({
    name: trip.name,
    homeBaseCity: trip.homeBaseCity,
    summary: trip.summary,
    estimatedCost: trip.estimatedCost,
    driveHoursFromStart: trip.driveHoursFromStart,
    matchReasons: trip.matchReasons,
    warnings: trip.warnings,
    topActivities: trip.topActivities.map((a) => a.name),
    bestSeasons: trip.bestSeasons,
    isStaycation: trip.isStaycation,
    budgetBreakdown: trip.budgetBreakdown,
  })),
  null,
  2
)}
`;
}
