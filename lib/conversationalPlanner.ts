import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptStartCity,
  extractPromptTravelerCount,
  PromptBudgetMatch,
} from "./tripIntent";
import {
  deriveSeasonFromDateRange,
  formatDisplayDate,
  getTodayIsoDate,
} from "./tripDates";
import {
  normalizePromptText,
  TRIP_PROMPT_MAX_CHARS,
} from "./promptLimits";
import {
  isStartCity,
  StartCity,
  START_CITY_OPTIONS,
} from "./startCities";
import { TripInput } from "./types";

export type PlannerSeason = "Spring" | "Summer" | "Fall" | "Winter";

export type IntakeQuestionField =
  | "travelerCount"
  | "startCity"
  | "tripTiming"
  | "tripLengthDays"
  | "budgetPerTraveler";

export type ConversationalAnswers = {
  travelerCount?: number;
  startCity?: StartCity;
  tripLengthDays?: number;
  season?: PlannerSeason;
  tripStartDate?: string;
  budgetPerTraveler?: number;
};

export type ConversationalDraft = {
  prompt: string;
  travelerCount?: number;
  startCity?: StartCity;
  tripLengthDays?: number;
  season?: PlannerSeason;
  tripStartDate?: string;
  budgetPerTraveler: number;
  hasExplicitBudget: boolean;
  maxDriveHours: number;
  promptBudget: PromptBudgetMatch | null;
  intent: ReturnType<typeof deriveTripIntentFromPrompt>;
};

type ParsedTiming = {
  season?: PlannerSeason;
  tripStartDate?: string;
};

const SEASON_BY_MONTH: Record<number, PlannerSeason> = {
  0: "Winter",
  1: "Winter",
  2: "Spring",
  3: "Spring",
  4: "Spring",
  5: "Summer",
  6: "Summer",
  7: "Summer",
  8: "Fall",
  9: "Fall",
  10: "Fall",
  11: "Winter",
};

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function formatDateAsIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeText(value?: string) {
  return (value ?? "").trim().toLowerCase();
}

function seasonFromText(value?: string): PlannerSeason | undefined {
  const text = normalizeText(value);

  if (/(^|\b)(spring)(\b|$)/i.test(text)) return "Spring";
  if (/(^|\b)(summer)(\b|$)/i.test(text)) return "Summer";
  if (/(^|\b)(fall|autumn)(\b|$)/i.test(text)) return "Fall";
  if (/(^|\b)(winter)(\b|$)/i.test(text)) return "Winter";

  for (const [name, monthIndex] of Object.entries(MONTH_INDEX_BY_NAME)) {
    if (new RegExp(`(^|\\b)${name}(\\b|$)`, "i").test(text)) {
      return SEASON_BY_MONTH[monthIndex];
    }
  }

  return undefined;
}

function parseRelativeTiming(text: string, referenceDate: Date): ParsedTiming | null {
  const normalized = normalizeText(text);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("today")) {
    const tripStartDate = getTodayIsoDate(referenceDate);
    return {
      tripStartDate,
      season: deriveSeasonFromDateRange(tripStartDate),
    };
  }

  if (normalized.includes("tomorrow")) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() + 1);
    const tripStartDate = formatDateAsIso(date);
    return {
      tripStartDate,
      season: deriveSeasonFromDateRange(tripStartDate),
    };
  }

  if (normalized.includes("this weekend") || normalized.includes("next weekend")) {
    const date = new Date(referenceDate);
    const currentDay = date.getDay();
    const daysUntilSaturday = (6 - currentDay + 7) % 7;
    date.setDate(
      date.getDate() + daysUntilSaturday + (normalized.includes("next weekend") ? 7 : 0)
    );

    const tripStartDate = formatDateAsIso(date);
    return {
      tripStartDate,
      season: deriveSeasonFromDateRange(tripStartDate),
    };
  }

  return null;
}

function parseExplicitDate(text: string, referenceDate: Date): ParsedTiming | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const isoMatch = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const tripStartDate = isoMatch[0];
    return {
      tripStartDate,
      season: deriveSeasonFromDateRange(tripStartDate),
    };
  }

  const monthDayMatch = normalized.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i
  );

  if (!monthDayMatch) {
    return null;
  }

  const monthIndex = MONTH_INDEX_BY_NAME[monthDayMatch[1].toLowerCase()];
  const day = Number.parseInt(monthDayMatch[2] ?? "", 10);
  const explicitYear = Number.parseInt(monthDayMatch[3] ?? "", 10);

  if (!Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null;
  }

  const year =
    Number.isFinite(explicitYear) && explicitYear > 2000
      ? explicitYear
      : referenceDate.getMonth() > monthIndex ||
          (referenceDate.getMonth() === monthIndex &&
            referenceDate.getDate() > day)
        ? referenceDate.getFullYear() + 1
        : referenceDate.getFullYear();

  const date = new Date(year, monthIndex, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const tripStartDate = formatDateAsIso(date);
  return {
    tripStartDate,
    season: deriveSeasonFromDateRange(tripStartDate),
  };
}

export function extractPromptTripLengthDays(value?: string) {
  const text = normalizeText(value);
  if (!text) return undefined;

  const dayMatch = text.match(
    /\b(\d{1,2})\s*(?:[- ]?\s*day(?:s)?)(?:\s+long)?\b/i
  );
  if (dayMatch) {
    const days = Number.parseInt(dayMatch[1] ?? "", 10);
    if (Number.isFinite(days) && days >= 1 && days <= 7) {
      return days;
    }
  }

  const nightsMatch = text.match(
    /\b(\d{1,2})\s*(?:[- ]?\s*night(?:s)?)(?:\s+long)?\b/i
  );
  if (nightsMatch) {
    const nights = Number.parseInt(nightsMatch[1] ?? "", 10);
    if (Number.isFinite(nights) && nights >= 1 && nights <= 6) {
      return nights + 1;
    }
  }

  return undefined;
}

export function extractPromptTiming(
  value?: string,
  referenceDate = new Date()
): ParsedTiming {
  const text = normalizeText(value);
  if (!text) return {};

  const explicitDate = parseExplicitDate(text, referenceDate);
  if (explicitDate) return explicitDate;

  const relativeTiming = parseRelativeTiming(text, referenceDate);
  if (relativeTiming) return relativeTiming;

  const season = seasonFromText(text);
  if (season) {
    return { season };
  }

  return {};
}

function resolveBudgetPerTraveler(options: {
  promptBudget: PromptBudgetMatch | null;
  travelerCount?: number;
  explicitBudgetPerTraveler?: number;
  suggestedBudgetPerTraveler?: number;
}) {
  if (
    typeof options.explicitBudgetPerTraveler === "number" &&
    Number.isFinite(options.explicitBudgetPerTraveler) &&
    options.explicitBudgetPerTraveler >= 75
  ) {
    return options.explicitBudgetPerTraveler;
  }

  if (options.promptBudget?.scope === "per_traveler") {
    return options.promptBudget.amount;
  }

  if (
    options.promptBudget?.scope === "group_total" &&
    typeof options.travelerCount === "number" &&
    options.travelerCount > 0
  ) {
    return Math.max(
      75,
      Math.round(options.promptBudget.amount / options.travelerCount)
    );
  }

  return options.suggestedBudgetPerTraveler ?? 300;
}

export function buildConversationalDraft(
  prompt: string,
  answers: ConversationalAnswers = {},
  referenceDate = new Date()
): ConversationalDraft {
  const intent = deriveTripIntentFromPrompt(prompt);
  const promptBudget = extractPromptBudget(prompt);
  const promptTiming = extractPromptTiming(prompt, referenceDate);

  const travelerCount =
    answers.travelerCount ?? extractPromptTravelerCount(prompt) ?? undefined;
  const startCity = answers.startCity ?? extractPromptStartCity(prompt);
  const tripLengthDays =
    answers.tripLengthDays ?? extractPromptTripLengthDays(prompt);
  const tripStartDate = answers.tripStartDate ?? promptTiming.tripStartDate;
  const season =
    answers.season ??
    promptTiming.season ??
    (tripStartDate ? deriveSeasonFromDateRange(tripStartDate) : undefined);
  const hasExplicitBudget =
    typeof answers.budgetPerTraveler === "number" || Boolean(promptBudget);

  return {
    prompt,
    travelerCount,
    startCity,
    tripLengthDays,
    season,
    tripStartDate,
    budgetPerTraveler: resolveBudgetPerTraveler({
      promptBudget,
      travelerCount,
      explicitBudgetPerTraveler: answers.budgetPerTraveler,
      suggestedBudgetPerTraveler: intent.suggestedBudgetPerTraveler,
    }),
    hasExplicitBudget,
    maxDriveHours: intent.suggestedMaxDriveHours ?? 5,
    promptBudget,
    intent,
  };
}

export function getNextIntakeQuestion(
  draft: ConversationalDraft
): IntakeQuestionField | null {
  if (!draft.travelerCount) return "travelerCount";
  if (!draft.startCity) return "startCity";
  if (!draft.season) return "tripTiming";
  if (!draft.tripLengthDays) return "tripLengthDays";
  if (!draft.hasExplicitBudget) return "budgetPerTraveler";
  return null;
}

function tryParseBudgetPerTraveler(
  value: string,
  travelerCount?: number
) {
  const parsedBudget = extractPromptBudget(value);
  if (parsedBudget?.scope === "per_traveler") {
    return parsedBudget.amount;
  }

  if (
    parsedBudget?.scope === "group_total" &&
    typeof travelerCount === "number" &&
    travelerCount > 0
  ) {
    return Math.max(75, Math.round(parsedBudget.amount / travelerCount));
  }

  const bareCurrencyMatch = normalizeText(value).match(/\$?\s*(\d{2,5})\b/);
  if (!bareCurrencyMatch) {
    return undefined;
  }

  const amount = Number.parseInt(bareCurrencyMatch[1] ?? "", 10);
  if (!Number.isFinite(amount) || amount < 75 || amount > 10000) {
    return undefined;
  }

  if (
    /\b(total|overall|for all of us|for the group|group)\b/i.test(value) &&
    typeof travelerCount === "number" &&
    travelerCount > 0
  ) {
    return Math.max(75, Math.round(amount / travelerCount));
  }

  return amount;
}

function tryParseTravelerCount(value?: string) {
  const text = normalizeText(value);
  const promptTravelerCount = extractPromptTravelerCount(text);
  if (promptTravelerCount) {
    return promptTravelerCount;
  }

  const match = text.match(/\b(\d{1,2})\b/);
  if (!match) return undefined;

  const travelerCount = Number.parseInt(match[1] ?? "", 10);
  if (Number.isFinite(travelerCount) && travelerCount >= 1 && travelerCount <= 12) {
    return travelerCount;
  }

  return undefined;
}

function tryParseStartCity(value?: string) {
  const text = normalizeText(value);
  if (!text) return undefined;

  for (const city of START_CITY_OPTIONS) {
    if (
      text === city.toLowerCase() ||
      text.includes(city.toLowerCase())
    ) {
      return city;
    }
  }

  return isStartCity(value) ? value : undefined;
}

function tryParseTripLengthDays(value?: string) {
  const text = normalizeText(value);
  if (!text) return undefined;

  const explicitDays = extractPromptTripLengthDays(text);
  if (explicitDays) return explicitDays;

  const match = text.match(/\b(\d{1,2})\b/);
  if (!match) return undefined;

  const days = Number.parseInt(match[1] ?? "", 10);
  if (Number.isFinite(days) && days >= 1 && days <= 7) {
    return days;
  }

  return undefined;
}

export function parseFollowUpAnswer(
  field: IntakeQuestionField,
  value: string,
  referenceDate = new Date(),
  draft?: ConversationalDraft
): ConversationalAnswers | null {
  if (field === "travelerCount") {
    const travelerCount = tryParseTravelerCount(value);
    return travelerCount ? { travelerCount } : null;
  }

  if (field === "startCity") {
    const startCity = tryParseStartCity(value);
    return startCity ? { startCity } : null;
  }

  if (field === "tripLengthDays") {
    const tripLengthDays = tryParseTripLengthDays(value);
    return tripLengthDays ? { tripLengthDays } : null;
  }

  if (field === "budgetPerTraveler") {
    const budgetPerTraveler = tryParseBudgetPerTraveler(
      value,
      draft?.travelerCount
    );
    return budgetPerTraveler ? { budgetPerTraveler } : null;
  }

  const timing = extractPromptTiming(value, referenceDate);
  if (!timing.season) {
    return null;
  }

  return timing;
}

export function getQuestionCopy(field: IntakeQuestionField) {
  switch (field) {
    case "travelerCount":
      return "How many people are going?";
    case "startCity":
      return "What city are you starting from?";
    case "tripTiming":
      return "When are you thinking of going? A month, season, or exact date is enough.";
    case "tripLengthDays":
      return "How many days should the trip be?";
    case "budgetPerTraveler":
      return "What budget should I plan around per person?";
    default:
      return "What should I fill in next?";
  }
}

export function getRetryCopy(field: IntakeQuestionField) {
  switch (field) {
    case "travelerCount":
      return "I need a traveler count between 1 and 12.";
    case "startCity":
      return "I can work with Alberta starting cities like Edmonton, Calgary, Red Deer, or Lethbridge.";
    case "tripTiming":
      return "Try something like June, this summer, next weekend, or 2026-06-14.";
    case "tripLengthDays":
      return "Try something like 2 days, 3-day trip, or 4 nights.";
    case "budgetPerTraveler":
      return "Try something like $300 each, 400 per person, or $1200 total for 4 people.";
    default:
      return "I still need that detail to continue.";
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildTimingClause(draft: ConversationalDraft) {
  if (draft.tripStartDate) {
    return `starting ${formatDisplayDate(draft.tripStartDate) ?? draft.tripStartDate}`;
  }

  if (draft.season) {
    return `in ${draft.season.toLowerCase()}`;
  }

  return undefined;
}

function promptBudgetMatchesDraft(
  promptBudget: PromptBudgetMatch | null,
  travelerCount: number | undefined,
  budgetPerTraveler: number
) {
  if (!promptBudget) {
    return false;
  }

  if (promptBudget.scope === "per_traveler") {
    return promptBudget.amount === budgetPerTraveler;
  }

  if (!travelerCount) {
    return false;
  }

  return promptBudget.amount === travelerCount * budgetPerTraveler;
}

function buildMissingPromptDetails(
  basePrompt: string,
  draft: ConversationalDraft
) {
  const details: string[] = [];
  const promptTiming = extractPromptTiming(basePrompt);

  if (draft.startCity && extractPromptStartCity(basePrompt) !== draft.startCity) {
    details.push(`from ${draft.startCity}`);
  }

  if (
    draft.travelerCount &&
    extractPromptTravelerCount(basePrompt) !== draft.travelerCount
  ) {
    details.push(`for ${pluralize(draft.travelerCount, "traveler")}`);
  }

  if (
    draft.tripLengthDays &&
    extractPromptTripLengthDays(basePrompt) !== draft.tripLengthDays
  ) {
    details.push(`for ${pluralize(draft.tripLengthDays, "day")}`);
  }

  if (draft.tripStartDate) {
    if (promptTiming.tripStartDate !== draft.tripStartDate) {
      details.push(buildTimingClause(draft)!);
    }
  } else if (draft.season && promptTiming.season !== draft.season) {
    details.push(buildTimingClause(draft)!);
  }

  if (
    !promptBudgetMatchesDraft(
      extractPromptBudget(basePrompt),
      draft.travelerCount,
      draft.budgetPerTraveler
    )
  ) {
    details.push(`with a budget of $${draft.budgetPerTraveler} per traveler`);
  }

  return details;
}

function promptConflictsWithResolvedDetails(
  basePrompt: string,
  draft: ConversationalDraft
) {
  const promptTravelerCount = extractPromptTravelerCount(basePrompt);
  if (
    draft.travelerCount &&
    promptTravelerCount &&
    promptTravelerCount !== draft.travelerCount
  ) {
    return true;
  }

  const promptStartCity = extractPromptStartCity(basePrompt);
  if (draft.startCity && promptStartCity && promptStartCity !== draft.startCity) {
    return true;
  }

  const promptTripLengthDays = extractPromptTripLengthDays(basePrompt);
  if (
    draft.tripLengthDays &&
    promptTripLengthDays &&
    promptTripLengthDays !== draft.tripLengthDays
  ) {
    return true;
  }

  const promptTiming = extractPromptTiming(basePrompt);
  if (
    draft.tripStartDate &&
    promptTiming.tripStartDate &&
    promptTiming.tripStartDate !== draft.tripStartDate
  ) {
    return true;
  }

  if (draft.season && promptTiming.season && promptTiming.season !== draft.season) {
    return true;
  }

  const promptBudget = extractPromptBudget(basePrompt);
  if (
    promptBudget &&
    !promptBudgetMatchesDraft(
      promptBudget,
      draft.travelerCount,
      draft.budgetPerTraveler
    )
  ) {
    return true;
  }

  return false;
}

function describeTripSubject(draft: ConversationalDraft) {
  if (draft.intent.activityFocus === "skiing") {
    return "skiing trip";
  }

  if (draft.intent.activityFocus === "hiking") {
    return "hiking trip";
  }

  if (draft.intent.activityFocus === "camping") {
    return "camping trip";
  }

  switch (draft.intent.style) {
    case "foodie":
      return "food-focused trip";
    case "outdoors":
      return "outdoor trip";
    case "adventure":
      return "adventure trip";
    case "chill":
      return "slow-paced trip";
    case "solo reset":
      return "solo reset trip";
    case "hidden gems":
      return "hidden-gems trip";
    default:
      return "Alberta trip";
  }
}

function buildStructuredTripPrompt(draft: ConversationalDraft) {
  const destination = draft.intent.preferredDestination
    ? ` in ${draft.intent.preferredDestination}`
    : " in Alberta";
  const origin = draft.startCity ? ` from ${draft.startCity}` : "";
  const groupAndLength =
    draft.travelerCount && draft.tripLengthDays
      ? ` for ${pluralize(draft.travelerCount, "traveler")} over ${pluralize(
          draft.tripLengthDays,
          "day"
        )}`
      : draft.travelerCount
        ? ` for ${pluralize(draft.travelerCount, "traveler")}`
        : draft.tripLengthDays
          ? ` for ${pluralize(draft.tripLengthDays, "day")}`
          : "";
  const extraClauses = [
    buildTimingClause(draft),
    `with a budget of $${draft.budgetPerTraveler} per traveler`,
  ].filter((value): value is string => Boolean(value));

  const summary = `${describeTripSubject(draft)}${destination}${origin}${groupAndLength}`;
  const canonicalPrompt = `${summary.charAt(0).toUpperCase()}${summary.slice(1)}${
    extraClauses.length > 0 ? `, ${extraClauses.join(", ")}` : ""
  }.`;

  return canonicalPrompt.length <= TRIP_PROMPT_MAX_CHARS
    ? canonicalPrompt
    : canonicalPrompt.slice(0, TRIP_PROMPT_MAX_CHARS).trimEnd();
}

export function buildCanonicalTripPrompt(draft: ConversationalDraft) {
  const basePrompt = normalizePromptText(draft.prompt);
  if (!basePrompt) {
    return buildStructuredTripPrompt(draft);
  }

  if (promptConflictsWithResolvedDetails(basePrompt, draft)) {
    return buildStructuredTripPrompt(draft);
  }

  const missingDetails = buildMissingPromptDetails(basePrompt, draft);
  if (missingDetails.length === 0) {
    return basePrompt;
  }

  const trimmedBasePrompt = basePrompt.replace(/\s*[.!?]+\s*$/, "");
  const appendedPrompt = `${trimmedBasePrompt}, ${missingDetails.join(", ")}.`;

  return appendedPrompt.length <= TRIP_PROMPT_MAX_CHARS
    ? appendedPrompt
    : basePrompt;
}

export function buildTripInputFromDraft(
  draft: ConversationalDraft
): TripInput | null {
  if (
    !draft.startCity ||
    !draft.travelerCount ||
    !draft.tripLengthDays ||
    !draft.season
  ) {
    return null;
  }

  return {
    startCity: draft.startCity,
    maxDriveHours: draft.maxDriveHours,
    maxDriveMinutesBetweenStops: 45,
    budget: draft.travelerCount * draft.budgetPerTraveler,
    budgetPerTraveler: draft.budgetPerTraveler,
    travelerCount: draft.travelerCount,
    tripLengthDays: draft.tripLengthDays,
    season: draft.season,
    style: draft.intent.style,
    tripPrompt: buildCanonicalTripPrompt(draft),
    activityFocus: draft.intent.activityFocus,
    veganFriendly: draft.intent.veganFriendly,
    includeStaycations: draft.intent.includeStaycations,
    strictBudget: draft.intent.strictBudget,
    preferredDestination: draft.intent.preferredDestination,
    tripStartDate: draft.tripStartDate,
    tripEndDate: undefined,
    departureTime: undefined,
  };
}
