/**
 * Next.js API route for 'api/rank-trips'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import { enrichTripInputWithOpenAI } from "../../../lib/openAiPromptParameters";
import {
  getPromptLimitError,
  isPromptTooLong,
  normalizePromptText,
  TRIP_PROMPT_MAX_CHARS,
} from "../../../lib/promptLimits";
import {
  PromptValidationResult,
  PromptValidationFailureReason,
  validateTripPrompt,
} from "../../../lib/promptValidation";
import { isStartCity } from "../../../lib/startCities";
import { deriveTripEndDate, isIsoDate } from "../../../lib/tripDates";
import { extractPromptDepartureTime } from "../../../lib/tripIntent";
import { generateRankedTrips } from "../../../lib/generateRankedTrips";
import { getNoMatchDiagnostics } from "../../../lib/rankDestinations";
import { ActivityFocus, TripInput } from "../../../lib/types";

type TripInputCandidate = Partial<TripInput> & {
  startCity?: unknown;
  maxDriveHours?: unknown;
  maxDriveMinutesBetweenStops?: unknown;
  budget?: unknown;
  budgetPerTraveler?: unknown;
  travelerCount?: unknown;
  tripLengthDays?: unknown;
  season?: unknown;
  style?: unknown;
  tripPrompt?: unknown;
  activityFocus?: unknown;
  veganFriendly?: unknown;
  includeStaycations?: unknown;
  strictBudget?: unknown;
  preferredDestination?: unknown;
  tripStartDate?: unknown;
  tripEndDate?: unknown;
  departureTime?: unknown;
};

function isActivityFocus(value: unknown): value is ActivityFocus {
  return value === "skiing" || value === "hiking" || value === "camping";
}

function isTripInput(value: unknown): value is TripInput {
  const candidate = value as TripInputCandidate;

  return Boolean(
    value &&
    typeof value === "object" &&
    isStartCity(candidate.startCity) &&
    typeof candidate.maxDriveHours === "number" &&
    typeof candidate.maxDriveMinutesBetweenStops === "number" &&
    typeof candidate.budget === "number" &&
    typeof candidate.budgetPerTraveler === "number" &&
    typeof candidate.travelerCount === "number" &&
    typeof candidate.tripLengthDays === "number" &&
    typeof candidate.season === "string" &&
    typeof candidate.style === "string" &&
    (candidate.tripPrompt === undefined ||
      typeof candidate.tripPrompt === "string") &&
    (candidate.activityFocus === undefined || isActivityFocus(candidate.activityFocus)) &&
    typeof candidate.veganFriendly === "boolean" &&
    typeof candidate.includeStaycations === "boolean" &&
    typeof candidate.strictBudget === "boolean" &&
    (candidate.preferredDestination === undefined ||
      typeof candidate.preferredDestination === "string") &&
    (candidate.tripStartDate === undefined ||
      typeof candidate.tripStartDate === "string") &&
    (candidate.tripEndDate === undefined || typeof candidate.tripEndDate === "string") &&
    (candidate.departureTime === undefined ||
      typeof candidate.departureTime === "string")
  );
}

function normalizeDepartureTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value.trim())) {
    return undefined;
  }

  return value.trim();
}

function normalizeInput(raw: unknown): TripInput | null {
  if (!raw || typeof raw !== "object") return null;
  const candidateInput = raw as TripInputCandidate;

  const travelerCount = Number(candidateInput.travelerCount);
  const budgetPerTraveler = Number(candidateInput.budgetPerTraveler);
  const tripStartDate = isIsoDate(candidateInput.tripStartDate)
    ? candidateInput.tripStartDate
    : undefined;
  const tripLengthDays = Number(candidateInput.tripLengthDays);
  const tripPrompt = normalizePromptText(candidateInput.tripPrompt) || undefined;
  const departureTime =
    normalizeDepartureTime(candidateInput.departureTime) ??
    extractPromptDepartureTime(tripPrompt);

  const candidate = {
    startCity: candidateInput.startCity,
    maxDriveHours: Number(candidateInput.maxDriveHours),
    maxDriveMinutesBetweenStops: Number(
      candidateInput.maxDriveMinutesBetweenStops
    ),
    budget: travelerCount * budgetPerTraveler,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    season: candidateInput.season,
    style: candidateInput.style,
    tripPrompt,
    activityFocus: isActivityFocus(candidateInput.activityFocus)
      ? candidateInput.activityFocus
      : undefined,
    veganFriendly: Boolean(candidateInput.veganFriendly),
    includeStaycations: Boolean(candidateInput.includeStaycations),
    strictBudget: Boolean(candidateInput.strictBudget),
    preferredDestination:
      typeof candidateInput.preferredDestination === "string"
        ? candidateInput.preferredDestination.trim() || undefined
        : undefined,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
    departureTime,
  };

  if (!isTripInput(candidate)) return null;
  return candidate;
}

function hasOversizedTripPrompt(input: TripInput | null) {
  return Boolean(
    input?.tripPrompt && isPromptTooLong(input.tripPrompt, TRIP_PROMPT_MAX_CHARS)
  );
}

function normalizeExcludedDestinationNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean);
}

function isPromptValidationFailure(
  result: PromptValidationResult
): result is Extract<PromptValidationResult, { ok: false }> {
  return result.ok === false;
}

export async function POST(req: Request) {
  const sameOriginViolation = enforceSameOrigin(req);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(req, {
    key: "rank-trips",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(req, 128_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = await req.json();
    const input = normalizeInput(body?.input ?? body);
    const excludedDestinationNames = normalizeExcludedDestinationNames(
      body?.excludedDestinationNames
    );

    if (!input) {
      return jsonNoStore(
        { error: "Invalid TripInput payload." },
        { status: 400 }
      );
    }

    if (hasOversizedTripPrompt(input)) {
      return jsonNoStore(
        { error: getPromptLimitError("Trip prompt", TRIP_PROMPT_MAX_CHARS) },
        { status: 400 }
      );
    }

    if (input.tripPrompt) {
      const promptValidation = validateTripPrompt(input.tripPrompt);
      if (isPromptValidationFailure(promptValidation)) {
        const { message, reason } = promptValidation;
        return jsonNoStore(
          {
            error: message,
            errorCode: "invalid_trip_prompt",
            validationReason: reason satisfies PromptValidationFailureReason,
          },
          { status: 400 }
        );
      }
    }

    const promptEnrichment = await enrichTripInputWithOpenAI(input);
    const resolvedInput = promptEnrichment.input;

    const pipeline = await generateRankedTrips(resolvedInput, {
      shortlistSize: resolvedInput.preferredDestination ? 3 : 6,
      finalLimit: 1,
      excludedDestinationNames,
    });

    return jsonNoStore({
      success: true,
      normalizedInput: resolvedInput,
      promptParseStatus: promptEnrichment.status,
      initialCandidates: pipeline.initialCandidates,
      results: pipeline.finalTrips,
      usedLiveData: pipeline.usedLiveData,
      noMatchDiagnostics:
        pipeline.finalTrips.length === 0
          ? getNoMatchDiagnostics(resolvedInput, {
              excludedDestinationNames,
              additionalRawDestinations: pipeline.dynamicCandidates,
            })
          : null,
    });
  } catch (error) {
    console.error("rank-trips route failed:", error);

    return jsonNoStore(
      { error: "Failed to rank trips." },
      { status: 500 }
    );
  }
}
