import rawDestinations from "../data/destinations.json";
import {
  ActivityFocus,
  ConfidenceLevel,
  RankedDestination,
  RankingReason,
  RawDestination,
  TripInput,
} from "./types";
import { estimateBudgetBreakdown } from "./budgetEstimator";
import { mapRawDestination } from "./mapDestination";
import { deriveTripIntentFromPrompt } from "./tripIntent";

type ReasonCandidate = RankingReason & {
  priority: number;
  weight: number;
};

type MappedDestination = ReturnType<typeof mapRawDestination>;

export type NoMatchDiagnostics = {
  headline: string;
  reasons: string[];
};

function getStyleMatchStrength(
  score: number
): "strong" | "medium" | "weak" | "poor" {
  if (score >= 3) return "strong";
  if (score === 2) return "medium";
  if (score === 1) return "weak";
  return "poor";
}

function formatMoney(value: number): string {
  return `$${Math.round(value)}`;
}

function dedupeStrings(items: string[]): string[] {
  return Array.from(new Set(items));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeSearchText(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function destinationMatchesPreference(
  destination: ReturnType<typeof mapRawDestination>,
  preferredDestination?: string
): boolean {
  const query = normalizeSearchText(preferredDestination);
  if (!query) return true;

  const destinationText = normalizeSearchText(
    [
      destination.name,
      destination.homeBaseCity,
      destination.summary,
      ...(destination.rawVibes ?? []),
    ].join(" ")
  );

  if (!destinationText) return false;
  if (destinationText.includes(query)) return true;

  const queryTokens = query.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return false;

  return queryTokens.every((token) => destinationText.includes(token));
}

function getJoinedSignals(destination: ReturnType<typeof mapRawDestination>): string {
  return [
    destination.name,
    destination.summary,
    ...(destination.rawVibes ?? []),
    ...((destination.topActivities ?? []).map((a) => a.name)),
    ...((destination.topActivities ?? []).map((a) => a.type)),
    ...((destination.foodSpots ?? []).map((f) => f.name)),
    ...((destination.foodSpots ?? []).flatMap((f) => f.tags ?? [])),
  ]
    .join(" ")
    .toLowerCase();
}

function countMatches(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => {
    return count + (text.includes(keyword.toLowerCase()) ? 1 : 0);
  }, 0);
}

function getAdventureSignal(destination: ReturnType<typeof mapRawDestination>): number {
  const text = getJoinedSignals(destination);

  const strongKeywords = [
    "adventure",
    "mountain",
    "hike",
    "hiking",
    "trail",
    "gondola",
    "summit",
    "viewpoint",
    "nature",
    "lake",
    "canyon",
    "badlands",
    "hot springs",
    "hot_springs",
    "ski",
    "climb",
    "outdoor",
  ];

  const weakKeywords = ["culture", "museum", "city", "nightlife", "shopping"];

  return countMatches(text, strongKeywords) - 0.5 * countMatches(text, weakKeywords);
}

function getFoodieSignal(destination: ReturnType<typeof mapRawDestination>): number {
  const text = getJoinedSignals(destination);

  const strongKeywords = [
    "food",
    "foodie",
    "restaurant",
    "brunch",
    "cafe",
    "coffee",
    "market",
    "culinary",
    "downtown",
    "culture",
  ];

  const weakKeywords = ["trail", "hike", "camp", "ski"];

  return countMatches(text, strongKeywords) - 0.5 * countMatches(text, weakKeywords);
}

function getCalmSignal(destination: ReturnType<typeof mapRawDestination>): number {
  const text = getJoinedSignals(destination);

  const strongKeywords = [
    "relax",
    "quiet",
    "wellness",
    "reset",
    "scenic",
    "nature",
    "lake",
    "spa",
    "hot springs",
    "hot_springs",
    "viewpoint",
  ];

  const weakKeywords = ["nightlife", "party", "crowd", "adventure"];

  return countMatches(text, strongKeywords) - 0.5 * countMatches(text, weakKeywords);
}

function getHiddenGemSignal(destination: ReturnType<typeof mapRawDestination>): number {
  const text = getJoinedSignals(destination);

  const strongKeywords = [
    "hidden",
    "quiet",
    "small town",
    "local",
    "scenic",
    "heritage",
    "charming",
    "quaint",
    "badlands",
    "canyon",
    "lesser known",
    "underrated",
    "viewpoint",
  ];

  const weakKeywords = [
    "nightlife",
    "party",
    "downtown",
    "city",
    "crowd",
    "busy",
    "popular",
  ];

  let signal =
    countMatches(text, strongKeywords) - 0.5 * countMatches(text, weakKeywords);

  if (!destination.isStaycation) {
    signal += 0.75;
  }

  if (destination.driveHoursFromStart >= 1.5 && destination.driveHoursFromStart <= 5) {
    signal += 0.5;
  }

  return signal;
}

function getRequestedStyleScore(
  destination: ReturnType<typeof mapRawDestination>,
  style: TripInput["style"]
): number {
  if (style === "hidden gems") {
    const hiddenGemSignal = getHiddenGemSignal(destination);
    if (hiddenGemSignal >= 4.5) return 3;
    if (hiddenGemSignal >= 2.5) return 2;
    if (hiddenGemSignal >= 1) return 1;
    return 0;
  }

  return destination.styleScores[style];
}

function getActivityFocusSignal(
  destination: MappedDestination,
  activityFocus?: ActivityFocus
): number {
  if (!activityFocus) return 0;

  const text = getJoinedSignals(destination);

  if (activityFocus === "skiing") {
    return countMatches(text, [
      "ski",
      "skiing",
      "snowboard",
      "snowboarding",
      "winter fun",
      "winter_fun",
      "nordic",
      "mountain",
    ]);
  }

  if (activityFocus === "hiking") {
    return (
      countMatches(text, [
        "hike",
        "hiking",
        "trail",
        "peak",
        "ridge",
        "summit",
        "scramble",
        "alpine",
        "mountain",
        "canyon",
        "lake",
        "waterfall",
      ]) -
      countMatches(text, ["trailhead", "viewpoint"])
    );
  }

  return countMatches(text, [
    "camp",
    "camping",
    "campground",
    "campsite",
    "provincial park",
    "national park",
    "rv park",
    "lake",
    "park",
  ]);
}

function getGetawaySignal(destination: ReturnType<typeof mapRawDestination>): number {
  if (destination.isStaycation) return 0;

  const text = getJoinedSignals(destination);
  const keywords = [
    "mountain",
    "lake",
    "scenic",
    "nature",
    "retreat",
    "cabin",
    "hot springs",
    "hot_springs",
    "viewpoint",
    "national park",
    "park",
    "badlands",
  ];

  return countMatches(text, keywords);
}

function getVeganSignal(destination: ReturnType<typeof mapRawDestination>): number {
  if (destination.veganFriendly) return 2;

  const text = getJoinedSignals(destination);
  const weakPositive = ["cafe", "downtown", "city", "food"];
  return countMatches(text, weakPositive) >= 2 ? 1 : 0;
}

function getScenicSignal(destination: MappedDestination): number {
  return countMatches(getJoinedSignals(destination), [
    "scenic",
    "view",
    "viewpoint",
    "lookout",
    "lake",
    "mountain",
    "canyon",
    "waterfall",
    "ridge",
    "summit",
  ]);
}

function getMountainHikeSignal(destination: MappedDestination): number {
  const text = getJoinedSignals(destination);

  return (
    countMatches(text, [
      "hike",
      "hiking",
      "trail",
      "summit",
      "peak",
      "ridge",
      "scramble",
      "alpine",
      "mountain",
      "canyon",
      "lake",
    ]) +
    countMatches(text, ["summit", "peak", "ridge", "scramble"]) -
    countMatches(text, ["trailhead", "viewpoint"])
  );
}

function getSummitSpecificSignal(destination: MappedDestination): number {
  return countMatches(getJoinedSignals(destination), [
    "summit",
    "peak",
    "ridge",
    "scramble",
    "alpine",
    "mountain",
    "mountains",
    "rockies",
    "foothills",
  ]);
}

function hasConvincingSummitHikeAnchor(destination: MappedDestination): boolean {
  const text = getJoinedSignals(destination);
  const summitSpecificSignal = getSummitSpecificSignal(destination);
  const mountainHikeSignal = getMountainHikeSignal(destination);
  const scenicSignal = getScenicSignal(destination);
  const hasTrailOnlySignal =
    countMatches(text, ["trailhead", "viewpoint"]) >= 1 &&
    summitSpecificSignal < 2;

  if (hasTrailOnlySignal) return false;

  return (
    summitSpecificSignal >= 2 &&
    mountainHikeSignal >= 4 &&
    scenicSignal >= 2
  );
}

function getVegetarianFoodSignal(destination: MappedDestination): number {
  if (destination.veganFriendly) return 4;

  return countMatches(getJoinedSignals(destination), [
    "restaurant",
    "restaurants",
    "cafe",
    "cafes",
    "coffee",
    "bakery",
    "food",
    "foodie",
    "downtown",
    "market",
  ]);
}

function tinyDeterministicTieBreaker(name: string): number {
  let total = 0;
  for (let i = 0; i < name.length; i += 1) {
    total += name.charCodeAt(i) * (i + 1);
  }
  return (total % 97) / 1000;
}

function passesHardFilters(
  destination: MappedDestination,
  input: TripInput,
  estimatedCost: number
): { passed: boolean; reason?: string } {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);

  if (destination.driveHoursFromStart > input.maxDriveHours) {
    return { passed: false, reason: "Drive time exceeds your max limit" };
  }

  if (!input.includeStaycations && destination.isStaycation) {
    return { passed: false, reason: "Staycations excluded" };
  }

  if (destination.avoidSeasons.includes(input.season)) {
    return { passed: false, reason: `Poor fit for ${input.season}` };
  }

  if (input.strictBudget && estimatedCost > input.budget) {
    return {
      passed: false,
      reason: `Exceeds your strict budget by about ${formatMoney(
        estimatedCost - input.budget
      )}`,
    };
  }

  if (
    promptIntent.hardConstraints.activityAnchor === "summit_hike" &&
    !hasConvincingSummitHikeAnchor(destination)
  ) {
    return {
      passed: false,
      reason: "Does not show a convincing mountain summit-hike anchor",
    };
  }

  return { passed: true };
}

function estimateDestinationCost(
  destination: MappedDestination,
  input: TripInput
): number {
  const travelerCount = Math.max(1, input.travelerCount);
  const nights = Math.max(1, input.tripLengthDays - 1);
  const nightlyHotel = destination.isStaycation
    ? 0
    : destination.hotelOptions?.[0]?.pricePerNight ?? 150;

  const foodPerDayPerTraveler =
    input.style === "foodie"
      ? 65
      : input.style === "chill" || input.style === "solo reset"
        ? 45
        : 50;

  const activitiesSeedPerTraveler = (destination.topActivities ?? [])
    .slice(0, 2)
    .reduce((sum, activity) => sum + (activity.costEstimate ?? 25), 0);

  const gasSeed =
    destination.driveHoursFromStart <= 0.5
      ? 0
      : Math.round(destination.driveHoursFromStart * 18);

  const seededDestination = {
    ...destination,
    estimatedCost:
      nightlyHotel * nights +
      foodPerDayPerTraveler * input.tripLengthDays * travelerCount +
      activitiesSeedPerTraveler * travelerCount +
      gasSeed,
  };

  const budgetBreakdown = estimateBudgetBreakdown(seededDestination, input);
  return budgetBreakdown.totalExpected ?? budgetBreakdown.total;
}

function joinReasons(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function explainPreferredDestinationNoMatch(
  matchedDestinations: MappedDestination[],
  input: TripInput
): NoMatchDiagnostics {
  const reasons = new Set<string>();

  for (const destination of matchedDestinations) {
    const estimatedCost = estimateDestinationCost(destination, input);

    if (destination.driveHoursFromStart > input.maxDriveHours) {
      reasons.add(
        `${destination.name} is about ${destination.driveHoursFromStart} hours away, above your ${input.maxDriveHours}-hour drive limit`
      );
    }

    if (!input.includeStaycations && destination.isStaycation) {
      reasons.add(`${destination.name} is treated as a local/staycation-style option and does not fit the current trip setup`);
    }

    if (destination.avoidSeasons.includes(input.season)) {
      reasons.add(`${destination.name} is marked as a poor fit for ${input.season}`);
    }

    if (input.strictBudget && estimatedCost > input.budget) {
      reasons.add(
        `${destination.name} is estimated around ${formatMoney(estimatedCost)}, above your strict ${formatMoney(input.budget)} budget`
      );
    }
  }

  const preferredDestination = input.preferredDestination?.trim() ?? "that destination";

  if (reasons.size === 0) {
    return {
      headline: `Trippify found ${preferredDestination}, but it does not fit the current trip constraints.`,
      reasons: [
        `Try increasing drive time, loosening budget rules, or changing dates.`,
      ],
    };
  }

  return {
    headline: `Trippify found ${preferredDestination}, but it could not build it with the current trip constraints.`,
    reasons: Array.from(reasons),
  };
}

export function getNoMatchDiagnostics(
  input: TripInput,
  options?: { excludedDestinationNames?: string[] }
): NoMatchDiagnostics {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const excludedDestinationNames = new Set(
    (options?.excludedDestinationNames ?? [])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );

  const allDestinations = (rawDestinations as RawDestination[])
    .map((raw) => mapRawDestination(raw, input))
    .filter(
      (destination) =>
        !excludedDestinationNames.has(destination.name.trim().toLowerCase())
    );

  if (input.preferredDestination?.trim()) {
    const matchedDestinations = allDestinations.filter((destination) =>
      destinationMatchesPreference(destination, input.preferredDestination)
    );

    if (matchedDestinations.length === 0) {
      return {
        headline: `Trippify could not find "${input.preferredDestination.trim()}" in the current destination list.`,
        reasons: [
          "Try a nearby city name, a broader destination name, or leave the destination field blank to see ranked matches.",
        ],
      };
    }

    return explainPreferredDestinationNoMatch(matchedDestinations, input);
  }

  const allWithCosts = allDestinations.map((destination) => ({
    destination,
    estimatedCost: estimateDestinationCost(destination, input),
  }));

  const withinDrive = allWithCosts.filter(
    ({ destination }) => destination.driveHoursFromStart <= input.maxDriveHours
  );
  const withinBudget = allWithCosts.filter(
    ({ estimatedCost }) => !input.strictBudget || estimatedCost <= input.budget
  );
  const inSeason = allWithCosts.filter(
    ({ destination }) => !destination.avoidSeasons.includes(input.season)
  );
  const allowedStaycations = allWithCosts.filter(
    ({ destination }) => input.includeStaycations || !destination.isStaycation
  );
  const summitHikeMatches = allWithCosts.filter(
    ({ destination }) =>
      promptIntent.hardConstraints.activityAnchor !== "summit_hike" ||
      hasConvincingSummitHikeAnchor(destination)
  );

  const blockers: string[] = [];

  if (withinDrive.length === 0) {
    blockers.push(`no destinations are within your ${input.maxDriveHours}-hour drive limit`);
  }

  if (input.strictBudget && withinBudget.length === 0) {
    blockers.push(`none of the destinations fit your strict ${formatMoney(input.budget)} budget`);
  }

  if (inSeason.length === 0) {
    blockers.push(`the current destinations are marked as poor fits for ${input.season}`);
  }

  if (!input.includeStaycations && allowedStaycations.length === 0) {
    blockers.push("the remaining options are local/staycation-style trips");
  }

  if (
    promptIntent.hardConstraints.activityAnchor === "summit_hike" &&
    summitHikeMatches.length === 0
  ) {
    blockers.push(
      "none of the available destinations show a convincing mountain summit-hike anchor for this brief"
    );
  }

  if (
    promptIntent.hardConstraints.activityAnchor === "summit_hike" &&
    summitHikeMatches.length === 0
  ) {
    const summitSuggestionParts: string[] = [];

    if (input.budget <= 700) {
      summitSuggestionParts.push(
        "increase the total budget or lower the traveler count"
      );
    }

    if (input.maxDriveHours <= 5) {
      summitSuggestionParts.push("allow a longer drive");
    }

    if (promptIntent.hardConstraints.hikeDistanceKmTarget) {
      summitSuggestionParts.push(
        "relax the exact hike-length requirement"
      );
    }

    summitSuggestionParts.push(
      "or keep the budget and switch to a scenic non-summit hiking trip"
    );

    return {
      headline:
        "Trippify could not find a convincing mountain summit-hike match for the current filters.",
      reasons: [
        `Try one of these next: ${joinReasons(summitSuggestionParts)}.`,
      ],
    };
  }

  if (blockers.length === 0) {
    return {
      headline: "Trippify could not find a destination match for the current filters.",
      reasons: ["Try increasing drive time, relaxing strict budget, changing dates, or broadening the trip style."],
    };
  }

  return {
    headline: "Trippify could not find a destination match for the current filters.",
    reasons: [`The strongest blocker is that ${joinReasons(blockers)}.`],
  };
}

function calculateStyleScore(
  destination: MappedDestination,
  input: TripInput
): { score: number; matchReasons: string[]; warnings: string[] } {
  const matchReasons: string[] = [];
  const warnings: string[] = [];

  const styleScore = getRequestedStyleScore(destination, input.style);

  if (styleScore === 3) {
    matchReasons.push(`Strong ${input.style} match`);
    return { score: 52, matchReasons, warnings };
  }

  if (styleScore === 2) {
    matchReasons.push(`Good ${input.style} match`);
    return { score: 24, matchReasons, warnings };
  }

  if (styleScore === 1) {
    warnings.push(`Only a partial fit for ${input.style} travel`);
    return { score: -14, matchReasons, warnings };
  }

  warnings.push(`Weak fit for ${input.style} travel`);
  return { score: -34, matchReasons, warnings };
}

function calculateStyleResolutionScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  rankingReasons: RankingReason[];
  resolutionSignal: number;
} {
  const rankingReasons: RankingReason[] = [];
  let rawSignal = 0;

  if (input.style === "adventure" || input.style === "outdoors") {
    rawSignal = getAdventureSignal(destination);

    if (rawSignal >= 5) {
      rankingReasons.push({
        label: "Richer outdoor/adventure signal than similar alternatives",
        impact: "positive",
      });
    } else if (rawSignal <= 1) {
      rankingReasons.push({
        label: "Adventure signal is thinner than ideal",
        impact: "negative",
      });
    }
  } else if (input.style === "foodie") {
    rawSignal = getFoodieSignal(destination);

    if (rawSignal >= 4) {
      rankingReasons.push({
        label: "Richer foodie signal than similar alternatives",
        impact: "positive",
      });
    } else if (rawSignal <= 1) {
      rankingReasons.push({
        label: "Food signal is thinner than ideal",
        impact: "negative",
      });
    }
  } else if (input.style === "solo reset" || input.style === "chill") {
    rawSignal = getCalmSignal(destination);

    if (rawSignal >= 4) {
      rankingReasons.push({
        label: "Stronger calm/reset signal than similar alternatives",
        impact: "positive",
      });
    } else if (rawSignal <= 1) {
      rankingReasons.push({
        label: "Less calm than ideal for this style",
        impact: "negative",
      });
    }
  } else if (input.style === "hidden gems") {
    rawSignal = getHiddenGemSignal(destination);

    if (rawSignal >= 4) {
      rankingReasons.push({
        label: "Feels more distinctive and under-the-radar than common picks",
        impact: "positive",
      });
    } else if (rawSignal <= 1) {
      rankingReasons.push({
        label: "Feels more mainstream than a true hidden-gem pick",
        impact: "negative",
      });
    }
  }

  const score = clamp(rawSignal * 2.2, -8, 14);
  return { score: round2(score), rankingReasons, resolutionSignal: rawSignal };
}

function calculateActivityFocusScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  rankingReasons: RankingReason[];
} {
  if (!input.activityFocus) {
    return { score: 0, rankingReasons: [] };
  }

  const signal = getActivityFocusSignal(destination, input.activityFocus);

  if (signal >= 4) {
    return {
      score: 16,
      rankingReasons: [
        {
          label: `Especially strong ${input.activityFocus} fit`,
          impact: "positive",
        },
      ],
    };
  }

  if (signal >= 2) {
    return {
      score: 8,
      rankingReasons: [
        {
          label: `Good ${input.activityFocus} signal`,
          impact: "positive",
        },
      ],
    };
  }

  return {
    score: -8,
    rankingReasons: [
      {
        label: `${input.activityFocus[0].toUpperCase()}${input.activityFocus.slice(1)} options look thinner here`,
        impact: "negative",
      },
    ],
  };
}

function calculatePromptConstraintScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  matchReasons: string[];
  warnings: string[];
  rankingReasons: RankingReason[];
  hardConstraintCount: number;
  hardConstraintMisses: number;
  promptConstraintStrength: number;
} {
  const promptIntent = deriveTripIntentFromPrompt(input.tripPrompt);
  const matchReasons: string[] = [];
  const warnings: string[] = [];
  const rankingReasons: RankingReason[] = [];

  let score = 0;
  let hardConstraintCount = 0;
  let hardConstraintMisses = 0;
  let promptConstraintStrength = 0;

  const mountainHikeSignal = getMountainHikeSignal(destination);
  const summitSpecificSignal = getSummitSpecificSignal(destination);
  const scenicSignal = getScenicSignal(destination);
  const vegetarianSignal = getVegetarianFoodSignal(destination);
  const foodieSignal = getFoodieSignal(destination);
  const getawaySignal = getGetawaySignal(destination);

  if (promptIntent.hardConstraints.activityAnchor === "summit_hike") {
    hardConstraintCount += 1;

    if (hasConvincingSummitHikeAnchor(destination) && mountainHikeSignal >= 6) {
      score += 18;
      promptConstraintStrength += 6;
      matchReasons.push("Matches the summit-hike brief better");
      rankingReasons.push({
        label: "Better fit for a summit-style hike",
        impact: "positive",
      });
    } else if (hasConvincingSummitHikeAnchor(destination) && mountainHikeSignal >= 4) {
      score += 10;
      promptConstraintStrength += 4;
      matchReasons.push("Promising mountain-hike signal");
      rankingReasons.push({
        label: "Promising fit for a summit-oriented hike",
        impact: "positive",
      });
    } else if (mountainHikeSignal >= 2 || summitSpecificSignal >= 1) {
      score -= 4;
      promptConstraintStrength += 2;
      warnings.push("Hiking signal exists, but summit specificity is thinner");
      rankingReasons.push({
        label: "Hiking exists here, but summit specificity is weaker",
        impact: "neutral",
      });
    } else {
      score -= 18;
      hardConstraintMisses += 1;
      warnings.push("Static data does not show a convincing summit-hike anchor");
      rankingReasons.push({
        label: "Misses the summit-hike brief in static data",
        impact: "negative",
      });
    }
  }

  if (promptIntent.hardConstraints.hikeDistanceKmTarget) {
    hardConstraintCount += 1;

    if (mountainHikeSignal >= 5) {
      score += 6;
      promptConstraintStrength += 3;
      matchReasons.push("Better shot at a real half-day hike");
    } else if (mountainHikeSignal >= 3) {
      score += 1;
      promptConstraintStrength += 1;
      warnings.push("Hike distance target still needs live verification");
    } else {
      score -= 6;
      hardConstraintMisses += 1;
      warnings.push("Static data is thin for the requested hike length");
    }
  }

  if (promptIntent.hardConstraints.requiresScenicView) {
    hardConstraintCount += 1;

    if (scenicSignal >= 4) {
      score += 10;
      promptConstraintStrength += 4;
      matchReasons.push("Strong scenic payoff signal");
      rankingReasons.push({
        label: "Stronger scenic payoff signal",
        impact: "positive",
      });
    } else if (scenicSignal >= 2) {
      score += 4;
      promptConstraintStrength += 2;
      warnings.push("Scenic payoff looks possible, but not strongly proven");
    } else {
      score -= 10;
      hardConstraintMisses += 1;
      warnings.push("Scenic payoff is weaker than requested");
      rankingReasons.push({
        label: "Scenic payoff is weaker than requested",
        impact: "negative",
      });
    }
  }

  if (promptIntent.hardConstraints.requiresVegetarianOptions) {
    hardConstraintCount += 1;

    if (vegetarianSignal >= 4) {
      score += 10;
      promptConstraintStrength += 4;
      matchReasons.push("Food signal supports vegetarian planning");
      rankingReasons.push({
        label: "Food support looks stronger for vegetarian planning",
        impact: "positive",
      });
    } else if (vegetarianSignal >= 2) {
      score += 3;
      promptConstraintStrength += 2;
      warnings.push("Vegetarian support looks possible, but not strongly proven");
    } else {
      score -= 10;
      hardConstraintMisses += 1;
      warnings.push("Vegetarian-friendly food support is not strongly confirmed");
      rankingReasons.push({
        label: "Vegetarian support is not strongly confirmed",
        impact: "negative",
      });
    }

    if (promptIntent.hardConstraints.mixedDietGroup && foodieSignal >= 2) {
      score += 4;
      promptConstraintStrength += 1;
      matchReasons.push("Food options look better for a mixed-diet group");
    }
  }

  if (promptIntent.softPreferences.wantsGoodFood) {
    if (foodieSignal >= 4) {
      score += 6;
      rankingReasons.push({
        label: "Food signal rounds out the trip brief well",
        impact: "positive",
      });
    } else if (foodieSignal >= 2) {
      score += 2;
    } else {
      score -= 3;
      warnings.push("Food side of the brief looks thinner here");
    }
  }

  if (promptIntent.softPreferences.wantsGetawayFeel) {
    if (!destination.isStaycation && getawaySignal >= 4) {
      score += 5;
      rankingReasons.push({
        label: "Feels more like a real getaway",
        impact: "positive",
      });
    } else if (destination.isStaycation) {
      score -= 4;
      warnings.push("This reads more like a home-base option than a true getaway");
    }
  }

  return {
    score: round2(score),
    matchReasons,
    warnings,
    rankingReasons,
    hardConstraintCount,
    hardConstraintMisses,
    promptConstraintStrength,
  };
}

function calculateSeasonScore(
  destination: MappedDestination,
  input: TripInput
): { score: number; matchReasons: string[] } {
  const matchReasons: string[] = [];

  if (destination.bestSeasons.includes(input.season)) {
    matchReasons.push(`Good fit for ${input.season} travel`);
    return { score: 12, matchReasons };
  }

  return { score: 0, matchReasons };
}

function calculateDriveScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  matchReasons: string[];
  warnings: string[];
  ratio: number;
} {
  const matchReasons: string[] = [];
  const warnings: string[] = [];

  const ratio =
    input.maxDriveHours > 0
      ? destination.driveHoursFromStart / input.maxDriveHours
      : 1;

  const comfortScore = clamp((1 - ratio) * 12, -10, 8);

  if (ratio <= 0.45) {
    matchReasons.push(`Easy drive from ${input.startCity}`);
  } else if (ratio <= 0.75) {
    matchReasons.push(`Reasonable drive from ${input.startCity}`);
  } else {
    warnings.push("Near your drive limit");
  }

  return {
    score: round2(comfortScore),
    matchReasons,
    warnings,
    ratio,
  };
}

function calculateBudgetScore(
  estimatedCost: number,
  input: TripInput
): {
  score: number;
  matchReasons: string[];
  warnings: string[];
  ratio: number;
} {
  const matchReasons: string[] = [];
  const warnings: string[] = [];

  if (input.budget <= 0) {
    return { score: 0, matchReasons, warnings, ratio: 1 };
  }

  const ratio = estimatedCost / input.budget;
  const overBudget = estimatedCost - input.budget;

  let score = 0;

  if (ratio <= 1) {
    score = clamp((1 - ratio) * 18, 0, 12);
  } else {
    score = clamp(-8 - (ratio - 1) * 35, -40, -8);
  }

  if (ratio <= 0.75) {
    matchReasons.push(`Comfortably within your ${formatMoney(input.budget)} budget`);
  } else if (ratio <= 1) {
    matchReasons.push(`Within your ${formatMoney(input.budget)} budget`);
    warnings.push("Near your budget limit");
  } else if (overBudget <= 100) {
    warnings.push(`Slightly over budget by about ${formatMoney(overBudget)}`);
  } else {
    warnings.push(`Over budget by about ${formatMoney(overBudget)}`);
  }

  return {
    score: round2(score),
    matchReasons,
    warnings,
    ratio,
  };
}

function calculateVeganScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  matchReasons: string[];
  warnings: string[];
  rankingReasons: RankingReason[];
  veganSignal: number;
} {
  const matchReasons: string[] = [];
  const warnings: string[] = [];
  const rankingReasons: RankingReason[] = [];

  if (!input.veganFriendly) {
    return { score: 0, matchReasons, warnings, rankingReasons, veganSignal: 0 };
  }

  const veganSignal = getVeganSignal(destination);

  if (veganSignal >= 2) {
    matchReasons.push("Supports vegan-friendly travel");
    rankingReasons.push({
      label: "Better vegan support than weaker alternatives",
      impact: "positive",
    });
    return { score: 14, matchReasons, warnings, rankingReasons, veganSignal };
  }

  if (veganSignal === 1) {
    warnings.push("Vegan support looks possible but not strongly confirmed");
    rankingReasons.push({
      label: "Vegan support is only moderate",
      impact: "neutral",
    });
    return { score: -4, matchReasons, warnings, rankingReasons, veganSignal };
  }

  warnings.push("Vegan-friendly options are not strongly confirmed");
  rankingReasons.push({
    label: "Vegan support is weaker than ideal",
    impact: "negative",
  });
  return { score: -18, matchReasons, warnings, rankingReasons, veganSignal };
}

function calculateStaycationAdjustment(
  destination: MappedDestination,
  input: TripInput
): { score: number; warnings: string[]; extraReason?: RankingReason } {
  const warnings: string[] = [];
  const budgetPerTraveler =
    input.budgetPerTraveler > 0
      ? input.budgetPerTraveler
      : input.budget / Math.max(1, input.travelerCount);

  if (!destination.isStaycation) {
    if (input.style === "solo reset" && budgetPerTraveler <= 375) {
      warnings.push("A true getaway may add more cost and logistics than this reset trip needs");
      return {
        score: -8,
        warnings,
        extraReason: {
          label: "A lower-friction base fits this solo reset better",
          impact: "negative",
        },
      };
    }

    return { score: 0, warnings };
  }

  if (
    (input.style === "foodie" || input.style === "chill") &&
    (input.maxDriveHours <= 3 || budgetPerTraveler <= 350)
  ) {
    return {
      score: 2,
      warnings,
      extraReason: {
        label: "Staycation fits this low-friction trip well",
        impact: "positive",
      },
    };
  }

  if (
    input.style === "solo reset" &&
    (input.maxDriveHours <= 4 || budgetPerTraveler <= 375)
  ) {
    return {
      score: 8,
      warnings,
      extraReason: {
        label: "Staycation fits a low-friction solo reset especially well",
        impact: "positive",
      },
    };
  }

  if (input.maxDriveHours >= 4 && budgetPerTraveler >= 350) {
    warnings.push("Staycation may feel less distinct than a true getaway");
    return {
      score: -10,
      warnings,
      extraReason: {
        label: "A true getaway is realistic with your current limits",
        impact: "negative",
      },
    };
  }

  return {
    score: -3,
    warnings,
    extraReason: {
      label: "Staycation is convenient but less distinctive",
      impact: "neutral",
    },
  };
}

function calculateGetawayValueScore(
  destination: MappedDestination,
  input: TripInput
): {
  score: number;
  rankingReasons: RankingReason[];
  getawaySignal: number;
} {
  const rankingReasons: RankingReason[] = [];

  if (destination.isStaycation) {
    return { score: 0, rankingReasons, getawaySignal: 0 };
  }

  const getawaySignal = getGetawaySignal(destination);
  let score = clamp(getawaySignal * 1.4, 0, 10);

  if (destination.driveHoursFromStart > input.maxDriveHours * 0.85) {
    score -= 2;
  }

  if (score >= 6) {
    rankingReasons.push({
      label: "Delivers strong getaway value for a short trip",
      impact: "positive",
    });
  }

  return { score: round2(score), rankingReasons, getawaySignal };
}

function calculateShortTripPenalty(
  destination: MappedDestination,
  input: TripInput
): { score: number; warnings: string[] } {
  const warnings: string[] = [];

  if (input.tripLengthDays <= 2 && destination.driveHoursFromStart >= 4.5) {
    warnings.push("Longer drive for a short trip");
    return { score: -10, warnings };
  }

  return { score: 0, warnings };
}

function calculateLiveDataScore(
  destination: Partial<RankedDestination>,
  input: TripInput
): { score: number; rankingReasons: RankingReason[]; liveStrength: number } {
  const summary = destination.liveDataSummary;
  const rankingReasons: RankingReason[] = [];

  if (!summary) {
    return { score: 0, rankingReasons, liveStrength: 0 };
  }

  let score = 0;
  let liveStrength = 0;

  if (input.style === "foodie") {
    if (summary.restaurantCount >= 8) {
      score += 10;
      liveStrength += 2;
      rankingReasons.push({
        label: "Strong live restaurant coverage",
        impact: "positive",
      });
    } else if (summary.restaurantCount >= 4) {
      score += 5;
      liveStrength += 1;
      rankingReasons.push({
        label: "Decent live restaurant coverage",
        impact: "positive",
      });
    } else {
      score -= 5;
      liveStrength -= 1;
      rankingReasons.push({
        label: "Thin restaurant coverage",
        impact: "negative",
      });
    }

    if ((summary.avgRestaurantRating ?? 0) >= 4.4) {
      score += 8;
      liveStrength += 2;
      rankingReasons.push({
        label: "High restaurant ratings",
        impact: "positive",
      });
    } else if ((summary.avgRestaurantRating ?? 0) >= 4.0) {
      score += 4;
      liveStrength += 1;
      rankingReasons.push({
        label: "Solid restaurant ratings",
        impact: "positive",
      });
    }
  }

  if (input.style === "outdoors" || input.style === "adventure") {
    if (summary.activityCount >= 6) {
      score += 10;
      liveStrength += 2;
      rankingReasons.push({
        label: "Strong live activity coverage",
        impact: "positive",
      });
    } else if (summary.activityCount >= 3) {
      score += 5;
      liveStrength += 1;
      rankingReasons.push({
        label: "Decent live activity coverage",
        impact: "positive",
      });
    } else {
      score -= 5;
      liveStrength -= 1;
      rankingReasons.push({
        label: "Thin activity coverage",
        impact: "negative",
      });
    }

    if ((summary.avgActivityRating ?? 0) >= 4.4) {
      score += 8;
      liveStrength += 2;
      rankingReasons.push({
        label: "High activity ratings",
        impact: "positive",
      });
    } else if ((summary.avgActivityRating ?? 0) >= 4.0) {
      score += 4;
      liveStrength += 1;
      rankingReasons.push({
        label: "Solid activity ratings",
        impact: "positive",
      });
    }
  }

  if (summary.hotelCount >= 5) {
    score += 2;
    rankingReasons.push({
      label: "Good hotel coverage",
      impact: "positive",
    });
  }

  if (summary.usedFallbackData) {
    score -= 4;
    rankingReasons.push({
      label: "Using fallback data",
      impact: "neutral",
    });
  }

  if (summary.usedPlacesData) {
    liveStrength += 1;
    rankingReasons.push({
      label: "Backed by live Google Places data",
      impact: "positive",
    });
  }

  return { score, rankingReasons, liveStrength };
}

function reasonCandidate(
  label: string,
  impact: "positive" | "negative" | "neutral",
  priority: number,
  weight: number
): ReasonCandidate {
  return { label, impact, priority, weight };
}

function pickTopReasonCandidates(candidates: ReasonCandidate[]): RankingReason[] {
  const seen = new Set<string>();

  const deduped = candidates.filter((item) => {
    const key = `${item.impact}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const impactOrder: Record<"positive" | "neutral" | "negative", number> = {
    positive: 3,
    neutral: 2,
    negative: 1,
  };

  return deduped
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return impactOrder[b.impact] - impactOrder[a.impact];
    })
    .slice(0, 4)
    .map(({ label, impact }) => ({ label, impact }));
}

function buildRankingReasons(args: {
  destination: ReturnType<typeof mapRawDestination>;
  input: TripInput;
  budgetRatio: number;
  driveRatio: number;
  styleMatchStrength: RankedDestination["styleMatchStrength"];
  resolutionSignal: number;
  veganSignal: number;
  getawaySignal: number;
  hardConstraintCount: number;
  hardConstraintMisses: number;
  promptConstraintStrength: number;
  extraReasonItems: RankingReason[];
  liveReasonItems: RankingReason[];
}): RankingReason[] {
  const {
    destination,
    input,
    budgetRatio,
    driveRatio,
    styleMatchStrength,
    resolutionSignal,
    veganSignal,
    getawaySignal,
    hardConstraintCount,
    hardConstraintMisses,
    promptConstraintStrength,
    extraReasonItems,
    liveReasonItems,
  } = args;

  const candidates: ReasonCandidate[] = [];

  if (styleMatchStrength === "strong") {
    if (resolutionSignal >= 5) {
      if (input.style === "adventure" || input.style === "outdoors") {
        candidates.push(
          reasonCandidate(
            "Especially strong outdoor/adventure fit",
            "positive",
            1,
            100 + resolutionSignal
          )
        );
      } else if (input.style === "foodie") {
        candidates.push(
          reasonCandidate(
            "Especially strong foodie fit",
            "positive",
            1,
            100 + resolutionSignal
          )
        );
      } else {
        candidates.push(
          reasonCandidate(
            "Especially strong fit for this trip style",
            "positive",
            1,
            100 + resolutionSignal
          )
        );
      }
    } else {
      candidates.push(
        reasonCandidate("Strong style match", "positive", 1, 90)
      );
    }
  } else if (styleMatchStrength === "medium") {
    candidates.push(
      reasonCandidate("Good style match", "positive", 1, 80)
    );
  } else if (styleMatchStrength === "weak") {
    candidates.push(
      reasonCandidate("Partial style match", "negative", 1, 70)
    );
  } else {
    candidates.push(
      reasonCandidate("Weak style match", "negative", 1, 60)
    );
  }

  if (hardConstraintCount > 0) {
    if (hardConstraintMisses === 0 && promptConstraintStrength >= 8) {
      candidates.push(
        reasonCandidate(
          "Matches the specific trip brief better",
          "positive",
          1,
          99 + promptConstraintStrength
        )
      );
    } else if (hardConstraintMisses === 0) {
      candidates.push(
        reasonCandidate(
          "Tracks the key trip constraints",
          "positive",
          1,
          86 + promptConstraintStrength
        )
      );
    } else {
      candidates.push(
        reasonCandidate(
          "Misses part of the specific trip brief",
          "negative",
          1,
          98 + hardConstraintMisses
        )
      );
    }
  }

  if (budgetRatio <= 0.65) {
    candidates.push(
      reasonCandidate("Excellent value for your budget", "positive", 2, 95)
    );
  } else if (budgetRatio <= 0.8) {
    candidates.push(
      reasonCandidate("Comfortably within budget", "positive", 2, 85)
    );
  } else if (budgetRatio <= 1) {
    candidates.push(
      reasonCandidate("Fits within budget", "positive", 2, 70)
    );
  } else {
    candidates.push(
      reasonCandidate("Pushes past your target budget", "negative", 2, 95)
    );
  }

  if (driveRatio <= 0.35) {
    candidates.push(
      reasonCandidate("Very easy drive", "positive", 2, 92)
    );
  } else if (driveRatio <= 0.6) {
    candidates.push(
      reasonCandidate("Comfortable drive", "positive", 2, 80)
    );
  } else if (driveRatio <= 0.8) {
    candidates.push(
      reasonCandidate("Reasonable drive", "neutral", 2, 60)
    );
  } else {
    candidates.push(
      reasonCandidate("Close to your drive limit", "negative", 2, 90)
    );
  }

  if (!destination.isStaycation && getawaySignal >= 5) {
    candidates.push(
      reasonCandidate(
        "Delivers strong getaway value",
        "positive",
        2,
        88 + getawaySignal
      )
    );
  } else if (!destination.isStaycation && getawaySignal >= 3) {
    candidates.push(
      reasonCandidate(
        "Feels like a real getaway without a long haul",
        "positive",
        2,
        78 + getawaySignal
      )
    );
  }

  if (input.veganFriendly) {
    if (veganSignal >= 2) {
      candidates.push(
        reasonCandidate("Better vegan support", "positive", 3, 85)
      );
    } else if (veganSignal === 1) {
      candidates.push(
        reasonCandidate("Some vegan support, but not strongly confirmed", "neutral", 3, 68)
      );
    } else {
      candidates.push(
        reasonCandidate("Vegan support is weaker than ideal", "negative", 3, 88)
      );
    }
  }

  for (const item of liveReasonItems) {
    let weight = 55;

    if (item.label.toLowerCase().includes("strong live")) weight = 82;
    else if (item.label.toLowerCase().includes("high")) weight = 78;
    else if (item.label.toLowerCase().includes("backed by live")) weight = 74;
    else if (item.label.toLowerCase().includes("thin")) weight = 80;
    else if (item.label.toLowerCase().includes("fallback")) weight = 60;

    candidates.push(reasonCandidate(item.label, item.impact, 3, weight));
  }

  if (destination.bestSeasons.includes(input.season)) {
    candidates.push(
      reasonCandidate(
        `Good ${input.season.toLowerCase()} fit`,
        "positive",
        4,
        62
      )
    );
  }

  for (const item of extraReasonItems) {
    let priority = 3;
    let weight = 58;

    const lower = item.label.toLowerCase();

    if (
      lower.includes("adventure") ||
      lower.includes("foodie") ||
      lower.includes("calm") ||
      lower.includes("reset")
    ) {
      priority = 1;
      weight = 84;
    } else if (
      lower.includes("getaway") ||
      lower.includes("limits") ||
      lower.includes("staycation")
    ) {
      priority = 2;
      weight = 76;
    } else if (
      lower.includes("vegan") ||
      lower.includes("live") ||
      lower.includes("fallback")
    ) {
      priority = 3;
      weight = 72;
    }

    candidates.push(reasonCandidate(item.label, item.impact, priority, weight));
  }

  return pickTopReasonCandidates(candidates);
}

function calculateConfidence(args: {
  styleMatchStrength: "strong" | "medium" | "weak" | "poor";
  budgetRatio: number;
  driveRatio: number;
  liveStrength: number;
  warningCount: number;
  hardConstraintCount: number;
  hardConstraintMisses: number;
  promptConstraintStrength: number;
  destination: Partial<RankedDestination>;
  input: TripInput;
}): ConfidenceLevel {
  const {
    styleMatchStrength,
    budgetRatio,
    driveRatio,
    liveStrength,
    warningCount,
    hardConstraintCount,
    hardConstraintMisses,
    promptConstraintStrength,
    destination,
    input,
  } = args;

  const veganRequired = input.veganFriendly;
  const veganStrong = !!destination.veganFriendly;

  const weakLiveForRelevantStyle =
    (input.style === "foodie" && liveStrength < 1) ||
    ((input.style === "outdoors" || input.style === "adventure") &&
      liveStrength < 1);

  const clearlyBadFit =
    styleMatchStrength === "poor" ||
    styleMatchStrength === "weak" ||
    budgetRatio > 1.08 ||
    driveRatio > 0.98 ||
    (hardConstraintCount > 0 && hardConstraintMisses >= 2) ||
    warningCount >= 4;

  if (clearlyBadFit) {
    return "low";
  }

  const baseStrong =
    styleMatchStrength === "strong" &&
    budgetRatio <= 0.9 &&
    driveRatio <= 0.82 &&
    warningCount <= 1;

  if (!veganRequired) {
    if (
      hardConstraintCount > 0 &&
      (hardConstraintMisses >= 1 || promptConstraintStrength <= 3)
    ) {
      return "medium";
    }

    if (baseStrong && !weakLiveForRelevantStyle) {
      return "high";
    }

    if (
      styleMatchStrength === "medium" ||
      budgetRatio > 1 ||
      driveRatio > 0.9 ||
      warningCount >= 2
    ) {
      return "medium";
    }

    return "medium";
  }

  if (veganStrong) {
    if (
      hardConstraintCount > 0 &&
      (hardConstraintMisses >= 1 || promptConstraintStrength <= 3)
    ) {
      return "medium";
    }

    if (baseStrong && !weakLiveForRelevantStyle) {
      return "high";
    }

    return "medium";
  }

  if (
    styleMatchStrength === "strong" &&
    budgetRatio <= 1 &&
    driveRatio <= 0.9 &&
    warningCount <= 2
  ) {
    return "medium";
  }

  return "low";
}

export function rankDestinations(
  input: TripInput,
  limit = 3,
  options?: { excludedDestinationNames?: string[] }
): RankedDestination[] {
  const excludedDestinationNames = new Set(
    (options?.excludedDestinationNames ?? [])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );

  const destinationList = (rawDestinations as RawDestination[])
    .map((raw) => mapRawDestination(raw, input))
    .filter((destination) =>
      destinationMatchesPreference(destination, input.preferredDestination)
    )
    .filter(
      (destination) =>
        !excludedDestinationNames.has(destination.name.trim().toLowerCase())
    );

  const ranked = destinationList
    .map((destination) => {
      const seededEstimatedCost = estimateDestinationCost(destination, input);
      const budgetBreakdown = estimateBudgetBreakdown(
        {
          ...destination,
          estimatedCost: seededEstimatedCost,
        },
        input
      );
      const estimatedCost = budgetBreakdown.totalExpected ?? budgetBreakdown.total;

      const hardFilter = passesHardFilters(destination, input, estimatedCost);
      if (!hardFilter.passed) {
        return null;
      }

      const stylePart = calculateStyleScore(destination, input);
      const styleResolutionPart = calculateStyleResolutionScore(destination, input);
      const activityFocusPart = calculateActivityFocusScore(destination, input);
      const promptConstraintPart = calculatePromptConstraintScore(destination, input);
      const seasonPart = calculateSeasonScore(destination, input);
      const drivePart = calculateDriveScore(destination, input);
      const budgetPart = calculateBudgetScore(estimatedCost, input);
      const veganPart = calculateVeganScore(destination, input);
      const staycationPart = calculateStaycationAdjustment(destination, input);
      const getawayValuePart = calculateGetawayValueScore(destination, input);
      const shortTripPart = calculateShortTripPenalty(destination, input);
      const liveDataPart = calculateLiveDataScore(destination, input);

      const styleMatchStrength = getStyleMatchStrength(
        getRequestedStyleScore(destination, input.style)
      );

      const matchReasons = dedupeStrings([
        ...stylePart.matchReasons,
        ...promptConstraintPart.matchReasons,
        ...seasonPart.matchReasons,
        ...drivePart.matchReasons,
        ...budgetPart.matchReasons,
        ...veganPart.matchReasons,
      ]);

      const warnings = dedupeStrings([
        ...stylePart.warnings,
        ...promptConstraintPart.warnings,
        ...drivePart.warnings,
        ...budgetPart.warnings,
        ...veganPart.warnings,
        ...staycationPart.warnings,
        ...shortTripPart.warnings,
      ]);

      const extraReasonItems: RankingReason[] = [
        ...styleResolutionPart.rankingReasons,
        ...activityFocusPart.rankingReasons,
        ...promptConstraintPart.rankingReasons,
        ...veganPart.rankingReasons,
        ...(staycationPart.extraReason ? [staycationPart.extraReason] : []),
        ...getawayValuePart.rankingReasons,
      ];

      const budgetRatio = input.budget > 0 ? estimatedCost / input.budget : 1;
      const driveRatio =
        input.maxDriveHours > 0
          ? destination.driveHoursFromStart / input.maxDriveHours
          : 1;

      const score =
        stylePart.score +
        styleResolutionPart.score +
        activityFocusPart.score +
        promptConstraintPart.score +
        seasonPart.score +
        drivePart.score +
        budgetPart.score +
        veganPart.score +
        staycationPart.score +
        getawayValuePart.score +
        shortTripPart.score +
        liveDataPart.score +
        tinyDeterministicTieBreaker(destination.name);

      const rankingReasons = buildRankingReasons({
        destination,
        input,
        budgetRatio,
        driveRatio,
        styleMatchStrength,
        resolutionSignal: styleResolutionPart.resolutionSignal,
        veganSignal: veganPart.veganSignal,
        getawaySignal: getawayValuePart.getawaySignal,
        hardConstraintCount: promptConstraintPart.hardConstraintCount,
        hardConstraintMisses: promptConstraintPart.hardConstraintMisses,
        promptConstraintStrength: promptConstraintPart.promptConstraintStrength,
        extraReasonItems,
        liveReasonItems: liveDataPart.rankingReasons,
      });

      const confidence = calculateConfidence({
        styleMatchStrength,
        budgetRatio,
        driveRatio,
        liveStrength: liveDataPart.liveStrength,
        warningCount: warnings.length,
        hardConstraintCount: promptConstraintPart.hardConstraintCount,
        hardConstraintMisses: promptConstraintPart.hardConstraintMisses,
        promptConstraintStrength: promptConstraintPart.promptConstraintStrength,
        destination,
        input,
      });

      const enrichedDestination: RankedDestination = {
        ...destination,
        score: round2(score),
        estimatedCost,
        budgetBreakdown,
        matchReasons,
        warnings,
        styleMatchStrength,
        confidence,
        rankingReasons,
      };

      return enrichedDestination;
    })
    .filter((destination): destination is RankedDestination => destination !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const confidenceOrder: Record<ConfidenceLevel, number> = {
        high: 3,
        medium: 2,
        low: 1,
      };

      const confidenceDiff =
        confidenceOrder[b.confidence ?? "low"] -
        confidenceOrder[a.confidence ?? "low"];
      if (confidenceDiff !== 0) return confidenceDiff;

      const styleDiff =
        getRequestedStyleScore(b, input.style) -
        getRequestedStyleScore(a, input.style);
      if (styleDiff !== 0) return styleDiff;

      const budgetSlackA = input.budget - a.estimatedCost;
      const budgetSlackB = input.budget - b.estimatedCost;
      if (budgetSlackB !== budgetSlackA) return budgetSlackB - budgetSlackA;

      const driveSlackA = input.maxDriveHours - a.driveHoursFromStart;
      const driveSlackB = input.maxDriveHours - b.driveHoursFromStart;
      if (driveSlackB !== driveSlackA) return driveSlackB - driveSlackA;

      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  return ranked;
}
