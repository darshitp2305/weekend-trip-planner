import rawDestinations from "../data/destinations.json";
import { ActivityFocus, RawDestination, TripStyle } from "./types";

export type PromptActivityAnchor =
  | "summit_hike"
  | "campground_base"
  | "ski_trip";

export type DietaryPreference = "vegetarian" | "vegan";

export type PromptHardConstraints = {
  activityAnchor?: PromptActivityAnchor;
  hikeDistanceKmTarget?: number;
  hikeDistanceKmMin?: number;
  hikeDistanceKmMax?: number;
  requiresScenicView: boolean;
  dietaryPreference?: DietaryPreference;
  requiresVegetarianOptions: boolean;
  mixedDietGroup: boolean;
};

export type PromptSoftPreferences = {
  wantsGoodFood: boolean;
  wantsScenery: boolean;
  wantsGetawayFeel: boolean;
  wantsLowEffort: boolean;
  wantsRecoveryDays: boolean;
};

export type DerivedTripIntent = {
  style: TripStyle;
  activityFocus?: ActivityFocus;
  preferredDestination?: string;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
  suggestedTravelerCount?: number;
  suggestedBudgetPerTraveler?: number;
  suggestedMaxDriveHours?: number;
  hardConstraints: PromptHardConstraints;
  softPreferences: PromptSoftPreferences;
};

export type PromptBudgetScope = "per_traveler" | "group_total";

export type PromptBudgetMatch = {
  amount: number;
  scope: PromptBudgetScope;
  approximate: boolean;
};

type StyleSignals = Record<TripStyle, number>;

const APPROXIMATE_PER_TRAVELER_BUDGET_PATTERN =
  /(?:budget(?:\s+of|\s+is)?\s*)?(?:around|about|roughly|approx(?:imately)?)\s*\$?\s*(\d{2,5})\s*(?:cad|dollars?)?\s*(?:each|per person|per traveler|per traveller|pp)\b/i;
const EXACT_PER_TRAVELER_BUDGET_PATTERN =
  /(?:budget(?:\s+of|\s+is)?\s*)?\$?\s*(\d{2,5})\s*(?:cad|dollars?)?\s*(?:each|per person|per traveler|per traveller|pp)\b/i;
const APPROXIMATE_GROUP_BUDGET_PATTERN =
  /(?:our\s+)?(?:total|overall|trip|weekend|all[\s-]?in)?\s*budget(?:\s+of|\s+is)?\s*(?:around|about|roughly|approx(?:imately)?)\s*\$?\s*(\d{2,5})\s*(?:cad|dollars?)?(?=\b|[.!?,]|$)(?:\s*(?:total|overall|for the trip|for this trip|for the weekend|all in|between us|for us|for both of us|for all of us)\b)?/i;
const EXACT_GROUP_BUDGET_PATTERN =
  /(?:our\s+)?(?:total|overall|trip|weekend|all[\s-]?in)?\s*budget(?:\s+of|\s+is)?\s*\$?\s*(\d{2,5})\s*(?:cad|dollars?)?(?=\b|[.!?,]|$)(?:\s*(?:total|overall|for the trip|for this trip|for the weekend|all in|between us|for us|for both of us|for all of us)\b)?/i;
const TRAVELER_COUNT_PATTERNS = [
  /\bwe(?:'re|\s+are)?\s+(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
  /\b(\d{1,2})\s+of\s+us\b/i,
  /\bthere\s+(?:are|will be)\s+(\d{1,2})\s+of\s+us\b/i,
  /\bgroup\s+of\s+(\d{1,2})\b/i,
  /\bfor\s+(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
  /\b(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
];
const HIKE_DISTANCE_PATTERN =
  /(?:about|around|roughly|approx(?:imately)?)?\s*(\d{1,2}(?:\.\d)?)\s*(?:km|kilometers?|kilometres?)(?:\s*(?:long)?)?(?:\s*(?:for the )?(?:round trip|return|there and back|total))?/i;

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasKeywordMatch(text: string, keyword: string) {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return false;

  if (normalizedKeyword.includes(" ")) {
    return ` ${text} `.includes(` ${normalizedKeyword} `);
  }

  return text.split(" ").includes(normalizedKeyword);
}

function countMatches(text: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => {
    return count + (hasKeywordMatch(text, keyword) ? 1 : 0);
  }, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function inferPreferredDestination(prompt: string): string | undefined {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) return undefined;

  const options = (rawDestinations as RawDestination[])
    .map((destination) => ({
      destinationName: destination.name?.trim(),
      matchTexts: [destination.name, destination.home_base_city]
        .map((value) => normalizeText(value))
        .filter(Boolean),
    }))
    .filter(
      (destination): destination is {
        destinationName: string;
        matchTexts: string[];
      } => Boolean(destination.destinationName && destination.matchTexts.length > 0)
    )
    .sort((a, b) => {
      const longestA = Math.max(...a.matchTexts.map((value) => value.length));
      const longestB = Math.max(...b.matchTexts.map((value) => value.length));
      return longestB - longestA;
    });

  for (const option of options) {
    if (
      option.matchTexts.some(
        (matchText) =>
          normalizedPrompt === matchText ||
          normalizedPrompt.includes(matchText)
      )
    ) {
      return option.destinationName;
    }
  }

  return undefined;
}

function inferActivityFocus(text: string): ActivityFocus | undefined {
  const skiingScore = countMatches(text, [
    "ski",
    "skiing",
    "snowboard",
    "snowboarding",
    "powder",
    "ski hill",
    "ski resort",
    "chairlift",
    "lift ticket",
  ]);
  const campingScore = countMatches(text, [
    "camp",
    "camping",
    "campground",
    "campsite",
    "fire",
    "tent",
    "rv",
  ]);
  const hikingScore = countMatches(text, [
    "hike",
    "hiking",
    "trail",
    "waterfall",
    "summit",
    "lookout",
    "viewpoint",
    "lake",
    "peak",
    "ridge",
    "mountain",
  ]);

  if (hikingScore >= Math.max(skiingScore, campingScore) && hikingScore >= 1) {
    return "hiking";
  }

  if (campingScore >= Math.max(skiingScore, hikingScore) && campingScore >= 1) {
    return "camping";
  }

  if (skiingScore >= 1) {
    return "skiing";
  }

  return undefined;
}

function inferStyle(text: string, activityFocus?: ActivityFocus): TripStyle {
  const signals: StyleSignals = {
    chill: 0,
    outdoors: 0,
    foodie: 0,
    "solo reset": 0,
    adventure: 0,
    "hidden gems": 0,
  };

  signals.foodie += countMatches(text, [
    "food",
    "foodie",
    "restaurant",
    "dinner",
    "brunch",
    "coffee",
    "bakery",
    "cocktail",
    "brewery",
    "date night",
  ]);

  signals.chill += countMatches(text, [
    "chill",
    "chill out",
    "chill time",
    "relax",
    "relaxing",
    "slow",
    "easy",
    "spa",
    "rest",
    "quiet",
    "recharge",
    "romantic",
    "cozy",
    "low effort",
    "low effort",
    "low-effort",
  ]);

  signals["solo reset"] += countMatches(text, [
    "solo",
    "alone",
    "myself",
    "reset",
    "clear my head",
    "journaling",
    "reflection",
    "peaceful",
  ]);

  signals["hidden gems"] += countMatches(text, [
    "hidden gem",
    "hidden gems",
    "under the radar",
    "underrated",
    "not touristy",
    "not too touristy",
    "less crowded",
    "small town",
    "off the beaten path",
  ]);

  signals.outdoors += countMatches(text, [
    "outdoors",
    "nature",
    "mountain",
    "mountains",
    "forest",
    "lake",
    "scenic",
    "trail",
    "cabin",
    "hike",
    "summit",
    "camp",
  ]);

  signals.adventure += countMatches(text, [
    "adventure",
    "active",
    "thrill",
    "road trip",
    "packed",
    "full day",
    "explore",
    "action",
    "gondola",
    "ski",
    "summit",
    "peak",
    "ridge",
  ]);

  if (activityFocus === "hiking" || activityFocus === "camping") {
    signals.outdoors += 3;
  }

  if (activityFocus === "skiing") {
    signals.adventure += 3;
    signals.outdoors += 2;
  }

  const orderedStyles = (
    Object.entries(signals) as Array<[TripStyle, number]>
  ).sort((a, b) => b[1] - a[1]);

  const [style, score] = orderedStyles[0] ?? ["adventure", 0];
  return score > 0 ? style : "adventure";
}

function inferDietaryPreference(text: string): DietaryPreference | undefined {
  if (
    countMatches(text, ["vegan", "plant based", "plant-based"]) >= 1
  ) {
    return "vegan";
  }

  if (countMatches(text, ["vegetarian"]) >= 1) {
    return "vegetarian";
  }

  return undefined;
}

function inferMixedDietGroup(text: string, dietaryPreference?: DietaryPreference) {
  if (!dietaryPreference) return false;

  return (
    countMatches(text, [
      "my friends are not",
      "friends are not",
      "group is not",
      "others are not",
      "not vegetarian",
      "not vegan",
      "mixed group",
      "my friends arent",
      "friends arent",
      "group isnt",
    ]) >= 1
  );
}

export function extractPromptBudget(prompt: string): PromptBudgetMatch | null {
  const approximatePerTravelerMatch = prompt.match(
    APPROXIMATE_PER_TRAVELER_BUDGET_PATTERN
  );
  if (approximatePerTravelerMatch) {
    const amount = Number.parseInt(approximatePerTravelerMatch[1] ?? "", 10);
    if (Number.isFinite(amount) && amount >= 75 && amount <= 10000) {
      return {
        amount,
        scope: "per_traveler",
        approximate: true,
      };
    }
  }

  const exactPerTravelerMatch = prompt.match(EXACT_PER_TRAVELER_BUDGET_PATTERN);
  if (exactPerTravelerMatch) {
    const amount = Number.parseInt(exactPerTravelerMatch[1] ?? "", 10);
    if (Number.isFinite(amount) && amount >= 75 && amount <= 10000) {
      return {
        amount,
        scope: "per_traveler",
        approximate: false,
      };
    }
  }

  const approximateGroupMatch = prompt.match(APPROXIMATE_GROUP_BUDGET_PATTERN);
  if (approximateGroupMatch) {
    const amount = Number.parseInt(approximateGroupMatch[1] ?? "", 10);
    if (Number.isFinite(amount) && amount >= 75 && amount <= 10000) {
      return {
        amount,
        scope: "group_total",
        approximate: true,
      };
    }
  }

  const exactGroupMatch = prompt.match(EXACT_GROUP_BUDGET_PATTERN);
  if (exactGroupMatch) {
    const amount = Number.parseInt(exactGroupMatch[1] ?? "", 10);
    if (Number.isFinite(amount) && amount >= 75 && amount <= 10000) {
      return {
        amount,
        scope: "group_total",
        approximate: false,
      };
    }
  }

  return null;
}

export function extractPromptTravelerCount(prompt: string): number | null {
  for (const pattern of TRAVELER_COUNT_PATTERNS) {
    const match = prompt.match(pattern);
    if (!match) continue;

    const travelerCount = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(travelerCount) && travelerCount >= 1 && travelerCount <= 12) {
      return travelerCount;
    }
  }

  return null;
}

function inferBudget(prompt: string, normalizedPrompt: string) {
  const explicitBudget = extractPromptBudget(prompt);
  if (explicitBudget?.scope === "per_traveler") {
    return {
      suggestedBudgetPerTraveler: explicitBudget.amount,
      strictBudget: !explicitBudget.approximate,
    };
  }

  if (
    countMatches(normalizedPrompt, [
      "cheap",
      "budget",
      "affordable",
      "inexpensive",
      "low cost",
      "not too expensive",
      "keep it cheap",
    ]) >= 1
  ) {
    return {
      suggestedBudgetPerTraveler: 225,
      strictBudget: true,
    };
  }

  if (
    countMatches(normalizedPrompt, [
      "luxury",
      "splurge",
      "high end",
      "fancy",
      "premium",
      "upscale",
    ]) >= 1
  ) {
    return {
      suggestedBudgetPerTraveler: 475,
      strictBudget: false,
    };
  }

  return {
    suggestedBudgetPerTraveler: undefined,
    strictBudget: false,
  };
}

function inferDriveTolerance(prompt: string) {
  const text = normalizeText(prompt);

  if (
    countMatches(text, [
      "close",
      "nearby",
      "easy drive",
      "short drive",
      "not too much driving",
      "minimal driving",
      "quick getaway",
      "local",
    ]) >= 1
  ) {
    return 3;
  }

  if (
    countMatches(text, [
      "road trip",
      "worth the drive",
      "long drive is fine",
      "dont mind the drive",
      "mountain weekend",
    ]) >= 1
  ) {
    return 6;
  }

  return undefined;
}

function extractHikeDistanceKm(prompt: string, activityFocus?: ActivityFocus) {
  if (activityFocus !== "hiking") return undefined;

  const match = prompt.match(HIKE_DISTANCE_PATTERN);
  if (!match) return undefined;

  const target = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(target) || target < 1 || target > 40) {
    return undefined;
  }

  const tolerance = clamp(Math.round(target * 0.2), 2, 4);
  return {
    hikeDistanceKmTarget: target,
    hikeDistanceKmMin: Math.max(1, target - tolerance),
    hikeDistanceKmMax: target + tolerance,
  };
}

function inferHardConstraints(
  prompt: string,
  activityFocus?: ActivityFocus
): PromptHardConstraints {
  const normalizedPrompt = normalizeText(prompt);
  const dietaryPreference = inferDietaryPreference(normalizedPrompt);
  const mixedDietGroup = inferMixedDietGroup(
    normalizedPrompt,
    dietaryPreference
  );
  const hikeDistance = extractHikeDistanceKm(prompt, activityFocus);

  const wantsSummitStyleHike =
    activityFocus === "hiking" &&
    (
      countMatches(normalizedPrompt, [
        "summit",
        "peak",
        "ridge",
        "scramble",
        "top of a mountain",
        "mountaintop",
        "mountain top",
        "top of the mountain",
        "hike up a mountain",
        "hike up the mountain",
        "up a mountain",
        "up the mountain",
        "mountain hike",
      ]) >= 1 ||
      ((normalizedPrompt.includes("mountain") ||
        normalizedPrompt.includes("mountains")) &&
        (normalizedPrompt.includes("top") ||
          normalizedPrompt.includes("summit") ||
          normalizedPrompt.includes("peak") ||
          normalizedPrompt.includes("scenic view at the top") ||
          normalizedPrompt.includes("view at the top")))
    );

  let activityAnchor: PromptActivityAnchor | undefined;
  if (activityFocus === "camping") {
    activityAnchor = "campground_base";
  } else if (activityFocus === "skiing") {
    activityAnchor = "ski_trip";
  } else if (wantsSummitStyleHike) {
    activityAnchor = "summit_hike";
  }

  return {
    activityAnchor,
    ...hikeDistance,
    requiresScenicView:
      countMatches(normalizedPrompt, [
        "scenic view",
        "scenic views",
        "nice view",
        "great view",
        "good view",
        "view at the top",
        "views at the top",
        "top of the hike",
        "viewpoint",
        "lookout",
        "panorama",
        "panoramic",
      ]) >= 1,
    dietaryPreference,
    requiresVegetarianOptions: Boolean(dietaryPreference),
    mixedDietGroup,
  };
}

function inferSoftPreferences(
  prompt: string,
  activityFocus?: ActivityFocus
): PromptSoftPreferences {
  const normalizedPrompt = normalizeText(prompt);

  return {
    wantsGoodFood:
      countMatches(normalizedPrompt, [
        "good food",
        "great food",
        "food",
        "restaurant",
        "restaurants",
        "dinner",
        "brunch",
        "coffee",
        "cafe",
        "bakery",
      ]) >= 1,
    wantsScenery:
      countMatches(normalizedPrompt, [
        "scenic",
        "view",
        "views",
        "mountain",
        "mountains",
        "lake",
        "nature",
        "lookout",
        "panorama",
      ]) >= 1,
    wantsGetawayFeel:
      activityFocus === "camping" ||
      countMatches(normalizedPrompt, [
        "getaway",
        "weekend away",
        "escape",
        "trip",
        "road trip",
        "mountain weekend",
      ]) >= 1,
    wantsLowEffort:
      countMatches(normalizedPrompt, [
        "low effort",
        "low-effort",
        "easy",
        "easygoing",
        "light",
        "not too much planning",
        "simple",
        "low key",
        "low-key",
      ]) >= 1,
    wantsRecoveryDays:
      countMatches(normalizedPrompt, [
        "on the other days i just want to relax",
        "on the other days i just want to chill",
        "other days i just want to relax",
        "other days i just want to chill",
        "other days just want to relax",
        "other days just want to chill",
        "relax on the other days",
        "chill on the other days",
        "rest day",
        "rest days",
        "recovery day",
        "recovery days",
        "keep the other days light",
        "keep the rest of the trip light",
        "rest of the trip i just want to relax",
        "on the rest of the trip i just want to relax",
      ]) >= 1 ||
      (activityFocus === "hiking" &&
        countMatches(normalizedPrompt, [
        "relax",
        "relaxing",
        "chill",
        "chill out",
        "rest",
        "restful",
        "unwind",
          "take it easy",
        ]) >= 1),
  };
}

export function deriveTripIntentFromPrompt(prompt?: string): DerivedTripIntent {
  const rawPrompt = prompt ?? "";
  const normalizedPrompt = normalizeText(rawPrompt);
  const activityFocus = inferActivityFocus(normalizedPrompt);
  const budget = inferBudget(rawPrompt, normalizedPrompt);
  const suggestedTravelerCount = extractPromptTravelerCount(rawPrompt) ?? undefined;

  const includeStaycations =
    countMatches(normalizedPrompt, [
      "staycation",
      "local",
      "in the city",
      "close to home",
      "near home",
    ]) >= 1;

  const hardConstraints = inferHardConstraints(rawPrompt, activityFocus);
  const softPreferences = inferSoftPreferences(rawPrompt, activityFocus);

  return {
    style: inferStyle(normalizedPrompt, activityFocus),
    activityFocus,
    preferredDestination: inferPreferredDestination(rawPrompt),
    veganFriendly: Boolean(hardConstraints.dietaryPreference),
    includeStaycations,
    strictBudget: budget.strictBudget,
    suggestedTravelerCount,
    suggestedBudgetPerTraveler: budget.suggestedBudgetPerTraveler,
    suggestedMaxDriveHours: inferDriveTolerance(normalizedPrompt),
    hardConstraints,
    softPreferences,
  };
}
