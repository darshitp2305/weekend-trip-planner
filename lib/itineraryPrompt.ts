import { estimateFoodCostForGroup } from "./foodPricing";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
  TripCustomStop,
  TripSelectionState,
} from "./types";
import { normalizeSelectionState } from "./tripSelections";

type EditableKind = "stay" | "food" | "activity";
type PromptAction = "replace" | "add";

type PromptTargetStop = {
  dayIndex?: number;
  stopIndex?: number;
  stop?: ItineraryDayData["stops"][number];
  key?: string;
};

type CatalogMatch =
  | {
      kind: "stay";
      name: string;
      hotel: HotelOption;
      sourceScope: "base";
    }
  | {
      kind: "food";
      name: string;
      food: FoodSpot;
      sourceScope: "base" | "external";
    }
  | {
      kind: "activity";
      name: string;
      activity: Activity;
      sourceScope: "base" | "external";
    };

export type AppliedItineraryPromptChange = {
  kind: EditableKind;
  dayIndex?: number;
  stopKey?: string;
  targetLabel: string;
  selectedName: string;
  mode: "updated" | "added";
  source: "catalog" | "custom";
};

export type ApplyItineraryPromptResult = {
  selection: TripSelectionState;
  appliedChanges: AppliedItineraryPromptChange[];
  issues: string[];
};

type ApplyItineraryPromptInput = {
  prompt: string;
  days: ItineraryDayData[];
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  externalFoodSpots?: FoodSpot[];
  activities: Activity[];
  externalActivities?: Activity[];
  selection: TripSelectionState;
  travelerCount?: number;
};

type StopReference = {
  dayIndex: number;
  stopIndex: number;
  stop: ItineraryDayData["stops"][number];
  label: string;
  latitude?: number;
  longitude?: number;
};

const DAY_WORDS: Record<string, number> = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
};

const GENERIC_MATCH_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "near",
  "hotel",
  "resort",
  "lodge",
  "inn",
  "motel",
  "cafe",
  "restaurant",
  "grill",
  "bar",
  "kitchen",
  "bistro",
  "eatery",
  "activity",
  "adventure",
  "trail",
  "trailhead",
  "tour",
  "food",
  "stay",
  "meal",
  "spot",
  "stop",
  "event",
  "day",
]);

const GENERIC_FOOD_REQUEST_TOKENS = new Set([
  "i",
  "we",
  "to",
  "want",
  "wants",
  "wanted",
  "need",
  "needs",
  "go",
  "eat",
  "somewhere",
  "something",
  "place",
  "before",
  "after",
  "back",
  "return",
  "leave",
  "leaving",
  "going",
  "head",
  "heading",
  "drive",
  "driving",
  "trip",
  "edmonton",
  "calgary",
  "there",
  "here",
  "grab",
  "meal",
  "food",
  "restaurant",
  "lunch",
  "dinner",
  "breakfast",
  "brunch",
  "coffee",
]);

const FOOD_PREFERENCE_TOKENS = new Set([
  "greek",
  "mediterranean",
  "italian",
  "pizza",
  "pasta",
  "mexican",
  "taco",
  "tacos",
  "indian",
  "thai",
  "vietnamese",
  "japanese",
  "sushi",
  "ramen",
  "korean",
  "chinese",
  "seafood",
  "steak",
  "steakhouse",
  "burger",
  "bbq",
  "barbecue",
  "vegetarian",
  "vegan",
  "healthy",
  "quiet",
  "cozy",
  "casual",
  "quick",
  "bakery",
  "dessert",
  "cafe",
  "coffee",
  "brunch",
  "breakfast",
  "lunch",
  "dinner",
  "pub",
  "brewery",
  "patio",
  "romantic",
  "affordable",
  "cheap",
  "upscale",
  "family",
  "friendly",
  "comfort",
]);

const GENERIC_ACTIVITY_REQUEST_TOKENS = new Set([
  "i",
  "we",
  "to",
  "want",
  "wants",
  "wanted",
  "need",
  "needs",
  "go",
  "going",
  "do",
  "visit",
  "replace",
  "switch",
  "change",
  "instead",
  "somewhere",
  "something",
  "place",
  "spot",
  "activity",
  "event",
  "nice",
  "good",
  "great",
  "fun",
  "quiet",
  "relaxing",
  "relaxed",
  "easy",
  "gentle",
  "the",
  "a",
  "an",
  "in",
  "around",
  "near",
  "nearby",
  "area",
  "there",
  "here",
  "for",
  "after",
  "before",
  "back",
  "leave",
  "heading",
  "return",
]);

const ACTIVITY_PREFERENCE_TOKENS = new Set([
  "swim",
  "swimming",
  "pool",
  "beach",
  "lake",
  "lakeside",
  "water",
  "waterfront",
  "hot",
  "spring",
  "springs",
  "spa",
  "kayak",
  "canoe",
  "paddle",
  "paddleboard",
  "paddleboarding",
  "raft",
  "rafting",
  "float",
  "floating",
  "walk",
  "walking",
  "trail",
  "hike",
  "hiking",
  "lookout",
  "viewpoint",
  "scenic",
  "relax",
  "relaxing",
  "quiet",
  "museum",
  "gallery",
  "wildlife",
  "adventure",
  "gondola",
  "sightseeing",
  "tour",
  "indoor",
  "outdoor",
]);

function normalized(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stopKey(dayIndex: number, stopIndex: number) {
  return `day-${dayIndex}-stop-${stopIndex}`;
}

function dayKey(dayIndex: number) {
  return `day-${dayIndex}`;
}

function tokenize(value?: string, stripGeneric = false) {
  return normalized(value)
    .split(" ")
    .filter((token) => token.length >= 2)
    .filter((token) => !stripGeneric || !GENERIC_MATCH_TOKENS.has(token));
}

function capitalizePhrase(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

function splitPromptIntoInstructions(prompt: string) {
  return prompt
    .replace(/\s+\b(?:and then|then|also)\b\s+/gi, "\n")
    .replace(
      /\s+\band\b\s+(?=(?:the\s+)?(?:hotel|stay|activity|food|meal|breakfast|brunch|lunch|dinner|coffee|event|stop)\b)/gi,
      "\n"
    )
    .split(/\r?\n|[.;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveExplicitDayIndex(text: string, dayCount: number) {
  const lowered = text.toLowerCase();

  const numericMatch = lowered.match(/\bday\s+(\d+)\b/);
  if (numericMatch) {
    const parsed = Number.parseInt(numericMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= dayCount) {
      return parsed - 1;
    }
    return null;
  }

  const prefixedNamedMatch = lowered.match(
    /\bday\s+(one|two|three|four|five|six|seven|first|second|third|fourth|fifth|sixth|seventh)\b/
  );
  if (prefixedNamedMatch) {
    const parsed = DAY_WORDS[prefixedNamedMatch[1]];
    if (parsed >= 1 && parsed <= dayCount) {
      return parsed - 1;
    }
    return null;
  }

  const ordinalDayMatch = lowered.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh)\s+day\b/
  );
  if (ordinalDayMatch) {
    const parsed = DAY_WORDS[ordinalDayMatch[1]];
    if (parsed >= 1 && parsed <= dayCount) {
      return parsed - 1;
    }
    return null;
  }

  if (/\b(?:last|final)\s+day\b/.test(lowered)) {
    return Math.max(0, dayCount - 1);
  }

  return undefined;
}

function hasFoodIntent(text: string) {
  return /\b(food|restaurant|eat|meal|breakfast|brunch|lunch|dinner|coffee)\b/i.test(
    text
  );
}

function hasStayIntent(text: string) {
  return /\b(hotel|stay|lodging|accommodation|check in|resort)\b/i.test(text);
}

function hasActivityIntent(text: string) {
  return /\b(activity|event|hike|trail|walk|museum|spa|gondola|ski|paddle|tour|adventure|sightseeing|swim|swimming|pool|beach|lake|hot spring|hot springs|float|floating|kayak|canoe|rafting|lookout|viewpoint)\b/i.test(
    text
  );
}

function inferAction(instruction: string): PromptAction {
  if (
    /\b(change|switch|swap|replace|turn .* into|make .* instead|instead of)\b/i.test(
      instruction
    )
  ) {
    return "replace";
  }

  if (
    /\b(add|include|fit in|squeeze in|insert|plan|schedule|also have|also do|another|extra)\b/i.test(
      instruction
    )
  ) {
    return "add";
  }

  if (
    /\b(after|before (?:i|we) (?:go|head|leave)|before heading back|before (?:the )?drive back|before going back)\b/i.test(
      instruction
    )
  ) {
    return "add";
  }

  return "replace";
}

function cleanDesiredText(value: string) {
  return value
    .replace(/^(?:can|could|would|will)\s+you\s+/i, "")
    .replace(
      /^on\s+(?:day\s+\d+|day\s+(?:one|two|three|four|five|six|seven|first|second|third|fourth|fifth|sixth|seventh)|(?:first|second|third|fourth|fifth|sixth|seventh|last|final)\s+day)\s+/i,
      ""
    )
    .replace(
      /^(?:the\s+)?(?:hotel|stay|activity|event|food stop|food|restaurant)\s+/i,
      ""
    )
    .replace(
      /^(?:i\s+want\s+to|we\s+want\s+to|i\s+need\s+to|we\s+need\s+to|i\s+would\s+like\s+to|we\s+would\s+like\s+to|i\s+want|we\s+want)\s+/i,
      ""
    )
    .replace(/^(?:go|head|stop|eat|get|have|do|visit)\s+(?:to|for|at|on)\s+/i, "")
    .replace(/\b(?:please|thanks|thank you)\b/gi, "")
    .replace(/\b(?:instead)\b/gi, "")
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDesiredText(instruction: string) {
  const patterns = [
    /\b(?:go|head|stop|eat|get|have|do|visit|pick|choose|select)\b(?:\s+(?:to|for|at|on))?\s+(.+?)\s+\binstead of\b/i,
    /\b(?:change|switch|swap|replace)\b.*?\b(?:to|with|for)\s+(.+)$/i,
    /\b(?:add|include|fit in|squeeze in|insert|schedule|plan)\s+(.+)$/i,
    /\b(?:stay at|book|pick|choose|select|visit|do|have)\s+(.+)$/i,
    /\b(?:go|head|stop|eat|get|have|do|visit)\b(?:\s+(?:to|for|at|on))?\s+(.+)$/i,
    /\b(?:to|with|for)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = instruction.match(pattern);
    if (match?.[1]) {
      return cleanDesiredText(match[1]);
    }
  }

  return cleanDesiredText(instruction);
}

function scoreCandidateMatch(query: string, candidateName: string, candidateSearch: string) {
  const normalizedQuery = normalized(query);
  if (!normalizedQuery) return 0;

  const normalizedName = normalized(candidateName);
  const normalizedSearch = normalized(candidateSearch);

  if (!normalizedName || !normalizedSearch) {
    return 0;
  }

  if (normalizedQuery.includes(normalizedName)) {
    return 1000 + normalizedName.length;
  }

  if (normalizedName.includes(normalizedQuery) && normalizedQuery.length >= 4) {
    return 700 + normalizedQuery.length;
  }

  const queryTokens = Array.from(new Set(tokenize(normalizedQuery, true)));
  const nameTokens = Array.from(new Set(tokenize(normalizedName, true)));
  const searchTokens = Array.from(new Set(tokenize(normalizedSearch, true)));

  if (queryTokens.length === 0) {
    return 0;
  }

  const overlap = nameTokens.filter((token) => queryTokens.includes(token)).length;
  const searchOverlap = searchTokens.filter((token) => queryTokens.includes(token)).length;
  const matchedQueryTokens = queryTokens.filter(
    (token) => nameTokens.includes(token) || searchTokens.includes(token)
  ).length;

  if (overlap === 0 && searchOverlap === 0 && matchedQueryTokens === 0) {
    return 0;
  }

  const nameCoverage = nameTokens.length > 0 ? overlap / nameTokens.length : 0;
  const queryCoverage = matchedQueryTokens / queryTokens.length;

  return (
    overlap * 70 +
    nameCoverage * 180 +
    Math.min(searchOverlap, 4) * 55 +
    queryCoverage * 220
  );
}

function findBestCatalogMatch(options: {
  query: string;
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  externalFoodSpots?: FoodSpot[];
  activities: Activity[];
  externalActivities?: Activity[];
  preferredKind?: EditableKind;
}): CatalogMatch | null {
  const scored: Array<{ match: CatalogMatch; score: number }> = [];

  if (!options.preferredKind || options.preferredKind === "stay") {
    options.hotels.forEach((hotel) => {
      scored.push({
        match: { kind: "stay", name: hotel.name, hotel, sourceScope: "base" },
        score:
          scoreCandidateMatch(
            options.query,
            hotel.name,
            [hotel.name, hotel.shortDescription].filter(Boolean).join(" ")
          ) + (hotel.rating ?? 0) * 8,
      });
    });
  }

  if (!options.preferredKind || options.preferredKind === "food") {
    options.foodSpots.forEach((food) => {
      scored.push({
        match: { kind: "food", name: food.name, food, sourceScope: "base" },
        score:
          scoreCandidateMatch(
            options.query,
            food.name,
            [food.name, food.category, food.shortDescription, ...(food.tags ?? [])]
              .filter(Boolean)
              .join(" ")
          ) + (food.rating ?? 0) * 10,
      });
    });

    (options.externalFoodSpots ?? []).forEach((food) => {
      scored.push({
        match: { kind: "food", name: food.name, food, sourceScope: "external" },
        score:
          scoreCandidateMatch(
            options.query,
            food.name,
            [food.name, food.category, food.shortDescription, ...(food.tags ?? [])]
              .filter(Boolean)
              .join(" ")
          ) + (food.rating ?? 0) * 10,
      });
    });
  }

  if (!options.preferredKind || options.preferredKind === "activity") {
    options.activities.forEach((activity) => {
      scored.push({
        match: {
          kind: "activity",
          name: activity.name,
          activity,
          sourceScope: "base",
        },
        score:
          scoreCandidateMatch(
            options.query,
            activity.name,
            [activity.name, activity.type, activity.shortDescription]
              .filter(Boolean)
              .join(" ")
          ) + (activity.rating ?? 0) * 10,
      });
    });

    (options.externalActivities ?? []).forEach((activity) => {
      scored.push({
        match: {
          kind: "activity",
          name: activity.name,
          activity,
          sourceScope: "external",
        },
        score:
          scoreCandidateMatch(
            options.query,
            activity.name,
            [activity.name, activity.type, activity.shortDescription]
              .filter(Boolean)
              .join(" ")
          ) + (activity.rating ?? 0) * 10,
      });
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const next = scored[1];

  if (!best || best.score < (options.preferredKind ? 110 : 150)) {
    return null;
  }

  if (
    next &&
    best.score < 1000 &&
    best.score - next.score < (options.preferredKind ? 1 : 35)
  ) {
    return null;
  }

  return best.match;
}

function inferInstructionKind(
  instruction: string,
  desiredText: string,
  hotels: HotelOption[],
  foodSpots: FoodSpot[],
  activities: Activity[],
  fallbackKind?: EditableKind
): EditableKind | null {
  if (hasStayIntent(instruction)) return "stay";
  if (hasFoodIntent(instruction)) return "food";
  if (hasActivityIntent(instruction)) return "activity";

  const match = findBestCatalogMatch({
    query: desiredText,
    hotels,
    foodSpots,
    activities,
  });

  return match?.kind ?? fallbackKind ?? null;
}

function refersToPreviousSelection(instruction: string) {
  return /\b(?:it|that|this|that one|this one|same one)\b/i.test(instruction);
}

function collectStopsForKind(
  days: ItineraryDayData[],
  dayIndex: number,
  kind: EditableKind
) {
  return (days[dayIndex]?.stops ?? [])
    .map((stop, stopIndex) => ({
      dayIndex,
      stopIndex,
      stop,
      key: stopKey(dayIndex, stopIndex),
    }))
    .filter(({ stop }) => stop.kind === kind);
}

function firstStayTarget(days: ItineraryDayData[]) {
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const stayStop = collectStopsForKind(days, dayIndex, "stay")[0];
    if (stayStop) return stayStop;
  }

  return undefined;
}

function instructionStopScore(
  instruction: string,
  stop?: ItineraryDayData["stops"][number]
) {
  if (!stop) return 0;

  const stopText = [stop.time, stop.title, stop.description].filter(Boolean).join(" ");
  let score = scoreCandidateMatch(instruction, stop.title, stopText);

  if (
    /\b(breakfast|coffee|morning)\b/i.test(instruction) &&
    /\b(morning|breakfast|coffee)\b/i.test(stopText)
  ) {
    score += 180;
  }

  if (
    /\b(lunch|brunch|midday|late morning|afternoon)\b/i.test(instruction) &&
    /\b(lunch|brunch|midday|late morning|afternoon)\b/i.test(stopText)
  ) {
    score += 180;
  }

  if (
    /\b(dinner|evening|night)\b/i.test(instruction) &&
    /\b(dinner|evening|night)\b/i.test(stopText)
  ) {
    score += 180;
  }

  return score;
}

function resolvePromptTargetStop(options: {
  kind: EditableKind;
  instruction: string;
  dayIndex?: number;
  days: ItineraryDayData[];
}) {
  const { dayIndex, days, instruction, kind } = options;

  if (kind === "stay") {
    const explicitDayStay =
      typeof dayIndex === "number"
        ? collectStopsForKind(days, dayIndex, "stay")[0]
        : undefined;

    return explicitDayStay ?? firstStayTarget(days);
  }

  if (typeof dayIndex !== "number") {
    return null;
  }

  const editableStops = collectStopsForKind(days, dayIndex, kind);
  if (editableStops.length === 0) {
    return null;
  }

  if (editableStops.length === 1) {
    return editableStops[0];
  }

  const scored = editableStops
    .map((stopTarget) => ({
      stopTarget,
      score: instructionStopScore(instruction, stopTarget.stop),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const next = scored[1];

  if (!best) {
    return null;
  }

  if (best.score > 0 && (!next || best.score > next.score)) {
    return best.stopTarget;
  }

  return editableStops[0];
}

function extractAfterAnchorText(instruction: string) {
  const match = instruction.match(
    /\bafter\s+(.+?)(?=(?:,|\bbefore\b|\bthen\b|\band\b|\bi want\b|\bwe want\b|$))/i
  );

  return match?.[1]?.trim();
}

function stopLabelForReference(
  dayIndex: number,
  stopIndex: number,
  stop: ItineraryDayData["stops"][number],
  selection: TripSelectionState,
  foodSpots: FoodSpot[],
  activities: Activity[]
) {
  const key = stopKey(dayIndex, stopIndex);
  const customStop = selection.customStops?.[key];
  if (customStop?.kind === stop.kind) {
    return customStop?.title ?? stop.title;
  }

  if (stop.kind === "food") {
    return (
      selection.foods[key] ??
      foodSpots.find((spot) => normalized(spot.name) === normalized(stop.title))?.name ??
      stop.title
    );
  }

  if (stop.kind === "activity") {
    return (
      selection.activities[key] ??
      activities.find((activity) => normalized(activity.name) === normalized(stop.title))
        ?.name ??
      stop.title
    );
  }

  if (stop.kind === "stay") {
    return selection.hotelName ?? stop.title;
  }

  return stop.title;
}

function stopCoordinateForReference(
  dayIndex: number,
  stopIndex: number,
  stop: ItineraryDayData["stops"][number],
  selection: TripSelectionState,
  foodSpots: FoodSpot[],
  activities: Activity[]
) {
  const key = stopKey(dayIndex, stopIndex);
  const customStop = selection.customStops?.[key];
  if (customStop?.kind === stop.kind) {
    return {
      latitude: customStop?.latitude,
      longitude: customStop?.longitude,
    };
  }

  if (stop.kind === "food") {
    const selectedFood =
      foodSpots.find((spot) => spot.name === selection.foods[key]) ??
      foodSpots.find((spot) => normalized(spot.name) === normalized(stop.title));
    return {
      latitude: selectedFood?.latitude,
      longitude: selectedFood?.longitude,
    };
  }

  if (stop.kind === "activity") {
    const selectedActivity =
      activities.find((activity) => activity.name === selection.activities[key]) ??
      activities.find((activity) => normalized(activity.name) === normalized(stop.title));
    return {
      latitude: selectedActivity?.latitude,
      longitude: selectedActivity?.longitude,
    };
  }

  return {
    latitude: undefined,
    longitude: undefined,
  };
}

function resolveAnchorStopReference(options: {
  dayIndex: number;
  instruction: string;
  days: ItineraryDayData[];
  selection: TripSelectionState;
  foodSpots: FoodSpot[];
  activities: Activity[];
}) {
  const anchorText = extractAfterAnchorText(options.instruction);
  if (!anchorText) return null;

  const stops = options.days[options.dayIndex]?.stops ?? [];
  const candidates: Array<{ ref: StopReference; score: number }> = [];

  stops.forEach((stop, stopIndex) => {
    const label = stopLabelForReference(
      options.dayIndex,
      stopIndex,
      stop,
      options.selection,
      options.foodSpots,
      options.activities
    );
    const coordinate = stopCoordinateForReference(
      options.dayIndex,
      stopIndex,
      stop,
      options.selection,
      options.foodSpots,
      options.activities
    );

    candidates.push({
      ref: {
        dayIndex: options.dayIndex,
        stopIndex,
        stop,
        label,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      },
      score: scoreCandidateMatch(anchorText, label, [label, stop.description].filter(Boolean).join(" ")),
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] && candidates[0].score >= 120 ? candidates[0].ref : null;
}

function haversineDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
) {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function proximityScore(distanceKm?: number) {
  if (distanceKm === undefined) return 0;
  if (distanceKm <= 0.5) return 140;
  if (distanceKm <= 2) return 110;
  if (distanceKm <= 5) return 80;
  if (distanceKm <= 10) return 45;
  if (distanceKm <= 20) return 10;
  if (distanceKm <= 40) return -40;
  return -100;
}

function isGenericFoodRequest(desiredText: string) {
  if (
    /\b(?:eat|grab|get|have|find|pick)\s+(?:somewhere|something)\b/i.test(
      desiredText
    )
  ) {
    return true;
  }

  if (
    /\b(?:meal|food|restaurant|lunch|dinner|breakfast|brunch|coffee)\b.*\bbefore\s+(?:going|heading|driving|leaving|returning|getting)\b/i.test(
      desiredText
    )
  ) {
    return true;
  }

  const filtered = tokenize(desiredText).filter(
    (token) => !GENERIC_FOOD_REQUEST_TOKENS.has(token)
  );

  return filtered.length === 0;
}

function isFoodPreferenceRequest(desiredText: string) {
  if (isGenericFoodRequest(desiredText)) {
    return true;
  }

  const tokens = tokenize(desiredText, true);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => FOOD_PREFERENCE_TOKENS.has(token));
}

function isGenericActivityRequest(desiredText: string) {
  if (
    /\b(?:go|do|visit|find|pick|choose|replace)\b.*\b(swim|swimming|pool|beach|lake|hot spring|hot springs|spa|kayak|canoe|paddle|raft|rafting|walk|trail|hike|lookout|viewpoint|museum|gallery)\b/i.test(
      desiredText
    )
  ) {
    return true;
  }

  const filtered = tokenize(desiredText).filter(
    (token) => !GENERIC_ACTIVITY_REQUEST_TOKENS.has(token)
  );

  return filtered.length === 0;
}

function isActivityPreferenceRequest(desiredText: string) {
  if (isGenericActivityRequest(desiredText)) {
    return true;
  }

  const filtered = tokenize(desiredText).filter(
    (token) => !GENERIC_ACTIVITY_REQUEST_TOKENS.has(token)
  );
  if (filtered.length === 0) {
    return true;
  }

  return filtered.every((token) => ACTIVITY_PREFERENCE_TOKENS.has(token));
}

function selectedHotelCoordinate(
  selection: TripSelectionState,
  hotels: HotelOption[]
) {
  const selectedHotel = hotels.find((hotel) => hotel.name === selection.hotelName);
  if (
    typeof selectedHotel?.latitude === "number" &&
    typeof selectedHotel?.longitude === "number"
  ) {
    return {
      latitude: selectedHotel.latitude,
      longitude: selectedHotel.longitude,
      label: selectedHotel.name,
    };
  }

  return null;
}

function contextualFoodDistanceLimitKm(options: {
  instruction: string;
  targetStop?: PromptTargetStop | null;
}) {
  const lowered = options.instruction.toLowerCase();
  const targetTime = normalized(options.targetStop?.stop?.time);

  if (
    /\b(detour|worth the drive|road trip|on the way to|in calgary|in edmonton|in banff)\b/.test(
      lowered
    )
  ) {
    return 80;
  }

  if (
    /\b(after|before (?:i|we) leave|before leaving|before departure|before heading back|before (?:the )?drive back|before going back)\b/.test(
      lowered
    )
  ) {
    return 35;
  }

  if (
    /\b(breakfast|coffee|morning)\b/.test(lowered) ||
    targetTime === "morning"
  ) {
    return 18;
  }

  if (
    /\b(dinner|evening|night)\b/.test(lowered) ||
    targetTime === "evening" ||
    targetTime === "night"
  ) {
    return 24;
  }

  return 28;
}

function chooseContextualFoodMatch(options: {
  desiredText: string;
  instruction: string;
  dayIndex: number;
  days: ItineraryDayData[];
  selection: TripSelectionState;
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  externalFoodSpots?: FoodSpot[];
  activities: Activity[];
  targetStop?: PromptTargetStop | null;
  excludeSelectedNames?: boolean;
  requireSemanticMatch?: boolean;
}) {
  const anchorRef =
    resolveAnchorStopReference({
      dayIndex: options.dayIndex,
      instruction: options.instruction,
      days: options.days,
      selection: options.selection,
      foodSpots: options.foodSpots,
      activities: options.activities,
    }) ??
    (() => {
      const targetStop = options.targetStop;
      if (
        typeof targetStop?.dayIndex === "number" &&
        typeof targetStop?.stopIndex === "number" &&
        targetStop.stop
      ) {
        const coordinate = stopCoordinateForReference(
          targetStop.dayIndex,
          targetStop.stopIndex,
          targetStop.stop,
          options.selection,
          options.foodSpots,
          options.activities
        );

        if (
          typeof coordinate.latitude === "number" &&
          typeof coordinate.longitude === "number"
        ) {
          return {
            dayIndex: targetStop.dayIndex,
            stopIndex: targetStop.stopIndex,
            stop: targetStop.stop,
            label: targetStop.stop.title,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          } satisfies StopReference;
        }
      }

      const hotelCoordinate = selectedHotelCoordinate(options.selection, options.hotels);
      if (hotelCoordinate) {
        return {
          dayIndex: options.dayIndex,
          stopIndex: -1,
          stop: {
            kind: "stay",
            title: hotelCoordinate.label,
          } as ItineraryDayData["stops"][number],
          label: hotelCoordinate.label,
          latitude: hotelCoordinate.latitude,
          longitude: hotelCoordinate.longitude,
        } satisfies StopReference;
      }

      return null;
    })() ??
    (() => {
      const stops = options.days[options.dayIndex]?.stops ?? [];
      for (let index = stops.length - 1; index >= 0; index -= 1) {
        const stop = stops[index];
        if (stop.kind === "travel" || stop.kind === "stay") continue;
        const label = stopLabelForReference(
          options.dayIndex,
          index,
          stop,
          options.selection,
          options.foodSpots,
          options.activities
        );
        const coordinate = stopCoordinateForReference(
          options.dayIndex,
          index,
          stop,
          options.selection,
          options.foodSpots,
          options.activities
        );
        return {
          dayIndex: options.dayIndex,
          stopIndex: index,
          stop,
          label,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
        } satisfies StopReference;
      }
      return null;
    })();

  const selectedFoodNames = new Set<string>();
  (options.days[options.dayIndex]?.stops ?? []).forEach((stop, stopIndex) => {
    if (stop.kind !== "food") return;
    const key = stopKey(options.dayIndex, stopIndex);
    const name =
      options.selection.foods[key] ??
      options.foodSpots.find((spot) => normalized(spot.name) === normalized(stop.title))
        ?.name;
    if (name) selectedFoodNames.add(normalized(name));
  });

  const combinedFoodSpots = [
    ...options.foodSpots.map((spot) => ({ spot, sourceScope: "base" as const })),
    ...(options.externalFoodSpots ?? []).map((spot) => ({
      spot,
      sourceScope: "external" as const,
    })),
  ];
  const maxDistanceKm =
    typeof anchorRef?.latitude === "number" && typeof anchorRef?.longitude === "number"
      ? contextualFoodDistanceLimitKm({
          instruction: options.instruction,
          targetStop: options.targetStop,
        })
      : undefined;

  const scored = combinedFoodSpots
    .filter(
      ({ spot }) =>
        options.excludeSelectedNames === false ||
        !selectedFoodNames.has(normalized(spot.name))
    )
    .map(({ spot, sourceScope }) => {
      const distanceKm =
        typeof anchorRef?.latitude === "number" &&
        typeof anchorRef?.longitude === "number" &&
        typeof spot.latitude === "number" &&
        typeof spot.longitude === "number"
          ? haversineDistanceKm(
              { latitude: anchorRef.latitude, longitude: anchorRef.longitude },
              { latitude: spot.latitude, longitude: spot.longitude }
            )
          : undefined;

      const textScore = scoreCandidateMatch(
        options.desiredText,
        spot.name,
        [spot.name, spot.category, spot.shortDescription, ...(spot.tags ?? [])]
          .filter(Boolean)
          .join(" ")
      );

      return {
        spot,
        sourceScope,
        distanceKm,
        textScore,
        score: textScore + proximityScore(distanceKm) + (spot.rating ?? 0) * 8,
      };
    })
    .filter(
      ({ distanceKm }) =>
        maxDistanceKm === undefined ||
        distanceKm === undefined ||
        distanceKm <= maxDistanceKm
    )
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return null;
  }

  if (options.requireSemanticMatch && best.textScore < 110) {
    return null;
  }

  return {
    kind: "food",
    name: best.spot.name,
    food: best.spot,
    sourceScope: best.sourceScope,
  } as const;
}

function contextualActivityDistanceLimitKm(options: {
  instruction: string;
  targetStop?: PromptTargetStop | null;
}) {
  const lowered = options.instruction.toLowerCase();
  const targetTime = normalized(options.targetStop?.stop?.time);

  if (
    /\b(detour|worth the drive|road trip|on the way to|in calgary|in edmonton|in banff)\b/.test(
      lowered
    )
  ) {
    return 75;
  }

  if (
    /\b(after|before (?:i|we) leave|before leaving|before departure|before heading back|before (?:the )?drive back|before going back)\b/.test(
      lowered
    )
  ) {
    return 35;
  }

  if (
    /\b(swim|swimming|beach|lake|pool|hot spring|hot springs|spa)\b/.test(lowered)
  ) {
    return 28;
  }

  if (targetTime === "morning" || /\b(morning)\b/.test(lowered)) {
    return 22;
  }

  if (
    targetTime === "late morning" ||
    targetTime === "afternoon" ||
    /\b(late morning|afternoon)\b/.test(lowered)
  ) {
    return 30;
  }

  return 26;
}

function activitySemanticScore(desiredText: string, activity: Activity) {
  const searchText = normalized(
    [activity.name, activity.type, activity.shortDescription].filter(Boolean).join(" ")
  );
  const loweredDesiredText = normalized(desiredText);
  let score = 0;

  if (
    /\b(swim|swimming)\b/.test(loweredDesiredText) &&
    /\b(swim|swimming|lake|beach|pool|hot spring|hot springs|water|aquatic)\b/.test(
      searchText
    )
  ) {
    score += 280;
  }

  if (
    /\b(hot spring|hot springs|spa|relax|relaxing)\b/.test(loweredDesiredText) &&
    /\b(hot spring|hot springs|spa|wellness|bath|pool)\b/.test(searchText)
  ) {
    score += 240;
  }

  if (
    /\b(kayak|canoe|paddle|paddleboard|paddleboarding|raft|rafting|float|floating)\b/.test(
      loweredDesiredText
    ) &&
    /\b(kayak|canoe|paddle|paddleboard|rafting|raft|river|lake|water)\b/.test(searchText)
  ) {
    score += 240;
  }

  if (
    /\b(walk|walking|trail|hike|hiking|lookout|viewpoint|scenic)\b/.test(loweredDesiredText) &&
    /\b(walk|walking|trail|hike|hiking|lookout|viewpoint|scenic)\b/.test(searchText)
  ) {
    score += 220;
  }

  if (
    /\b(museum|gallery|art|history)\b/.test(loweredDesiredText) &&
    /\b(museum|gallery|art|history)\b/.test(searchText)
  ) {
    score += 220;
  }

  return score;
}

function chooseContextualActivityMatch(options: {
  desiredText: string;
  instruction: string;
  dayIndex: number;
  days: ItineraryDayData[];
  selection: TripSelectionState;
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  activities: Activity[];
  externalActivities?: Activity[];
  targetStop?: PromptTargetStop | null;
  excludeSelectedNames?: boolean;
  requireSemanticMatch?: boolean;
}) {
  const anchorRef =
    resolveAnchorStopReference({
      dayIndex: options.dayIndex,
      instruction: options.instruction,
      days: options.days,
      selection: options.selection,
      foodSpots: options.foodSpots,
      activities: options.activities,
    }) ??
    (() => {
      const targetStop = options.targetStop;
      if (
        typeof targetStop?.dayIndex === "number" &&
        typeof targetStop?.stopIndex === "number" &&
        targetStop.stop
      ) {
        const coordinate = stopCoordinateForReference(
          targetStop.dayIndex,
          targetStop.stopIndex,
          targetStop.stop,
          options.selection,
          options.foodSpots,
          options.activities
        );

        if (
          typeof coordinate.latitude === "number" &&
          typeof coordinate.longitude === "number"
        ) {
          return {
            dayIndex: targetStop.dayIndex,
            stopIndex: targetStop.stopIndex,
            stop: targetStop.stop,
            label: targetStop.stop.title,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          } satisfies StopReference;
        }
      }

      const hotelCoordinate = selectedHotelCoordinate(options.selection, options.hotels);
      if (hotelCoordinate) {
        return {
          dayIndex: options.dayIndex,
          stopIndex: -1,
          stop: {
            kind: "stay",
            title: hotelCoordinate.label,
          } as ItineraryDayData["stops"][number],
          label: hotelCoordinate.label,
          latitude: hotelCoordinate.latitude,
          longitude: hotelCoordinate.longitude,
        } satisfies StopReference;
      }

      return null;
    })();

  const selectedActivityNames = new Set<string>();
  (options.days[options.dayIndex]?.stops ?? []).forEach((stop, stopIndex) => {
    if (stop.kind !== "activity") return;
    const key = stopKey(options.dayIndex, stopIndex);
    const customStop = options.selection.customStops?.[key];
    const name =
      customStop?.kind === "activity"
        ? customStop.title
        : options.selection.activities[key] ??
          options.activities.find(
            (activity) => normalized(activity.name) === normalized(stop.title)
          )?.name;
    if (name) selectedActivityNames.add(normalized(name));
  });

  const combinedActivities = [
    ...options.activities.map((activity) => ({
      activity,
      sourceScope: "base" as const,
    })),
    ...(options.externalActivities ?? []).map((activity) => ({
      activity,
      sourceScope: "external" as const,
    })),
  ];
  const maxDistanceKm =
    typeof anchorRef?.latitude === "number" && typeof anchorRef?.longitude === "number"
      ? contextualActivityDistanceLimitKm({
          instruction: options.instruction,
          targetStop: options.targetStop,
        })
      : undefined;

  const scored = combinedActivities
    .filter(
      ({ activity }) =>
        options.excludeSelectedNames === false ||
        !selectedActivityNames.has(normalized(activity.name))
    )
    .map(({ activity, sourceScope }) => {
      const distanceKm =
        typeof anchorRef?.latitude === "number" &&
        typeof anchorRef?.longitude === "number" &&
        typeof activity.latitude === "number" &&
        typeof activity.longitude === "number"
          ? haversineDistanceKm(
              { latitude: anchorRef.latitude, longitude: anchorRef.longitude },
              { latitude: activity.latitude, longitude: activity.longitude }
            )
          : undefined;

      const textScore = scoreCandidateMatch(
        options.desiredText,
        activity.name,
        [activity.name, activity.type, activity.shortDescription]
          .filter(Boolean)
          .join(" ")
      );
      const semanticScore = activitySemanticScore(options.desiredText, activity);

      return {
        activity,
        sourceScope,
        distanceKm,
        semanticScore,
        textScore,
        score:
          textScore +
          semanticScore +
          proximityScore(distanceKm) +
          (activity.rating ?? 0) * 8,
      };
    })
    .filter(
      ({ distanceKm }) =>
        maxDistanceKm === undefined ||
        distanceKm === undefined ||
        distanceKm <= maxDistanceKm
    )
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return null;
  }

  if (options.requireSemanticMatch && best.semanticScore <= 0 && best.textScore < 110) {
    return null;
  }

  return {
    kind: "activity",
    name: best.activity.name,
    activity: best.activity,
    sourceScope: best.sourceScope,
  } as const;
}

function selectedNameForTargetStop(options: {
  kind: EditableKind;
  targetStop?: PromptTargetStop | null;
  selection: TripSelectionState;
  days: ItineraryDayData[];
  foodSpots: FoodSpot[];
  activities: Activity[];
}) {
  if (options.kind === "stay") {
    return (
      options.selection.hotelName ??
      firstStayTarget(options.days)?.stop.title ??
      undefined
    );
  }

  if (
    typeof options.targetStop?.dayIndex !== "number" ||
    typeof options.targetStop.stopIndex !== "number" ||
    !options.targetStop.stop
  ) {
    return undefined;
  }

  return stopLabelForReference(
    options.targetStop.dayIndex,
    options.targetStop.stopIndex,
    options.targetStop.stop,
    options.selection,
    options.foodSpots,
    options.activities
  );
}

function targetLabel(kind: EditableKind, target?: PromptTargetStop, mode: PromptAction = "replace") {
  if (mode === "add") {
    if (typeof target?.dayIndex === "number") {
      return `Day ${target.dayIndex + 1} added ${kind === "food" ? "stop" : kind}`;
    }
    return `Added ${kind}`;
  }

  if (kind === "stay") {
    if (typeof target?.dayIndex === "number") {
      return `Day ${target.dayIndex + 1} stay`;
    }
    return "Trip stay";
  }

  const dayPrefix =
    typeof target?.dayIndex === "number" ? `Day ${target.dayIndex + 1}` : "This day";
  const stopTime = target?.stop?.time?.trim();

  if (kind === "food") {
    return stopTime ? `${dayPrefix} ${stopTime.toLowerCase()}` : `${dayPrefix} food stop`;
  }

  return stopTime
    ? `${dayPrefix} ${stopTime.toLowerCase()} activity`
    : `${dayPrefix} activity`;
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function averageFoodCost(foodSpots: FoodSpot[], travelerCount: number) {
  const estimates = foodSpots
    .slice(0, 8)
    .map((spot) => estimateFoodCostForGroup(spot, travelerCount))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (estimates.length === 0) {
    return Math.max(20, travelerCount * 18);
  }

  return Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length);
}

function averageActivityCost(activities: Activity[], travelerCount: number) {
  const estimates = activities
    .map((activity) => (activity.costEstimate ?? activity.estimatedCost ?? 0) * travelerCount)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (estimates.length === 0) {
    return 0;
  }

  return Math.round(estimates.reduce((sum, value) => sum + value, 0) / estimates.length);
}

function inferCustomTime(instruction: string, day?: ItineraryDayData) {
  const lowered = instruction.toLowerCase();

  if (/\b(breakfast|coffee|morning)\b/.test(lowered)) return "morning";
  if (/\b(brunch|lunch|late morning)\b/.test(lowered)) return "late morning";
  if (/\b(afternoon)\b/.test(lowered)) return "afternoon";
  if (/\b(dinner|evening)\b/.test(lowered)) return "evening";
  if (/\b(night)\b/.test(lowered)) return "night";

  const firstTravelStop = day?.stops?.find((stop) => stop.kind === "travel");
  if (/\b(before (?:i|we) leave|before leaving|before departure|before heading back|before (?:the )?drive back)\b/.test(lowered)) {
    return firstTravelStop?.time ?? "afternoon";
  }

  return undefined;
}

function resolveInsertAfterStopIndex(
  day: ItineraryDayData | undefined,
  instruction: string,
  anchorStopIndex?: number
) {
  const stops = day?.stops ?? [];
  const lowered = instruction.toLowerCase();
  const firstTravelIndex = stops.findIndex((stop) => stop.kind === "travel");

  if (typeof anchorStopIndex === "number") {
    return anchorStopIndex;
  }

  if (
    /\b(before (?:i|we) leave|before leaving|before departure|before heading back|before (?:the )?drive back|before going back)\b/.test(
      lowered
    )
  ) {
    if (firstTravelIndex >= 0) {
      return firstTravelIndex - 1;
    }
  }

  if (/\b(breakfast|coffee|morning)\b/.test(lowered)) {
    return -1;
  }

  if (/\b(brunch|lunch|late morning)\b/.test(lowered)) {
    const lateMorningIndex = stops.findIndex(
      (stop) => stop.time === "late morning" || stop.time === "morning"
    );
    return lateMorningIndex >= 0 ? lateMorningIndex : Math.max(-1, firstTravelIndex - 1);
  }

  if (/\b(afternoon)\b/.test(lowered)) {
    const afternoonIndex = stops.findIndex((stop) => stop.time === "afternoon");
    return afternoonIndex >= 0 ? afternoonIndex - 1 : Math.max(-1, firstTravelIndex - 1);
  }

  return firstTravelIndex >= 0 ? firstTravelIndex - 1 : stops.length - 1;
}

function buildCustomStopTitle(kind: EditableKind, desiredText: string) {
  const cleaned = desiredText
    .replace(
      /^(?:a|an|the)\s+/i,
      ""
    )
    .replace(/^(?:meal|food|activity|event)\s+/i, (value) =>
      value.toLowerCase().includes("meal") ? "meal " : ""
    )
    .trim();

  if (cleaned) {
    return capitalizePhrase(cleaned);
  }

  if (kind === "food") return "Traveler-requested meal";
  if (kind === "activity") return "Traveler-requested activity";
  return "Traveler-requested stay";
}

function buildCustomStopFromCatalog(match: CatalogMatch, options: {
  instruction: string;
  day?: ItineraryDayData;
  travelerCount: number;
}): TripCustomStop | null {
  if (match.kind === "stay") {
    return null;
  }

  if (match.kind === "food") {
    return {
      id: createId("food"),
      kind: "food",
      title: match.food.name,
      description: match.food.shortDescription,
      time: inferCustomTime(options.instruction, options.day),
      estimatedCost: estimateFoodCostForGroup(match.food, options.travelerCount),
      category: match.food.category ?? match.food.tags?.[0] ?? "Food stop",
      rating: match.food.rating,
      websiteUrl: match.food.websiteUrl || match.food.link,
      mapsUrl: match.food.mapsUrl,
      photoRef: match.food.photoRef,
      photoUrl: match.food.photoUrl,
      latitude: match.food.latitude,
      longitude: match.food.longitude,
      sourcePrompt: options.instruction,
      sourceType: "catalog_match",
    };
  }

  return {
    id: createId("activity"),
    kind: "activity",
    title: match.activity.name,
    description: match.activity.shortDescription,
    time: inferCustomTime(options.instruction, options.day),
    estimatedCost:
      (match.activity.costEstimate ?? match.activity.estimatedCost ?? 0) *
      Math.max(1, options.travelerCount),
    category: match.activity.type,
    rating: match.activity.rating,
    websiteUrl: match.activity.websiteUrl || match.activity.bookingLink,
    mapsUrl: match.activity.mapsUrl,
    photoRef: match.activity.photoRef,
    photoUrl: match.activity.photoUrl,
    latitude: match.activity.latitude,
    longitude: match.activity.longitude,
    sourcePrompt: options.instruction,
    sourceType: "catalog_match",
  };
}

function buildCustomStopFromRequest(options: {
  kind: EditableKind;
  desiredText: string;
  instruction: string;
  day?: ItineraryDayData;
  travelerCount: number;
  foodSpots: FoodSpot[];
  activities: Activity[];
}): TripCustomStop | null {
  if (options.kind === "stay") {
    return null;
  }

  const title = buildCustomStopTitle(options.kind, options.desiredText);

  if (options.kind === "food") {
    return {
      id: createId("food"),
      kind: "food",
      title,
      description: `Traveler request: ${capitalizePhrase(options.desiredText)}`,
      time: inferCustomTime(options.instruction, options.day),
      estimatedCost: averageFoodCost(options.foodSpots, options.travelerCount),
      category: "Traveler request",
      sourcePrompt: options.instruction,
      sourceType: "custom_request",
    };
  }

  return {
    id: createId("activity"),
    kind: "activity",
    title,
    description: `Traveler request: ${capitalizePhrase(options.desiredText)}`,
    time: inferCustomTime(options.instruction, options.day),
    estimatedCost: averageActivityCost(options.activities, options.travelerCount),
    category: "Traveler request",
    sourcePrompt: options.instruction,
    sourceType: "custom_request",
  };
}

export function applyItineraryPrompt({
  prompt,
  days,
  hotels,
  foodSpots,
  externalFoodSpots = [],
  activities,
  externalActivities = [],
  selection,
  travelerCount = 1,
}: ApplyItineraryPromptInput): ApplyItineraryPromptResult {
  const instructions = splitPromptIntoInstructions(prompt);
  const nextSelection = normalizeSelectionState(selection);
  const appliedChanges: AppliedItineraryPromptChange[] = [];
  const issues: string[] = [];

  let inheritedDayIndex: number | undefined;
  let inheritedKind: EditableKind | undefined;
  let inheritedTargetStop: PromptTargetStop | null = null;

  instructions.forEach((instruction) => {
    const explicitDayIndex = resolveExplicitDayIndex(instruction, days.length);

    if (explicitDayIndex === null) {
      issues.push(`"${instruction}" mentions a day outside this itinerary.`);
      return;
    }

    if (typeof explicitDayIndex === "number") {
      inheritedDayIndex = explicitDayIndex;
    }

    const dayIndex = explicitDayIndex ?? inheritedDayIndex;
    const desiredText = extractDesiredText(instruction);
    const shouldReusePreviousSelection = refersToPreviousSelection(instruction);
    const kind = inferInstructionKind(
      instruction,
      desiredText,
      hotels,
      foodSpots,
      activities,
      shouldReusePreviousSelection ? inheritedKind : undefined
    );

    if (!kind) {
      issues.push(
        `Couldn't tell whether "${instruction}" should change a stay, food stop, or activity.`
      );
      return;
    }

    if ((kind === "food" || kind === "activity") && typeof dayIndex !== "number") {
      issues.push(`Mention a day for "${instruction}" so I know where to place it.`);
      return;
    }

    const action = inferAction(instruction);
    const targetStop: PromptTargetStop | null =
      (action === "replace"
        ? shouldReusePreviousSelection &&
          inheritedTargetStop &&
          inheritedKind === kind &&
          (typeof dayIndex !== "number" || inheritedTargetStop.dayIndex === dayIndex)
          ? inheritedTargetStop
          : resolvePromptTargetStop({
              kind,
              instruction,
              dayIndex,
              days,
            })
        : {
            dayIndex,
          }) ?? null;

    inheritedKind = kind;
    if (action === "replace" && targetStop) {
      inheritedTargetStop = targetStop;
    }

    if (action === "replace" && !targetStop) {
      if (kind === "stay") {
        issues.push(`Couldn't find a stay slot for "${instruction}".`);
        return;
      }

      if (typeof dayIndex === "number") {
        issues.push(`Couldn't find a ${kind} slot on day ${dayIndex + 1} for "${instruction}".`);
      } else {
        issues.push(`Couldn't find a ${kind} slot for "${instruction}".`);
      }
      return;
    }

    const catalogMatch = findBestCatalogMatch({
      query: desiredText,
      hotels,
      foodSpots,
      externalFoodSpots,
      activities,
      externalActivities,
      preferredKind: kind,
    });
    const anchorRef =
      typeof dayIndex === "number"
        ? resolveAnchorStopReference({
            dayIndex,
            instruction,
            days,
            selection: nextSelection,
            foodSpots,
            activities,
          })
        : null;
    const contextualFoodMatch =
      kind === "food" && typeof dayIndex === "number" && isFoodPreferenceRequest(desiredText)
        ? chooseContextualFoodMatch({
            desiredText,
            instruction,
            dayIndex,
            days,
            selection: nextSelection,
            hotels,
            foodSpots,
            externalFoodSpots,
            activities,
            targetStop,
            excludeSelectedNames: action === "add",
            requireSemanticMatch: !isGenericFoodRequest(desiredText),
          })
        : null;
    const contextualActivityMatch =
      kind === "activity" &&
      typeof dayIndex === "number" &&
      isActivityPreferenceRequest(desiredText)
        ? chooseContextualActivityMatch({
            desiredText,
            instruction,
            dayIndex,
            days,
            selection: nextSelection,
            hotels,
            foodSpots,
            activities,
            externalActivities,
            targetStop,
            excludeSelectedNames: action === "add",
            requireSemanticMatch: !isGenericActivityRequest(desiredText),
          })
        : null;

    if (kind === "stay") {
      if (catalogMatch?.kind !== "stay") {
        issues.push(
          `Couldn't match "${desiredText}" to one of the available stay options for this trip.`
        );
        return;
      }

      const currentStayName = selectedNameForTargetStop({
        kind,
        targetStop,
        selection: nextSelection,
        days,
        foodSpots,
        activities,
      });
      if (normalized(catalogMatch.hotel.name) === normalized(currentStayName)) {
        issues.push(`"${catalogMatch.hotel.name}" is already the selected stay.`);
        return;
      }

      nextSelection.hotelName = catalogMatch.hotel.name;
      appliedChanges.push({
        kind,
        dayIndex,
        stopKey: targetStop?.key,
        targetLabel: targetLabel(kind, targetStop ?? undefined),
        selectedName: catalogMatch.hotel.name,
        mode: "updated",
        source: "catalog",
      });
      return;
    }

    if (action === "replace" && targetStop?.key) {
      const key = targetStop.key;
      const catalogFoodMatch =
        kind === "food"
          ? isFoodPreferenceRequest(desiredText)
            ? contextualFoodMatch
            : catalogMatch?.kind === "food"
              ? catalogMatch
              : contextualFoodMatch
          : null;
      const catalogActivityMatch =
        kind === "activity"
          ? isActivityPreferenceRequest(desiredText)
            ? contextualActivityMatch
            : catalogMatch?.kind === "activity"
              ? catalogMatch
              : contextualActivityMatch
          : null;

      if (catalogFoodMatch || catalogActivityMatch) {
        const selectedName = selectedNameForTargetStop({
          kind,
          targetStop,
          selection: nextSelection,
          days,
          foodSpots,
          activities,
        });
        const nextName =
          catalogFoodMatch?.name ?? catalogActivityMatch?.name ?? "Updated stop";

        if (normalized(selectedName) === normalized(nextName)) {
          if (shouldReusePreviousSelection) {
            return;
          }

          issues.push(
            kind === "food"
              ? `Couldn't find a different food option matching "${desiredText}" for this stop yet.`
              : `Couldn't find a different activity matching "${desiredText}" for this stop yet.`
          );
          return;
        }

        delete nextSelection.customStops?.[key];

        if (catalogFoodMatch) {
          if (catalogFoodMatch.sourceScope === "external") {
            delete nextSelection.foods[key];
            delete nextSelection.activities[key];
            const customStop = buildCustomStopFromCatalog(catalogFoodMatch, {
              instruction,
              day: typeof dayIndex === "number" ? days[dayIndex] : undefined,
              travelerCount,
            });

            if (!customStop) {
              issues.push(`Couldn't build a custom food stop for "${instruction}".`);
              return;
            }

            nextSelection.customStops = {
              ...(nextSelection.customStops ?? {}),
              [key]: {
                ...customStop,
                time: customStop.time ?? targetStop.stop?.time,
              },
            };
          } else {
            nextSelection.foods[key] = catalogFoodMatch.food.name;
          }
        } else {
          if (catalogActivityMatch!.sourceScope === "external") {
            delete nextSelection.foods[key];
            delete nextSelection.activities[key];
            const customStop = buildCustomStopFromCatalog(catalogActivityMatch!, {
              instruction,
              day: typeof dayIndex === "number" ? days[dayIndex] : undefined,
              travelerCount,
            });

            if (!customStop) {
              issues.push(`Couldn't build a custom activity stop for "${instruction}".`);
              return;
            }

            nextSelection.customStops = {
              ...(nextSelection.customStops ?? {}),
              [key]: {
                ...customStop,
                time: customStop.time ?? targetStop.stop?.time,
              },
            };
          } else {
            nextSelection.activities[key] = catalogActivityMatch!.activity.name;
          }
        }

        appliedChanges.push({
          kind,
          dayIndex,
          stopKey: key,
          targetLabel: targetLabel(kind, targetStop ?? undefined),
          selectedName:
            catalogFoodMatch?.name ?? catalogActivityMatch?.name ?? "Updated stop",
          mode: "updated",
          source: "catalog",
        });
        return;
      }

      if (kind === "food" && isFoodPreferenceRequest(desiredText)) {
        issues.push(
          `Couldn't find a real food option matching "${desiredText}" in this trip yet.`
        );
        return;
      }

      if (kind === "activity" && isActivityPreferenceRequest(desiredText)) {
        issues.push(
          `Couldn't find a real activity option matching "${desiredText}" in this trip yet.`
        );
        return;
      }

      const customStop = buildCustomStopFromRequest({
        kind,
        desiredText,
        instruction,
        day: typeof dayIndex === "number" ? days[dayIndex] : undefined,
        travelerCount,
        foodSpots,
        activities,
      });

      if (!customStop) {
        issues.push(`Couldn't build a custom ${kind} stop for "${instruction}".`);
        return;
      }

      delete nextSelection.foods[key];
      delete nextSelection.activities[key];
      nextSelection.customStops = {
        ...(nextSelection.customStops ?? {}),
        [key]: {
          ...customStop,
          time: customStop.time ?? targetStop.stop?.time,
        },
      };

      appliedChanges.push({
        kind,
        dayIndex,
        stopKey: key,
        targetLabel: targetLabel(kind, targetStop ?? undefined),
        selectedName: customStop.title,
        mode: "updated",
        source: "custom",
      });
      return;
    }

    if (typeof dayIndex !== "number") {
      issues.push(`Mention a day for "${instruction}" so I know where to add it.`);
      return;
    }

    const addCatalogMatch =
      kind === "food"
        ? isFoodPreferenceRequest(desiredText)
          ? contextualFoodMatch
          : catalogMatch?.kind === "food"
            ? catalogMatch
            : contextualFoodMatch
        : kind === "activity"
          ? isActivityPreferenceRequest(desiredText)
            ? contextualActivityMatch
            : catalogMatch?.kind === "activity"
              ? catalogMatch
              : contextualActivityMatch
          : null;

    if (kind === "food" && isFoodPreferenceRequest(desiredText) && !addCatalogMatch) {
      issues.push(
        `Couldn't find a real food option matching "${desiredText}" in this trip yet.`
      );
      return;
    }

    if (kind === "activity" && isActivityPreferenceRequest(desiredText) && !addCatalogMatch) {
      issues.push(
        `Couldn't find a real activity option matching "${desiredText}" in this trip yet.`
      );
      return;
    }

    const customAddedStop =
      addCatalogMatch
        ? buildCustomStopFromCatalog(addCatalogMatch, {
            instruction,
            day: days[dayIndex],
            travelerCount,
          })
        : buildCustomStopFromRequest({
            kind,
            desiredText,
            instruction,
            day: days[dayIndex],
            travelerCount,
            foodSpots,
            activities,
          });

    if (!customAddedStop) {
      issues.push(`Couldn't add a ${kind} stop for "${instruction}".`);
      return;
    }

    customAddedStop.insertAfterStopIndex = resolveInsertAfterStopIndex(
      days[dayIndex],
      instruction,
      anchorRef?.stopIndex
    );

    nextSelection.addedStops = {
      ...(nextSelection.addedStops ?? {}),
      [dayKey(dayIndex)]: [
        ...(nextSelection.addedStops?.[dayKey(dayIndex)] ?? []),
        customAddedStop,
      ],
    };

    appliedChanges.push({
      kind,
      dayIndex,
      selectedName: customAddedStop.title,
      targetLabel: targetLabel(kind, { dayIndex }, "add"),
      mode: "added",
      source: addCatalogMatch ? "catalog" : "custom",
    });
  });

  return {
    selection: nextSelection,
    appliedChanges,
    issues,
  };
}
