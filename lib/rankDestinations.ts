import rawDestinations from "../data/destinations.json";
import { RankedDestination, RawDestination, TripInput } from "./types";
import { estimateTripBreakdown } from "./budgetEstimator";
import { mapRawDestination } from "./mapDestination";

function getStyleMatchStrength(score: number): "strong" | "medium" | "weak" | "poor" {
  if (score >= 3) return "strong";
  if (score === 2) return "medium";
  if (score === 1) return "weak";
  return "poor";
}

function shouldSoftenStaycationPenalty(input: TripInput): boolean {
  return input.maxDriveHours <= 2 || input.budget <= 350 || input.tripLengthDays <= 2;
}

export function rankDestinations(input: TripInput): RankedDestination[] {
  const destinationList = (rawDestinations as RawDestination[])
    .filter((raw) => input.includeStaycations || !raw.is_staycation)
    .map((raw) => mapRawDestination(raw, input));

  const ranked = destinationList
    .filter((destination) => destination.driveHoursFromStart <= input.maxDriveHours)
    .map((destination) => {
      let score = 0;
      const matchReasons: string[] = [];
      const warnings: string[] = [];

      const styleScore = destination.styleScores[input.style];
      const styleMatchStrength = getStyleMatchStrength(styleScore);

      if (styleScore === 3) {
        score += 35;
        matchReasons.push(`Strong ${input.style} match`);
      } else if (styleScore === 2) {
        score += 20;
        matchReasons.push(`Good ${input.style} match`);
      } else if (styleScore === 1) {
        score += 5;
        matchReasons.push(`Some ${input.style} appeal`);
      } else {
        score -= 15;
        warnings.push(`Weak fit for ${input.style} travel`);
      }

      if (destination.bestSeasons.includes(input.season)) {
        score += 25;
        matchReasons.push(`Good fit for ${input.season} travel`);
      }

      if (destination.avoidSeasons.includes(input.season)) {
        score -= 30;
        warnings.push(`This destination is weaker in ${input.season}`);
      }

      const driveSlack = input.maxDriveHours - destination.driveHoursFromStart;
      if (driveSlack >= 0) {
        const closenessBonus = Math.max(0, Math.round(driveSlack * 4));
        score += 15 + closenessBonus;
        matchReasons.push(`${destination.driveHoursFromStart} hours from ${input.startCity}`);
      }

      const budgetBreakdown = estimateTripBreakdown(destination, input.tripLengthDays);
      const estimatedCost = budgetBreakdown.total;
      const overBudget = estimatedCost - input.budget;

      if (estimatedCost <= input.budget) {
        score += 20;
        matchReasons.push(`Estimated under your $${input.budget} budget`);
      } else {
        if (input.strictBudget) {
          score -= 999;
          warnings.push(`Over your strict budget by about $${overBudget}`);
        } else {
          if (overBudget <= 75) {
            score -= 10;
            warnings.push(`Slightly over your budget by about $${overBudget}`);
          } else if (overBudget <= 150) {
            score -= 22;
            warnings.push(`Over your budget by about $${overBudget}`);
          } else if (overBudget <= 250) {
            score -= 35;
            warnings.push(`Well over your budget by about $${overBudget}`);
          } else {
            score -= 50;
            warnings.push(`Far over your budget by about $${overBudget}`);
          }
        }
      }

      if (destination.isStaycation) {
        if (shouldSoftenStaycationPenalty(input)) {
          score -= 4;
          warnings.push("Staycation result kept because your constraints are tight");
        } else {
          score -= 16;
          warnings.push("Staycation result slightly deprioritized for broader trip search");
        }
      }

      if (input.veganFriendly) {
        if (destination.veganFriendly) {
          score += 10;
          matchReasons.push("Supports vegan-friendly travel");
        } else {
          score -= 8;
          warnings.push("Vegan-friendly options are not confirmed yet");
        }
      }

      if (input.tripLengthDays <= 2 && destination.driveHoursFromStart >= 4.5) {
        score -= 8;
        warnings.push("Longer drive for a short trip");
      }

      return {
        ...destination,
        score,
        estimatedCost,
        budgetBreakdown,
        matchReasons,
        warnings,
        styleMatchStrength,
      };
    })
    .filter((destination) => {
      if (!input.strictBudget) return true;
      return destination.estimatedCost <= input.budget;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return ranked;
}