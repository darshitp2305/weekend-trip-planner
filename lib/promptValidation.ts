import rawDestinations from "../data/destinations.json";
import {
  extractPromptTiming,
  extractPromptTripLengthDays,
} from "./conversationalPlanner";
import { extractDesiredText } from "./itineraryPrompt";
import { normalizePromptText } from "./promptLimits";
import { START_CITY_OPTIONS } from "./startCities";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptStartCity,
  extractPromptTravelerCount,
} from "./tripIntent";
import { RawDestination } from "./types";

export type PromptValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      message: string;
      reason:
        | "empty"
        | "unreadable"
        | "low_signal"
        | "unsupported_destination";
    };

export type PromptValidationFailureReason = Exclude<
  PromptValidationResult,
  { ok: true }
>["reason"];

const TRIP_KEYWORD_PATTERN =
  /\b(trip|getaway|weekend|road trip|vacation|escape|itinerary|plan)\b/i;
const BUILDER_CONTEXT_PATTERN =
  /\b(day\s+\d+|day\s+(?:one|two|three|four|five|six|seven|first|second|third|fourth|fifth|sixth|seventh)|hotel|stay|lodging|check in|breakfast|brunch|lunch|dinner|coffee|cafe|restaurant|meal|activity|hike|trail|walk|museum|spa|gondola|ski|viewpoint|lookout|stop|before|after|instead)\b/i;
const DESTINATION_CANDIDATE_PATTERNS = [
  /\b(?:trip|getaway|vacation|weekend|road trip|escape)\s+to\s+([a-z][a-z\s'-]{1,30}?)(?=(?:\s+(?:from|for|with|on|this|next|during|around|near|by|that|which|because|if|where|when)\b|[,.!?]|$))/i,
  /\b(?:visit(?:ing)?|explore|exploring|headed to|heading to|going to|stay(?:ing)? in|staying in)\s+([a-z][a-z\s'-]{1,30}?)(?=(?:\s+(?:from|for|with|on|this|next|during|around|near|by|that|which|because|if|where|when)\b|[,.!?]|$))/i,
];

const GENERIC_LOCATION_TERMS = new Set([
  "a",
  "adventure",
  "adventurous",
  "alberta",
  "away",
  "camp",
  "camping",
  "celebrate",
  "chill",
  "coffee",
  "cozy",
  "easy",
  "eat",
  "escape",
  "explore",
  "food",
  "fun",
  "getaway",
  "good food",
  "hike",
  "hiking",
  "lake",
  "long weekend",
  "mountain",
  "mountains",
  "nature",
  "quiet",
  "recharge",
  "relax",
  "relaxing",
  "remember",
  "reset",
  "road trip",
  "romantic",
  "scenic",
  "ski",
  "skiing",
  "slow",
  "summer",
  "trip",
  "unwind",
  "vacation",
  "weekend",
  "winter",
]);

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function alphaTokens(value?: string) {
  return (value?.toLowerCase().match(/[a-z]+/g) ?? []).filter(Boolean);
}

function hasLikelyNoise(prompt: string) {
  const tokens = alphaTokens(prompt);
  if (tokens.length === 0) {
    return true;
  }

  const distinctTokens = new Set(tokens);
  if (distinctTokens.size === 1 && tokens.length >= 3) {
    return true;
  }

  const vowelLessLongTokens = tokens.filter(
    (token) => token.length >= 4 && !/[aeiouy]/.test(token)
  ).length;

  return tokens.length >= 3 && vowelLessLongTokens >= Math.ceil(tokens.length * 0.75);
}

function buildSupportedLocationPhrases() {
  const supported = new Set<string>(["alberta", "rockies", "canadian rockies"]);

  for (const city of START_CITY_OPTIONS) {
    supported.add(normalizeText(city));
  }

  for (const destination of rawDestinations as RawDestination[]) {
    supported.add(normalizeText(destination.name));
    supported.add(normalizeText(destination.home_base_city));
    supported.add(normalizeText(destination.region));
  }

  return supported;
}

const SUPPORTED_LOCATION_PHRASES = buildSupportedLocationPhrases();

function isSupportedLocationPhrase(candidate: string) {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) {
    return true;
  }

  if (SUPPORTED_LOCATION_PHRASES.has(normalizedCandidate)) {
    return true;
  }

  return Array.from(SUPPORTED_LOCATION_PHRASES).some(
    (location) =>
      location === normalizedCandidate ||
      location.includes(normalizedCandidate) ||
      normalizedCandidate.includes(location)
  );
}

function findUnsupportedDestinationMention(prompt: string) {
  for (const pattern of DESTINATION_CANDIDATE_PATTERNS) {
    const match = prompt.match(pattern);
    const candidate = normalizeText(match?.[1]);
    if (!candidate) {
      continue;
    }

    if (
      GENERIC_LOCATION_TERMS.has(candidate) ||
      candidate
        .split(" ")
        .every((token) => token.length <= 2 || GENERIC_LOCATION_TERMS.has(token))
    ) {
      continue;
    }

    if (!isSupportedLocationPhrase(candidate)) {
      return match?.[1]?.trim() ?? candidate;
    }
  }

  return undefined;
}

function hasTripShapeSignal(prompt: string) {
  const intent = deriveTripIntentFromPrompt(prompt);

  return Boolean(
    intent.preferredDestination ||
      intent.requestedActivityName ||
      intent.activityFocus ||
      intent.hardConstraints.requiresScenicView ||
      intent.hardConstraints.requiresVegetarianOptions ||
      intent.softPreferences.wantsGoodFood ||
      intent.softPreferences.wantsScenery ||
      intent.softPreferences.wantsGetawayFeel ||
      intent.softPreferences.wantsLowEffort ||
      intent.softPreferences.wantsRecoveryDays ||
      TRIP_KEYWORD_PATTERN.test(prompt)
  );
}

export function validateTripPrompt(prompt: string): PromptValidationResult {
  const normalizedPrompt = normalizePromptText(prompt);

  if (!normalizedPrompt) {
    return {
      ok: false,
      reason: "empty",
      message: "Describe the Alberta trip you want before I can plan it.",
    };
  }

  if (hasLikelyNoise(normalizedPrompt)) {
    return {
      ok: false,
      reason: "unreadable",
      message:
        "That prompt does not look clear enough to plan from. Try a normal sentence with the trip you want.",
    };
  }

  const unsupportedDestination = findUnsupportedDestinationMention(normalizedPrompt);
  if (unsupportedDestination) {
    return {
      ok: false,
      reason: "unsupported_destination",
      message: `${unsupportedDestination} is outside the Alberta trip planner right now. Try an Alberta destination or describe the kind of Alberta trip you want instead.`,
    };
  }

  const timing = extractPromptTiming(normalizedPrompt);
  const tripLengthDays = extractPromptTripLengthDays(normalizedPrompt);
  const travelerCount = extractPromptTravelerCount(normalizedPrompt);
  const budget = extractPromptBudget(normalizedPrompt);
  const startCity = extractPromptStartCity(normalizedPrompt);
  const intent = deriveTripIntentFromPrompt(normalizedPrompt);

  const signalScore = [
    Boolean(timing.season || timing.tripStartDate),
    Boolean(tripLengthDays),
    Boolean(travelerCount),
    Boolean(budget),
    Boolean(startCity),
    Boolean(intent.preferredDestination),
    Boolean(intent.requestedActivityName || intent.activityFocus),
    Boolean(
      intent.hardConstraints.requiresScenicView ||
        intent.hardConstraints.requiresVegetarianOptions ||
        intent.softPreferences.wantsGoodFood ||
        intent.softPreferences.wantsScenery ||
        intent.softPreferences.wantsGetawayFeel ||
        intent.softPreferences.wantsLowEffort ||
        intent.softPreferences.wantsRecoveryDays ||
        intent.strictBudget
    ),
    TRIP_KEYWORD_PATTERN.test(normalizedPrompt),
  ].filter(Boolean).length;

  const hasSpecificTripSignal = Boolean(
    intent.preferredDestination ||
      intent.requestedActivityName ||
      intent.activityFocus ||
      intent.hardConstraints.requiresScenicView ||
      intent.hardConstraints.requiresVegetarianOptions ||
      intent.softPreferences.wantsGoodFood ||
      intent.softPreferences.wantsScenery ||
      intent.softPreferences.wantsGetawayFeel ||
      intent.softPreferences.wantsLowEffort ||
      intent.softPreferences.wantsRecoveryDays ||
      intent.strictBudget
  );

  if (
    !hasTripShapeSignal(normalizedPrompt) ||
    (signalScore < 2 && !hasSpecificTripSignal)
  ) {
    return {
      ok: false,
      reason: "low_signal",
      message:
        "I couldn't tell what trip you want yet. Try mentioning the kind of trip, a destination or activity, and optionally timing or budget.",
    };
  }

  return { ok: true };
}

export function validateBuilderPrompt(prompt: string): PromptValidationResult {
  const normalizedPrompt = normalizePromptText(prompt);

  if (!normalizedPrompt) {
    return {
      ok: false,
      reason: "empty",
      message:
        'Try a sentence like "Day 2 lunch to Wild Flour Bakery" or "Add a coffee stop before we leave."',
    };
  }

  if (hasLikelyNoise(normalizedPrompt)) {
    return {
      ok: false,
      reason: "unreadable",
      message:
        "That edit request is too unclear to apply. Try a short sentence that names the change you want.",
    };
  }

  const desiredText = extractDesiredText(normalizedPrompt);
  const desiredTokens = alphaTokens(desiredText).filter(
    (token) => !["the", "and", "for", "with", "day", "stop"].includes(token)
  );
  const hasSpecificDesiredText =
    desiredTokens.length >= 2 || normalizeText(desiredText).length >= 10;
  const hasBuilderContext = BUILDER_CONTEXT_PATTERN.test(normalizedPrompt);

  if (!hasSpecificDesiredText || !hasBuilderContext) {
    return {
      ok: false,
      reason: "low_signal",
      message:
        'I couldn\'t tell which itinerary change you wanted. Try a sentence like "Switch day 1 dinner to Jasper Brewing Co." or "Add a coffee stop on day 2 before we leave."',
    };
  }

  return { ok: true };
}
