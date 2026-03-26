import rawDestinations from "../data/destinations.json";
import { ActivityFocus, RawDestination, TripStyle } from "./types";

export type DerivedTripIntent = {
  style: TripStyle;
  activityFocus?: ActivityFocus;
  preferredDestination?: string;
  veganFriendly: boolean;
  includeStaycations: boolean;
  strictBudget: boolean;
  suggestedBudgetPerTraveler?: number;
  suggestedMaxDriveHours?: number;
};

type StyleSignals = Record<TripStyle, number>;

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countMatches(text: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => {
    return count + (text.includes(keyword) ? 1 : 0);
  }, 0);
}

function inferPreferredDestination(prompt: string): string | undefined {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) return undefined;

  const options = (rawDestinations as RawDestination[])
    .map((destination) => ({
      destinationName: destination.name?.trim(),
      matchText: normalizeText(
        [destination.name, destination.home_base_city].filter(Boolean).join(" ")
      ),
    }))
    .filter(
      (
        destination
      ): destination is { destinationName: string; matchText: string } =>
        Boolean(destination.destinationName && destination.matchText)
    )
    .sort((a, b) => b.matchText.length - a.matchText.length);

  for (const option of options) {
    if (normalizedPrompt.includes(option.matchText)) {
      return option.destinationName;
    }
  }

  return undefined;
}

function inferActivityFocus(text: string): ActivityFocus | undefined {
  if (
    countMatches(text, [
      "ski",
      "skiing",
      "snowboard",
      "snowboarding",
      "powder",
      "winter",
      "hill",
    ]) >= 1
  ) {
    return "skiing";
  }

  if (
    countMatches(text, [
      "camp",
      "camping",
      "campground",
      "campsite",
      "fire",
      "tent",
      "rv",
    ]) >= 1
  ) {
    return "camping";
  }

  if (
    countMatches(text, [
      "hike",
      "hiking",
      "trail",
      "waterfall",
      "summit",
      "lookout",
      "viewpoint",
      "lake",
    ]) >= 1
  ) {
    return "hiking";
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
  ]);

  if (activityFocus === "hiking" || activityFocus === "camping") {
    signals.outdoors += 3;
  }

  if (activityFocus === "skiing") {
    signals.adventure += 3;
    signals.outdoors += 2;
  }

  const orderedStyles = (Object.entries(signals) as Array<[TripStyle, number]>).sort(
    (a, b) => b[1] - a[1]
  );

  const [style, score] = orderedStyles[0] ?? ["adventure", 0];
  return score > 0 ? style : "adventure";
}

function inferBudget(prompt: string) {
  const text = normalizeText(prompt);

  if (
    countMatches(text, [
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
    countMatches(text, [
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

export function deriveTripIntentFromPrompt(prompt?: string): DerivedTripIntent {
  const normalizedPrompt = normalizeText(prompt);
  const activityFocus = inferActivityFocus(normalizedPrompt);
  const budget = inferBudget(normalizedPrompt);

  const includeStaycations =
    countMatches(normalizedPrompt, [
      "staycation",
      "local",
      "in the city",
      "close to home",
      "near home",
    ]) >= 1;

  return {
    style: inferStyle(normalizedPrompt, activityFocus),
    activityFocus,
    preferredDestination: inferPreferredDestination(normalizedPrompt),
    veganFriendly:
      countMatches(normalizedPrompt, [
        "vegan",
        "plant based",
        "plant-based",
        "vegetarian",
      ]) >= 1,
    includeStaycations,
    strictBudget: budget.strictBudget,
    suggestedBudgetPerTraveler: budget.suggestedBudgetPerTraveler,
    suggestedMaxDriveHours: inferDriveTolerance(normalizedPrompt),
  };
}

