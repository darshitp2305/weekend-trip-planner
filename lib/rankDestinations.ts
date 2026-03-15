import rawDestinations from "../data/destinations.json";
import {
  ConfidenceLevel,
  RankedDestination,
  RankingReason,
  RawDestination,
  TripInput,
} from "./types";
import { estimateBudgetBreakdown } from "./budgetEstimator";
import { mapRawDestination } from "./mapDestination";

type ReasonCandidate = RankingReason & {
  priority: number;
  weight: number;
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

function dedupeRankingReasons(items: RankingReason[]): RankingReason[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.impact}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function tinyDeterministicTieBreaker(name: string): number {
  let total = 0;
  for (let i = 0; i < name.length; i += 1) {
    total += name.charCodeAt(i) * (i + 1);
  }
  return (total % 97) / 1000;
}

function passesHardFilters(
  destination: ReturnType<typeof mapRawDestination>,
  input: TripInput,
  estimatedCost: number
): { passed: boolean; reason?: string } {
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

  return { passed: true };
}

function calculateStyleScore(
  destination: ReturnType<typeof mapRawDestination>,
  input: TripInput
): { score: number; matchReasons: string[]; warnings: string[] } {
  const matchReasons: string[] = [];
  const warnings: string[] = [];

  const styleScore = destination.styleScores[input.style];

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
  destination: ReturnType<typeof mapRawDestination>,
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
  }

  const score = clamp(rawSignal * 2.2, -8, 14);
  return { score: round2(score), rankingReasons, resolutionSignal: rawSignal };
}

function calculateSeasonScore(
  destination: ReturnType<typeof mapRawDestination>,
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
  destination: ReturnType<typeof mapRawDestination>,
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
  destination: ReturnType<typeof mapRawDestination>,
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
  destination: ReturnType<typeof mapRawDestination>,
  input: TripInput
): { score: number; warnings: string[]; extraReason?: RankingReason } {
  const warnings: string[] = [];
  const budgetPerTraveler =
    input.budgetPerTraveler > 0
      ? input.budgetPerTraveler
      : input.budget / Math.max(1, input.travelerCount);

  if (!destination.isStaycation) {
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
  destination: ReturnType<typeof mapRawDestination>,
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
  destination: ReturnType<typeof mapRawDestination>,
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
  destination: Partial<RankedDestination>;
  input: TripInput;
}): ConfidenceLevel {
  const {
    styleMatchStrength,
    budgetRatio,
    driveRatio,
    liveStrength,
    warningCount,
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
  limit = 3
): RankedDestination[] {
  const destinationList = (rawDestinations as RawDestination[])
    .map((raw) => mapRawDestination(raw, input))
    .filter((destination) =>
      destinationMatchesPreference(destination, input.preferredDestination)
    );

  const ranked = destinationList
    .map((destination) => {
      const travelerCount = Math.max(1, input.travelerCount);
      const nights = Math.max(1, input.tripLengthDays - 1);
      const nightlyHotel = destination.hotelOptions?.[0]?.pricePerNight ?? 150;

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

      const budgetBreakdown = estimateBudgetBreakdown(
        seededDestination,
        input
      );
      const estimatedCost = budgetBreakdown.totalExpected ?? budgetBreakdown.total;

      const hardFilter = passesHardFilters(destination, input, estimatedCost);
      if (!hardFilter.passed) {
        return null;
      }

      const stylePart = calculateStyleScore(destination, input);
      const styleResolutionPart = calculateStyleResolutionScore(destination, input);
      const seasonPart = calculateSeasonScore(destination, input);
      const drivePart = calculateDriveScore(destination, input);
      const budgetPart = calculateBudgetScore(estimatedCost, input);
      const veganPart = calculateVeganScore(destination, input);
      const staycationPart = calculateStaycationAdjustment(destination, input);
      const getawayValuePart = calculateGetawayValueScore(destination, input);
      const shortTripPart = calculateShortTripPenalty(destination, input);
      const liveDataPart = calculateLiveDataScore(destination, input);

      const styleMatchStrength = getStyleMatchStrength(
        destination.styleScores[input.style]
      );

      const matchReasons = dedupeStrings([
        ...stylePart.matchReasons,
        ...seasonPart.matchReasons,
        ...drivePart.matchReasons,
        ...budgetPart.matchReasons,
        ...veganPart.matchReasons,
      ]);

      const warnings = dedupeStrings([
        ...stylePart.warnings,
        ...drivePart.warnings,
        ...budgetPart.warnings,
        ...veganPart.warnings,
        ...staycationPart.warnings,
        ...shortTripPart.warnings,
      ]);

      const extraReasonItems: RankingReason[] = [
        ...styleResolutionPart.rankingReasons,
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
        extraReasonItems,
        liveReasonItems: liveDataPart.rankingReasons,
      });

      const confidence = calculateConfidence({
        styleMatchStrength,
        budgetRatio,
        driveRatio,
        liveStrength: liveDataPart.liveStrength,
        warningCount: warnings.length,
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

      const styleDiff = b.styleScores[input.style] - a.styleScores[input.style];
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
