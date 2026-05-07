/**
 * Utilities for inferring planner intent from free-form text.
 * These helpers pull out signals like travel style, destination preferences, and departure timing so the ranking step can stay more structured.
 */

import rawDestinations from "./destinationCatalog";
import { CANADIAN_DEPARTURE_LOCATIONS } from "./canadaGeography";
import { type StartCity } from "./startCities";
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
  requestedActivityName?: string;
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

const BUDGET_AMOUNT_PATTERN = String.raw`((?:\d{1,3}(?:,\d{3})+)|(?:\d{2,5}))`;
const APPROXIMATE_PER_TRAVELER_BUDGET_PATTERN = new RegExp(
  String.raw`(?:budget(?:\s+of|\s+is)?\s*)?(?:around|about|roughly|approx(?:imately)?)\s*\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?\s*(?:each|per[-\s]?person|per[-\s]?traveler|per[-\s]?traveller|pp)\b`,
  "i"
);
const EXACT_PER_TRAVELER_BUDGET_PATTERN = new RegExp(
  String.raw`(?:budget(?:\s+of|\s+is)?\s*)?\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?\s*(?:each|per[-\s]?person|per[-\s]?traveler|per[-\s]?traveller|pp)\b`,
  "i"
);
const APPROXIMATE_GROUP_BUDGET_PATTERN = new RegExp(
  String.raw`(?:our|a|an|the)?\s*(?:total|overall|trip|weekend|all[\s-]?in)?\s*budget(?:\s+of|\s+is)?\s*(?:around|about|roughly|approx(?:imately)?)\s*\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?(?=\b|[.!?,]|$)(?:\s*(?:total|overall|for the trip|for this trip|for the weekend|all in|between us|for us|for both of us|for all of us)\b)?`,
  "i"
);
const EXACT_GROUP_BUDGET_PATTERN = new RegExp(
  String.raw`(?:our|a|an|the)?\s*(?:total|overall|trip|weekend|all[\s-]?in)?\s*budget(?:\s+of|\s+is)?\s*\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?(?=\b|[.!?,]|$)(?:\s*(?:total|overall|for the trip|for this trip|for the weekend|all in|between us|for us|for both of us|for all of us)\b)?`,
  "i"
);
const APPROXIMATE_REVERSE_GROUP_BUDGET_PATTERN = new RegExp(
  String.raw`(?:around|about|roughly|approx(?:imately)?)\s*\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?\s*(?:(?:total|overall|trip|weekend|all[\s-]?in)(?:\s+budget)?|budget)\b`,
  "i"
);
const EXACT_REVERSE_GROUP_BUDGET_PATTERN = new RegExp(
  String.raw`\$?\s*${BUDGET_AMOUNT_PATTERN}\s*(?:cad|dollars?)?\s*(?:(?:total|overall|trip|weekend|all[\s-]?in)(?:\s+budget)?|budget)\b`,
  "i"
);
const TRAVELER_COUNT_PATTERNS = [
  /\bwe(?:'re|\s+are)?\s+(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
  /\b(\d{1,2})\s+of\s+us\b/i,
  /\bthere\s+(?:are|will be)\s+(\d{1,2})\s+of\s+us\b/i,
  /\bgroup\s+of\s+(\d{1,2})\b/i,
  /\bfor\s+(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
  /\bfor\s+(\d{1,2})\s+(?:friends|buddies|pals|adults|guests)\b/i,
  /\b(\d{1,2})\s+(?:people|travellers|travelers)\b/i,
  /\b(\d{1,2})\s+(?:friends|buddies|pals|adults|guests)\b/i,
];
const COMPANION_COUNT_PATTERNS: Array<{
  pattern: RegExp;
  additionalTravelers: number;
}> = [
  {
    pattern:
      /\b(?:me|i)\s+(?:and|with)\s+(?:my\s+)?(\d{1,2})\s+(?:friends|buddies|pals|siblings|cousins|coworkers|co-workers|kids|children)\b/i,
    additionalTravelers: 1,
  },
  {
    pattern:
      /\bwith\s+my\s+(\d{1,2})\s+(?:friends|buddies|pals|siblings|cousins|coworkers|co-workers|kids|children)\b/i,
    additionalTravelers: 1,
  },
  {
    pattern:
      /\b(\d{1,2})\s+(?:friends|buddies|pals|siblings|cousins|coworkers|co-workers|kids|children)\s+and\s+(?:me|i)\b/i,
    additionalTravelers: 1,
  },
];
const START_CITY_PATTERNS = CANADIAN_DEPARTURE_LOCATIONS.flatMap((rawLocation) => {
  const location = rawLocation as { name: StartCity; aliases?: readonly string[] };

  return [location.name, ...(location.aliases ?? [])].map((candidate) => ({
    city: location.name,
    pattern: new RegExp(
      `\\b(?:from|in|out of|leaving|departing|starting (?:from|in)?|based in)\\s+${normalizeCityPattern(
        candidate
      )}\\b`,
      "i"
    ),
  }));
});
const DEPARTURE_TIME_PATTERNS = [
  /\b(?:leave|leaving|depart|departing|head(?:ing)? out|set off|drive out|road trip starts?)(?:\s+[a-z]+){0,4}\s+(?:at\s+)?(?:around\s+|about\s+|roughly\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  /\b(?:leave|leaving|depart|departing|head(?:ing)? out|set off|drive out|road trip starts?)(?:\s+[a-z]+){0,4}\s+(?:at\s+)?(?:around\s+|about\s+|roughly\s+)?(\d{1,2}):(\d{2})\b/i,
];
const CONSTRAINED_DEPARTURE_TIME_PATTERNS = [
  /\b(?:can(?:no)?t|won(?:no)?t|not)\s+(?:leave|leaving|depart|departing|head(?:ing)? out|set off|drive out)(?:\s+[a-z]+){0,4}\s+(?:until|before)\s+(?:around\s+|about\s+|roughly\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  /\b(?:earliest(?:\s+we\s+can)?\s+(?:leave|depart|head out|set off|drive out)|(?:leave|depart|head out|set off|drive out)\s+no\s+earlier\s+than)(?:\s+[a-z]+){0,4}\s+(?:is\s+)?(?:around\s+|about\s+|roughly\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  /\b(?:can(?:no)?t|won(?:no)?t|not)\s+(?:leave|leaving|depart|departing|head(?:ing)? out|set off|drive out)(?:\s+[a-z]+){0,4}\s+(?:until|before)\s+(?:around\s+|about\s+|roughly\s+)?(\d{1,2}):(\d{2})\b/i,
  /\b(?:earliest(?:\s+we\s+can)?\s+(?:leave|depart|head out|set off|drive out)|(?:leave|depart|head out|set off|drive out)\s+no\s+earlier\s+than)(?:\s+[a-z]+){0,4}\s+(?:is\s+)?(?:around\s+|about\s+|roughly\s+)?(\d{1,2}):(\d{2})\b/i,
];
const FLEXIBLE_DEPARTURE_TIME_PATTERNS = [
  /\bafter work(?:,\s*|\s+)(?:around\s+|about\s+|roughly\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  /\bafter work(?:,\s*|\s+)(?:around\s+|about\s+|roughly\s+)?(\d{1,2}):(\d{2})\b/i,
  /\b(?:not\s+until|after)\s+(?:around\s+|about\s+|roughly\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  /\b(?:not\s+until|after)\s+(?:around\s+|about\s+|roughly\s+)?(\d{1,2}):(\d{2})\b/i,
];
const RELATIVE_DEPARTURE_TIME_SIGNALS: Array<{
  pattern: RegExp;
  time: string;
}> = [
  {
    pattern: /\bafter work\b|\bonce work ends\b|\bwhen work is done\b|\bafter the work day\b/i,
    time: "17:30",
  },
  {
    pattern: /\bfirst thing in the morning\b|\bearly start\b|\bearly morning\b/i,
    time: "08:00",
  },
];
const HIKE_DISTANCE_PATTERN =
  /(?:about|around|roughly|approx(?:imately)?)?\s*(\d{1,2}(?:\.\d)?)\s*(?:km|kilometers?|kilometres?)(?:\s*(?:long)?)?(?:\s*(?:for the )?(?:round trip|return|there and back|total))?/i;
const DESTINATION_CANDIDATE_PATTERNS = [
  /\b(?:trip|getaway|vacation|weekend|road trip|escape)\s+to\s+([a-z][a-z\s'-]{1,40}?)(?=(?:\s+(?:from|for|with|on|this|next|during|around|near|by|that|which|because|if|where|when|starting)\b|[,.!?]|$))/i,
  /\b(?:visit(?:ing)?|explore|exploring|headed to|heading to|going to|stay(?:ing)? in|staying in)\s+([a-z][a-z\s'-]{1,40}?)(?=(?:\s+(?:from|for|with|on|this|next|during|around|near|by|that|which|because|if|where|when)\b|[,.!?]|$))/i,
];
const GENERIC_DESTINATION_TERMS = new Set([
  "adventure",
  "adventurous",
  "away",
  "camping",
  "canada",
  "cozy",
  "escape",
  "food",
  "fun",
  "getaway",
  "hike",
  "hiking",
  "mountain",
  "mountains",
  "nature",
  "quiet",
  "relax",
  "reset",
  "road trip",
  "scenic",
  "ski",
  "skiing",
  "trip",
  "vacation",
  "weekend",
]);

function normalizeCityPattern(city: string) {
  return city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function normalizeText(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function catalogDestinationMatchesQuery(query?: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return false;

  return (rawDestinations as RawDestination[]).some((destination) => {
    const haystack = normalizeText(
      [
        destination.name,
        destination.home_base_city,
        destination.region,
        ...(destination.anchor_experiences ?? []).map((item) => item.title),
      ].join(" ")
    );

    if (!haystack) return false;
    if (haystack.includes(normalizedQuery)) return true;

    const tokens = normalizedQuery.split(" ").filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
  });
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

function hasNegatedActivityPhrase(text: string, activity: string) {
  const escapedActivity = activity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\bno\\s+${escapedActivity}\\b`, "i"),
    new RegExp(`\\bnot\\s+(?:a\\s+)?${escapedActivity}\\b`, "i"),
    new RegExp(`\\bdon'?t\\s+want\\s+(?:a\\s+)?${escapedActivity}\\b`, "i"),
    new RegExp(`\\bwithout\\s+(?:a\\s+)?${escapedActivity}\\b`, "i"),
    new RegExp(`\\bskip\\s+(?:the\\s+)?${escapedActivity}\\b`, "i"),
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseBudgetAmount(value?: string) {
  const amount = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(amount) && amount >= 75 && amount <= 10000
    ? amount
    : undefined;
}

function normalizeDepartureTimeMatch(
  hourText?: string,
  minuteText?: string,
  meridiemText?: string
) {
  const rawHour = Number.parseInt(hourText ?? "", 10);
  const rawMinute = Number.parseInt(minuteText ?? "0", 10);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) {
    return undefined;
  }

  if (rawMinute < 0 || rawMinute > 59) {
    return undefined;
  }

  const meridiem = meridiemText?.toLowerCase();
  let hour = rawHour;

  if (meridiem === "am" || meridiem === "pm") {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour < 0 || hour > 23) {
    return undefined;
  }

  return `${String(hour).padStart(2, "0")}:${String(rawMinute).padStart(2, "0")}`;
}

function inferPreferredDestination(prompt: string): string | undefined {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) return undefined;
  const promptStartCity = extractPromptStartCity(prompt);
  const localTripSignal =
    /\bstaycation\b|\blocal\b|\bin town\b|\bclose to home\b|\bnear home\b/i.test(
      prompt
    );

  const options = (rawDestinations as RawDestination[])
    .map((destination) => ({
      destinationName: destination.name?.trim(),
      destinationMatchText: normalizeText(destination.name),
      homeBaseMatchText: normalizeText(destination.home_base_city),
    }))
    .filter(
      (destination): destination is {
        destinationName: string;
        destinationMatchText: string;
        homeBaseMatchText: string;
      } =>
        Boolean(
          destination.destinationName &&
            (destination.destinationMatchText || destination.homeBaseMatchText)
        )
    )
    .sort((a, b) => {
      const longestA = Math.max(
        a.destinationMatchText.length,
        a.homeBaseMatchText.length
      );
      const longestB = Math.max(
        b.destinationMatchText.length,
        b.homeBaseMatchText.length
      );
      return longestB - longestA;
    });

  for (const option of options) {
    const matchesDestinationName =
      Boolean(option.destinationMatchText) &&
      (normalizedPrompt === option.destinationMatchText ||
        normalizedPrompt.includes(option.destinationMatchText));

    if (matchesDestinationName) {
      return option.destinationName;
    }
  }

  for (const option of options) {
    const matchesHomeBase =
      Boolean(option.homeBaseMatchText) &&
      (normalizedPrompt.includes(`to ${option.homeBaseMatchText}`) ||
        normalizedPrompt.includes(`in ${option.homeBaseMatchText}`) ||
        normalizedPrompt.includes(`around ${option.homeBaseMatchText}`) ||
        normalizedPrompt.includes(`near ${option.homeBaseMatchText}`));

    const homeBaseMatchesStartCity =
      Boolean(promptStartCity) &&
      normalizeText(promptStartCity) === option.homeBaseMatchText;

    if (matchesHomeBase && homeBaseMatchesStartCity && !localTripSignal) {
      continue;
    }

    if (matchesHomeBase) {
      return option.destinationName;
    }
  }

  for (const pattern of DESTINATION_CANDIDATE_PATTERNS) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();
    const normalizedCandidate = normalizeText(candidate);
    if (
      !candidate ||
      !normalizedCandidate ||
      GENERIC_DESTINATION_TERMS.has(normalizedCandidate) ||
      normalizedCandidate === normalizeText(promptStartCity)
    ) {
      continue;
    }

    if (
      catalogDestinationMatchesQuery(candidate) ||
      normalizedCandidate.split(" ").some((token) => token.length >= 3)
    ) {
      return candidate.replace(/^\bthe\s+/i, "").trim();
    }
  }

  return undefined;
}

type NamedActivityCandidate = {
  name: string;
  normalizedName: string;
  searchPhrases: string[];
};

const GENERIC_ACTIVITY_SEARCH_PHRASES = new Set([
  "adventure",
  "beach",
  "beach time",
  "canyon",
  "cafe",
  "coffee",
  "dinner",
  "forest",
  "food",
  "harbor",
  "harbour",
  "lake",
  "lakes",
  "lakeside trail",
  "lookout",
  "mountain",
  "mountains",
  "park",
  "parks",
  "river walk",
  "scenic",
  "shops",
  "stroll",
  "trail",
  "trails",
  "view",
  "views",
  "viewpoint",
  "viewpoints",
  "yukon river",
  "waterfront",
  "shoreline",
  "waterfall",
  "waterfalls",
]);

function buildActivitySearchPhrases(name: string) {
  const normalizedName = normalizeText(name);
  const phrases = new Set<string>();

  const addPhrase = (
    value?: string,
    options?: { allowSingleWord?: boolean }
  ) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || normalizedValue.length < 6) return;
    if (GENERIC_ACTIVITY_SEARCH_PHRASES.has(normalizedValue)) return;
    if (
      !options?.allowSingleWord &&
      !normalizedValue.includes(" ") &&
      normalizedValue !== normalizedName
    ) {
      return;
    }
    phrases.add(normalizedValue);
  };

  addPhrase(normalizedName, { allowSingleWord: true });
  addPhrase(normalizedName.replace(/\bto\s+upper\s+falls\b/g, ""));
  addPhrase(normalizedName.replace(/\bto\s+lower\s+falls\b/g, ""));
  addPhrase(normalizedName.replace(/\bto\s+falls\b/g, ""));
  addPhrase(normalizedName.replace(/\binterpretive\s+loop\b/g, ""));
  addPhrase(normalizedName.replace(/\bsummit\s+hike\b/g, ""));
  addPhrase(normalizedName.replace(/\bhike\b/g, ""));
  addPhrase(normalizedName.replace(/\btrail\b/g, ""));
  addPhrase(normalizedName.replace(/\bviewpoint\b/g, ""));
  addPhrase(normalizedName.replace(/\blookout\b/g, ""));
  addPhrase(normalizedName.replace(/\bgondola\b/g, ""));
  addPhrase(normalizedName.replace(/\bstroll\b/g, ""));
  addPhrase(normalizedName.replace(/\bshops\b/g, ""));
  addPhrase(normalizedName.replace(/\bseasonal\b/g, ""));

  const splitPhrases = normalizedName.split(/\s+\/\s+|\s+\+\s+|\s+and\s+/);
  for (const phrase of splitPhrases) {
    addPhrase(phrase);
  }

  return Array.from(phrases).sort((a, b) => b.length - a.length);
}

function getNamedActivityCandidates(): NamedActivityCandidate[] {
  const seen = new Set<string>();
  const candidates: NamedActivityCandidate[] = [];

  for (const destination of rawDestinations as RawDestination[]) {
    for (const experience of destination.anchor_experiences ?? []) {
      const name = experience.title?.trim();
      const normalizedName = normalizeText(name);
      if (!name || !normalizedName || seen.has(normalizedName)) continue;

      seen.add(normalizedName);
      candidates.push({
        name,
        normalizedName,
        searchPhrases: buildActivitySearchPhrases(name),
      });
    }
  }

  return candidates.sort(
    (a, b) => b.normalizedName.length - a.normalizedName.length
  );
}

const NAMED_ACTIVITY_CANDIDATES = getNamedActivityCandidates();

export function extractRequestedActivityName(prompt?: string): string | undefined {
  const normalizedPrompt = normalizeText(prompt);
  if (!normalizedPrompt) return undefined;

  for (const candidate of NAMED_ACTIVITY_CANDIDATES) {
    if (
      candidate.searchPhrases.some(
        (phrase) =>
          normalizedPrompt === phrase || normalizedPrompt.includes(phrase)
      )
    ) {
      return candidate.name;
    }
  }

  return undefined;
}

function inferActivityFocus(text: string): ActivityFocus | undefined {
  const explicitHikeIntent =
    /\b(?:go on|want|take|plan)\s+(?:a\s+)?hike\b/i.test(text) ||
    /\bhiking\s+trip\b/i.test(text) ||
    /\bsignature\s+hike\b/i.test(text) ||
    /\bmain\s+hike\b/i.test(text) ||
    /\bhike\s+up\s+(?:a|the)\s+mountain\b/i.test(text) ||
    /\bsummit\s+hike\b/i.test(text);
  const summitMountainIntent =
    /\btop\s+of\s+(?:a|the)\s+mountain\b/i.test(text) ||
    /\bmountain\s+top\b/i.test(text) ||
    /\bmountaintop\b/i.test(text) ||
    /\bscenic\s+view\s+at\s+the\s+top\b/i.test(text) ||
    /\bview\s+at\s+the\s+top\b/i.test(text) ||
    /\bscenic\s+views?\s+at\s+the\s+top\b/i.test(text);
  const hikeDistanceCue =
    /\b\d{1,2}(?:\.\d)?\s*km\b/i.test(text) &&
    /\b(hike|hiking|trail|mountain|summit|peak|ridge)\b/i.test(text);
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
  ]);
  const negatedHikeScore = [
    "hike",
    "hiking",
    "trail",
    "summit hike",
    "big hike",
  ].reduce((count, term) => {
    return count + (hasNegatedActivityPhrase(text, term) ? 1 : 0);
  }, 0);
  const adjustedHikingScore = Math.max(0, hikingScore - negatedHikeScore * 2);

  if (
    adjustedHikingScore >= 1 &&
    (explicitHikeIntent || summitMountainIntent || hikeDistanceCue)
  ) {
    return "hiking";
  }

  if (summitMountainIntent && (explicitHikeIntent || hikeDistanceCue)) {
    return "hiking";
  }

  if (
    adjustedHikingScore >= Math.max(skiingScore, campingScore) &&
    adjustedHikingScore >= 2
  ) {
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
    "must see": 0,
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
    "casual",
    "calm pace",
    "calm pacing",
    "cozier",
    "low effort",
    "low effort",
    "low-effort",
    "minimal planning friction",
    "planning friction",
    "cozy trip",
    "keep the rest of the trip easy",
    "not packed",
    "not too many stops",
  ]);

  signals["solo reset"] += countMatches(text, [
    "solo reset",
    "solo",
    "alone",
    "myself",
    "reset",
    "clear my head",
    "journaling",
    "reflection",
    "peaceful",
  ]);

  if (/\bsolo\s+reset\b/i.test(text)) {
    signals["solo reset"] += 5;
    signals.foodie -= 2;
  }

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

  if (/\bhidden\s+gems?\b/i.test(text)) {
    signals["hidden gems"] += 5;
    signals.outdoors -= 1;
    signals.adventure -= 1;
  }

  signals["must see"] += countMatches(text, [
    "must see",
    "must-see",
    "must do",
    "can t miss",
    "cant miss",
    "can't miss",
    "cannot miss",
    "top sight",
    "top sights",
    "main sight",
    "main sights",
    "main attraction",
    "main attractions",
    "bucket list",
    "iconic",
    "famous",
    "landmark",
    "landmarks",
    "sightseeing",
    "classic sights",
    "classic spots",
    "signature attractions",
    "first time",
    "first-time",
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

  if (/\broad trip\b/i.test(text) && !/\b(?:calm|quiet|relaxed|slow|unhurried|not packed)\b/i.test(text)) {
    signals.adventure += 1;
  }

  if (
    /\bcozy\s+more\s+than\s+intense\b/i.test(text) ||
    /\bmore\s+cozy\s+than\s+intense\b/i.test(text) ||
    /\bnot\s+too\s+intense\b/i.test(text)
  ) {
    signals.chill += 4;
    signals.adventure -= 2;
  }

  if (
    /\blate\s+casual\s+dinner\b/i.test(text) ||
    /\bcasual\s+dinner\b/i.test(text)
  ) {
    signals.chill += 2;
    signals.foodie += 1;
  }

  if (activityFocus === "hiking" || activityFocus === "camping") {
    signals.outdoors += 3;
  }

  if (activityFocus === "skiing") {
    signals.adventure += 5;
    signals.outdoors += 2;

    if (/\b(?:ski(?:ing)?\s+(?:day|overnight|trip)|main event|lift time)\b/i.test(text)) {
      signals.adventure += 5;
      signals.chill -= 1;
    }
  }

  if (
    /\b(?:must[-\s]?see|can(?:not|\s+t)? miss|bucket list|iconic|famous|top sights?|main attractions?|landmarks?|sightseeing)\b/i.test(
      text
    )
  ) {
    signals["must see"] += 4;
    signals["hidden gems"] -= 2;
  }

  if (/\bfirst[-\s]?time\b/i.test(text)) {
    signals["must see"] += 3;
  }

  if (
    /\bcozy\b/i.test(text) &&
    /\b(?:easy|minimal planning friction|keep the rest of the trip easy)\b/i.test(text)
  ) {
    signals.chill += 3;
    signals.outdoors -= 1;
    signals.adventure -= 1;
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
    const amount = parseBudgetAmount(approximatePerTravelerMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "per_traveler",
        approximate: true,
      };
    }
  }

  const exactPerTravelerMatch = prompt.match(EXACT_PER_TRAVELER_BUDGET_PATTERN);
  if (exactPerTravelerMatch) {
    const amount = parseBudgetAmount(exactPerTravelerMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "per_traveler",
        approximate: false,
      };
    }
  }

  const approximateGroupMatch = prompt.match(APPROXIMATE_GROUP_BUDGET_PATTERN);
  if (approximateGroupMatch) {
    const amount = parseBudgetAmount(approximateGroupMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "group_total",
        approximate: true,
      };
    }
  }

  const approximateReverseGroupMatch = prompt.match(
    APPROXIMATE_REVERSE_GROUP_BUDGET_PATTERN
  );
  if (approximateReverseGroupMatch) {
    const amount = parseBudgetAmount(approximateReverseGroupMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "group_total",
        approximate: true,
      };
    }
  }

  const exactGroupMatch = prompt.match(EXACT_GROUP_BUDGET_PATTERN);
  if (exactGroupMatch) {
    const amount = parseBudgetAmount(exactGroupMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "group_total",
        approximate: false,
      };
    }
  }

  const exactReverseGroupMatch = prompt.match(EXACT_REVERSE_GROUP_BUDGET_PATTERN);
  if (exactReverseGroupMatch) {
    const amount = parseBudgetAmount(exactReverseGroupMatch[1]);
    if (amount) {
      return {
        amount,
        scope: "group_total",
        approximate: false,
      };
    }
  }

  return null;
}

export function extractPromptDepartureTime(prompt?: string): string | undefined {
  const text = prompt?.trim();
  if (!text) return undefined;

  for (const pattern of CONSTRAINED_DEPARTURE_TIME_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const normalized = normalizeDepartureTimeMatch(
      match[1],
      match[2],
      match[3]
    );
    if (normalized) {
      return normalized;
    }
  }

  for (const pattern of DEPARTURE_TIME_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const normalized = normalizeDepartureTimeMatch(
      match[1],
      match[2],
      match[3]
    );
    if (normalized) {
      return normalized;
    }
  }

  for (const pattern of FLEXIBLE_DEPARTURE_TIME_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const normalized = normalizeDepartureTimeMatch(
      match[1],
      match[2],
      match[3]
    );
    if (normalized) {
      return normalized;
    }
  }

  for (const signal of RELATIVE_DEPARTURE_TIME_SIGNALS) {
    if (signal.pattern.test(text)) {
      return signal.time;
    }
  }

  return undefined;
}

export function extractPromptTravelerCount(prompt: string): number | null {
  for (const option of COMPANION_COUNT_PATTERNS) {
    const match = prompt.match(option.pattern);
    if (!match) continue;

    const companionCount = Number.parseInt(match[1] ?? "", 10);
    const travelerCount = companionCount + option.additionalTravelers;
    if (Number.isFinite(travelerCount) && travelerCount >= 1 && travelerCount <= 12) {
      return travelerCount;
    }
  }

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

export function extractPromptStartCity(prompt?: string): StartCity | undefined {
  const text = prompt?.trim();
  if (!text) return undefined;

  for (const option of START_CITY_PATTERNS) {
    if (option.pattern.test(text)) {
      return option.city;
    }
  }

  return undefined;
}

function inferBudget(prompt: string, normalizedPrompt: string) {
  const explicitBudget = extractPromptBudget(prompt);
  if (explicitBudget?.scope === "per_traveler") {
    return {
      suggestedBudgetPerTraveler: explicitBudget.amount,
      strictBudget: !explicitBudget.approximate,
    };
  }

  if (explicitBudget) {
    return {
      suggestedBudgetPerTraveler: undefined,
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
  const avoidsSummitStyleHike =
    activityFocus === "hiking" &&
    countMatches(normalizedPrompt, [
      "avoid summit",
      "avoid summits",
      "avoid steep summit",
      "avoid steep summits",
      "avoid peak",
      "avoid peaks",
      "avoid scramble",
      "avoid scrambles",
      "no summit",
      "no summits",
      "no peak",
      "no peaks",
      "no scramble",
      "no scrambles",
      "not a summit",
      "not summit",
      "skip summit",
      "skip summits",
      "avoid steep hike",
      "avoid steep hikes",
      "no steep hike",
      "no steep hikes",
    ]) >= 1;

  const wantsSummitStyleHike =
    activityFocus === "hiking" &&
    !avoidsSummitStyleHike &&
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
        (hasKeywordMatch(normalizedPrompt, "top") ||
          hasKeywordMatch(normalizedPrompt, "summit") ||
          hasKeywordMatch(normalizedPrompt, "peak") ||
          hasKeywordMatch(normalizedPrompt, "scenic view at the top") ||
          hasKeywordMatch(normalizedPrompt, "view at the top")))
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
        "unhurried",
        "quiet",
        "slow paced",
        "slow-paced",
        "unrushed",
        "beginner friendly",
        "beginner-friendly",
        "light",
        "lighter",
        "no packed schedule",
        "not packed",
        "not overpacked",
        "not hectic",
        "avoid hectic",
        "avoid overplanned",
        "not overplanned",
        "not too much planning",
        "does not feel packed",
        "doesnt feel packed",
        "doesn't feel packed",
        "not feel packed",
        "enough downtime",
        "downtime",
        "simple",
        "low key",
        "low-key",
        "avoid filler",
        "avoid extra filler stops",
        "avoid repetitive roadside filler",
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
        "enough downtime",
        "downtime",
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

  // Staycations are now a ranking preference rather than a hidden hard filter.
  // The UI no longer exposes a staycation toggle, so local options should stay
  // available unless the user explicitly rejects them elsewhere.
  const includeStaycations = true;

  const hardConstraints = inferHardConstraints(rawPrompt, activityFocus);
  const softPreferences = inferSoftPreferences(rawPrompt, activityFocus);

  return {
    style: inferStyle(normalizedPrompt, activityFocus),
    activityFocus,
    preferredDestination: inferPreferredDestination(rawPrompt),
    requestedActivityName: extractRequestedActivityName(rawPrompt),
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
