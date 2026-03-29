/**
 * Helper module for open ai prompt parameters concerns in the trip planner.
 * These utilities centralize shared business logic so routes, pages, and components can reuse the same behavior instead of re-implementing it.
 */

import { reportProviderEvent } from "./providerTelemetry";
import { isStartCity, START_CITY_OPTIONS, type StartCity } from "./startCities";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptDepartureTime,
  extractPromptTravelerCount,
} from "./tripIntent";
import { ActivityFocus, ProviderOutcome, TripInput, TripStyle } from "./types";

type ResponsesApiOutput = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

type PromptParameterConfidence = "low" | "medium" | "high";

type OpenAiPromptParameterPayload = {
  startCity?: unknown;
  travelerCount?: unknown;
  budgetPerTraveler?: unknown;
  maxDriveHours?: unknown;
  style?: unknown;
  activityFocus?: unknown;
  preferredDestination?: unknown;
  departureTime?: unknown;
  veganFriendly?: unknown;
  includeStaycations?: unknown;
  strictBudget?: unknown;
  confidence?: unknown;
};

export type OpenAiPromptParameters = {
  startCity?: StartCity;
  travelerCount?: number;
  budgetPerTraveler?: number;
  maxDriveHours?: number;
  style?: TripStyle;
  activityFocus?: ActivityFocus;
  preferredDestination?: string;
  departureTime?: string;
  veganFriendly?: boolean;
  includeStaycations?: boolean;
  strictBudget?: boolean;
  confidence?: PromptParameterConfidence;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try fenced code block.
  }

  const fencedMatch =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ||
    trimmed.match(/```([\s\S]*?)```/);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      return null;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function getResponseText(data: ResponsesApiOutput): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const parts: string[] = [];
  if (!Array.isArray(data?.output)) {
    return "";
  }

  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const contentItem of item.content) {
      if (typeof contentItem?.text === "string") {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function normalizeTimeValue(value: unknown): string | undefined {
  const raw = safeString(value).toLowerCase();
  if (!raw) return undefined;

  const hhMmMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hhMmMatch) {
    const hour = Number.parseInt(hhMmMatch[1] ?? "", 10);
    const minute = Number.parseInt(hhMmMatch[2] ?? "", 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const meridiemMatch = raw.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/
  );
  if (!meridiemMatch) {
    return undefined;
  }

  const rawHour = Number.parseInt(meridiemMatch[1] ?? "", 10);
  const rawMinute = Number.parseInt(meridiemMatch[2] ?? "0", 10);
  const meridiem = meridiemMatch[3];
  if (
    !Number.isFinite(rawHour) ||
    !Number.isFinite(rawMinute) ||
    rawHour < 1 ||
    rawHour > 12 ||
    rawMinute < 0 ||
    rawMinute > 59
  ) {
    return undefined;
  }

  const hour =
    meridiem === "am"
      ? rawHour === 12
        ? 0
        : rawHour
      : rawHour === 12
        ? 12
        : rawHour + 12;

  return `${String(hour).padStart(2, "0")}:${String(rawMinute).padStart(2, "0")}`;
}

function sanitizePromptParameters(
  value: unknown
): OpenAiPromptParameters | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as OpenAiPromptParameterPayload;
  const startCity = safeString(payload.startCity);
  const preferredDestination = safeString(payload.preferredDestination);
  const confidence = safeString(payload.confidence);

  const travelerCount = Number(payload.travelerCount);
  const budgetPerTraveler = Number(payload.budgetPerTraveler);
  const maxDriveHours = Number(payload.maxDriveHours);

  const parameters: OpenAiPromptParameters = {};

  if (isStartCity(startCity)) {
    parameters.startCity = startCity;
  }

  if (
    Number.isFinite(travelerCount) &&
    travelerCount >= 1 &&
    travelerCount <= 12
  ) {
    parameters.travelerCount = Math.round(travelerCount);
  }

  if (
    Number.isFinite(budgetPerTraveler) &&
    budgetPerTraveler >= 50 &&
    budgetPerTraveler <= 5000
  ) {
    parameters.budgetPerTraveler = Math.round(budgetPerTraveler);
  }

  if (
    Number.isFinite(maxDriveHours) &&
    maxDriveHours >= 1 &&
    maxDriveHours <= 12
  ) {
    parameters.maxDriveHours = clamp(Math.round(maxDriveHours), 1, 12);
  }

  if (
    payload.style === "chill" ||
    payload.style === "outdoors" ||
    payload.style === "foodie" ||
    payload.style === "solo reset" ||
    payload.style === "adventure" ||
    payload.style === "hidden gems"
  ) {
    parameters.style = payload.style;
  }

  if (
    payload.activityFocus === "skiing" ||
    payload.activityFocus === "hiking" ||
    payload.activityFocus === "camping"
  ) {
    parameters.activityFocus = payload.activityFocus;
  }

  if (preferredDestination) {
    parameters.preferredDestination = preferredDestination;
  }

  const departureTime = normalizeTimeValue(payload.departureTime);
  if (departureTime) {
    parameters.departureTime = departureTime;
  }

  if (typeof payload.veganFriendly === "boolean") {
    parameters.veganFriendly = payload.veganFriendly;
  }

  if (typeof payload.includeStaycations === "boolean") {
    parameters.includeStaycations = payload.includeStaycations;
  }

  if (typeof payload.strictBudget === "boolean") {
    parameters.strictBudget = payload.strictBudget;
  }

  if (
    confidence === "low" ||
    confidence === "medium" ||
    confidence === "high"
  ) {
    parameters.confidence = confidence;
  }

  return Object.keys(parameters).length > 0 ? parameters : null;
}

function shouldAdoptTravelerCount(input: TripInput) {
  const fallbackTravelerCount =
    extractPromptTravelerCount(input.tripPrompt ?? "") ?? undefined;

  return (
    input.travelerCount === 2 ||
    fallbackTravelerCount === undefined ||
    input.travelerCount === fallbackTravelerCount
  );
}

function shouldAdoptBudgetPerTraveler(input: TripInput) {
  if (input.budgetPerTraveler === 300) {
    return true;
  }

  const prompt = input.tripPrompt ?? "";
  const budgetMatch = extractPromptBudget(prompt);
  const fallbackTravelerCount =
    extractPromptTravelerCount(prompt) ?? input.travelerCount;
  const fallbackIntent = deriveTripIntentFromPrompt(prompt);

  const fallbackBudgetPerTraveler =
    budgetMatch?.scope === "per_traveler"
      ? budgetMatch.amount
      : budgetMatch?.scope === "group_total" && fallbackTravelerCount > 0
        ? Math.max(1, Math.round(budgetMatch.amount / fallbackTravelerCount))
        : fallbackIntent.suggestedBudgetPerTraveler ?? 300;

  return input.budgetPerTraveler === fallbackBudgetPerTraveler;
}

function shouldAdoptMaxDriveHours(input: TripInput) {
  const fallbackMaxDriveHours =
    deriveTripIntentFromPrompt(input.tripPrompt).suggestedMaxDriveHours ?? 5;

  return input.maxDriveHours === fallbackMaxDriveHours;
}

export function mergePromptParametersIntoTripInput(
  input: TripInput,
  parameters: OpenAiPromptParameters | null
): TripInput {
  if (!parameters) {
    return input;
  }

  const travelerCount =
    typeof parameters.travelerCount === "number" && shouldAdoptTravelerCount(input)
      ? parameters.travelerCount
      : input.travelerCount;

  const budgetPerTraveler =
    typeof parameters.budgetPerTraveler === "number" &&
    shouldAdoptBudgetPerTraveler(input)
      ? parameters.budgetPerTraveler
      : input.budgetPerTraveler;

  const maxDriveHours =
    typeof parameters.maxDriveHours === "number" && shouldAdoptMaxDriveHours(input)
      ? parameters.maxDriveHours
      : input.maxDriveHours;

  const startCity =
    parameters.startCity &&
    (input.startCity === parameters.startCity || input.startCity === "Edmonton")
      ? parameters.startCity
      : input.startCity;

  return {
    ...input,
    startCity,
    travelerCount,
    budgetPerTraveler,
    budget: travelerCount * budgetPerTraveler,
    maxDriveHours,
    style: parameters.style ?? input.style,
    activityFocus: parameters.activityFocus ?? input.activityFocus,
    preferredDestination:
      parameters.preferredDestination ?? input.preferredDestination,
    departureTime: parameters.departureTime ?? input.departureTime,
    veganFriendly: parameters.veganFriendly ?? input.veganFriendly,
    includeStaycations:
      parameters.includeStaycations ?? input.includeStaycations,
    strictBudget: parameters.strictBudget ?? input.strictBudget,
  };
}

export async function enrichTripInputWithOpenAI(
  input: TripInput
): Promise<{
  input: TripInput;
  parameters: OpenAiPromptParameters | null;
  status: ProviderOutcome;
}> {
  const prompt = safeString(input.tripPrompt);
  if (!prompt) {
    return {
      input,
      parameters: null,
      status: "fallback_used",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      input,
      parameters: null,
      status: "fallback_used",
    };
  }

  const model =
    process.env.OPENAI_PROMPT_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  const fallbackIntent = deriveTripIntentFromPrompt(prompt);
  const fallbackBudget = extractPromptBudget(prompt);
  const fallbackTravelerCount = extractPromptTravelerCount(prompt);
  const fallbackDepartureTime = extractPromptDepartureTime(prompt);

  const systemPrompt = [
    "You extract structured trip planning parameters from a traveler's plain-English trip brief.",
    "Return ONLY valid JSON and do not use markdown fences.",
    "Use null when the brief does not clearly specify a field.",
    "Do not invent destinations, cities, or times that are not supported by the prompt.",
    "departureTime must be in 24-hour HH:MM format when known.",
    "budgetPerTraveler must be the per-person value in CAD when the prompt gives a usable budget.",
    "maxDriveHours must be a whole number estimate only when the traveler clearly signals drive tolerance.",
    "startCity must be one of the allowed starting cities if the prompt clearly states it.",
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Extract trip planning parameters from this brief.",
      allowed_start_cities: START_CITY_OPTIONS,
      allowed_styles: [
        "chill",
        "outdoors",
        "foodie",
        "solo reset",
        "adventure",
        "hidden gems",
      ],
      allowed_activity_focus: ["skiing", "hiking", "camping"],
      required_output_shape: {
        startCity: "StartCity | null",
        travelerCount: "number | null",
        budgetPerTraveler: "number | null",
        maxDriveHours: "number | null",
        style: "TripStyle | null",
        activityFocus: "ActivityFocus | null",
        preferredDestination: "string | null",
        departureTime: "HH:MM | null",
        veganFriendly: "boolean | null",
        includeStaycations: "boolean | null",
        strictBudget: "boolean | null",
        confidence: '"low" | "medium" | "high"',
      },
      current_input: {
        startCity: input.startCity,
        travelerCount: input.travelerCount,
        budgetPerTraveler: input.budgetPerTraveler,
        maxDriveHours: input.maxDriveHours,
        style: input.style,
        activityFocus: input.activityFocus ?? null,
        preferredDestination: input.preferredDestination ?? null,
        departureTime: input.departureTime ?? null,
        veganFriendly: input.veganFriendly,
        includeStaycations: input.includeStaycations,
        strictBudget: input.strictBudget,
      },
      fallback_parser_view: {
        travelerCount: fallbackTravelerCount,
        budget: fallbackBudget,
        departureTime: fallbackDepartureTime,
        intent: fallbackIntent,
      },
      trip_brief: prompt,
    },
    null,
    2
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        max_output_tokens: 900,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      reportProviderEvent({
        provider: "openai",
        operation: "parse_trip_prompt",
        outcome: "live_unavailable",
        statusCode: response.status,
        detail: `Responses API returned non-OK status: ${errorText.slice(0, 200)}`,
      });
      return {
        input,
        parameters: null,
        status: "live_unavailable",
      };
    }

    const data = (await response.json()) as ResponsesApiOutput;
    const text = getResponseText(data);
    const parsed = sanitizePromptParameters(parseJsonFromText(text));
    if (!parsed) {
      reportProviderEvent({
        provider: "openai",
        operation: "parse_trip_prompt",
        outcome: "fallback_used",
        detail: "Responses API returned no usable prompt parameter payload.",
      });
      return {
        input,
        parameters: null,
        status: "fallback_used",
      };
    }

    return {
      input: mergePromptParametersIntoTripInput(input, parsed),
      parameters: parsed,
      status: "live_success",
    };
  } catch (error) {
    reportProviderEvent({
      provider: "openai",
      operation: "parse_trip_prompt",
      outcome: "live_unavailable",
      error,
    });
    return {
      input,
      parameters: null,
      status: "live_unavailable",
    };
  }
}
