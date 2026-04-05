import type { ItineraryStop, TripPlan } from "./types";
import { verifyTripPlan } from "./tripVerification";

export type TripPlanInvariantStage = "save" | "finalize";

export interface TripPlanInvariantIssue {
  code: string;
  message: string;
  dayIndex?: number;
  stopIndex?: number;
  stopTitle?: string;
}

export interface TripPlanInvariantResult {
  ok: boolean;
  stage: TripPlanInvariantStage;
  issues: TripPlanInvariantIssue[];
  message?: string;
}

type IndexedStop = {
  dayIndex: number;
  stopIndex: number;
  stop: ItineraryStop;
};

const FINALIZE_PLACEHOLDER_PATTERNS: Array<{
  code: string;
  pattern: RegExp;
}> = [
  {
    code: "unresolved_food_placeholder",
    pattern: /pick a local food stop in /i,
  },
  {
    code: "unresolved_food_placeholder",
    pattern: /keep this meal close to /i,
  },
  {
    code: "unresolved_food_placeholder",
    pattern: /keep this slot for a local food crawl/i,
  },
  {
    code: "unresolved_food_placeholder",
    pattern: /keep this slot flexible for one good local stop in /i,
  },
  {
    code: "unresolved_activity_placeholder",
    pattern: /pick a nearby activity in /i,
  },
  {
    code: "unresolved_activity_placeholder",
    pattern: /keep this activity close to /i,
  },
  {
    code: "unresolved_activity_placeholder",
    pattern: /use this block for one more outdoor anchor around /i,
  },
  {
    code: "unresolved_activity_placeholder",
    pattern: /keep this block open for a low-friction stop around /i,
  },
  {
    code: "unresolved_placeholder_day",
    pattern: /\bfallback\b/i,
  },
  {
    code: "unresolved_placeholder_day",
    pattern: /while more destination data loads in/i,
  },
  {
    code: "unresolved_placeholder_day",
    pattern: /^flexible .* day in /i,
  },
];

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function getIndexedStops(plan: TripPlan): IndexedStop[] {
  return (plan.itineraryDays ?? []).flatMap((day, dayIndex) =>
    (day.stops ?? []).map((stop, stopIndex) => ({
      dayIndex,
      stopIndex,
      stop,
    }))
  );
}

function tripDayCount(plan: TripPlan) {
  return Math.max(plan.tripLengthDays ?? 0, plan.itineraryDays?.length ?? 0);
}

function isMultiDayTrip(plan: TripPlan) {
  return tripDayCount(plan) >= 2;
}

function hasStayCoverage(plan: TripPlan, stops: IndexedStop[]) {
  return Boolean(
    normalizeText(plan.savedSelectionState?.hotelName) ||
      (plan.hotelOptions?.length ?? 0) > 0 ||
      stops.some(({ stop }) => stop.kind === "stay")
  );
}

function hasTravelCoverage(plan: TripPlan, stops: IndexedStop[]) {
  if (plan.isStaycation) return true;
  return stops.some(({ stop }) => stop.kind === "travel");
}

function describeStop(stop: ItineraryStop) {
  return normalizeText(stop.title) || "Untitled stop";
}

function collectBaseIssues(plan: TripPlan): TripPlanInvariantIssue[] {
  const issues: TripPlanInvariantIssue[] = [];
  const days = plan.itineraryDays ?? [];
  const stops = getIndexedStops(plan);

  if (days.length === 0) {
    issues.push({
      code: "missing_itinerary_days",
      message: "add at least one itinerary day before saving this trip.",
    });
    return issues;
  }

  days.forEach((day, dayIndex) => {
    if ((day.stops?.length ?? 0) === 0) {
      issues.push({
        code: "empty_itinerary_day",
        message: `fill in day ${dayIndex + 1} before saving this trip.`,
        dayIndex,
      });
    }
  });

  if (stops.length === 0) {
    issues.push({
      code: "missing_itinerary_stops",
      message: "add at least one itinerary stop before saving this trip.",
    });
    return issues;
  }

  stops.forEach(({ dayIndex, stopIndex, stop }) => {
    if (!normalizeText(stop.title)) {
      issues.push({
        code: "missing_stop_title",
        message: `name every itinerary stop before saving this trip.`,
        dayIndex,
        stopIndex,
      });
    }
  });

  if (isMultiDayTrip(plan) && !plan.isStaycation && !hasStayCoverage(plan, stops)) {
    issues.push({
      code: "missing_stay_anchor",
      message: "pick a stay before saving a multi-day overnight trip.",
    });
  }

  if (!hasTravelCoverage(plan, stops)) {
    issues.push({
      code: "missing_travel_anchor",
      message: "add the main travel leg before saving this trip.",
    });
  }

  return issues;
}

function detectFinalizePlaceholderIssue(indexedStop: IndexedStop): TripPlanInvariantIssue | null {
  const title = normalizeText(indexedStop.stop.title);
  const description = normalizeText(indexedStop.stop.description);
  const haystack = `${title}\n${description}`;

  const match = FINALIZE_PLACEHOLDER_PATTERNS.find(({ pattern }) => pattern.test(haystack));
  if (!match) return null;

  return {
    code: match.code,
    message: `replace unresolved placeholder stop "${describeStop(indexedStop.stop)}" before finalizing.`,
    dayIndex: indexedStop.dayIndex,
    stopIndex: indexedStop.stopIndex,
    stopTitle: title || undefined,
  };
}

function collectFinalizeIssues(plan: TripPlan): TripPlanInvariantIssue[] {
  const issues: TripPlanInvariantIssue[] = [];
  const stops = getIndexedStops(plan);
  const nonTravelStops = stops.filter(({ stop }) => stop.kind !== "travel");

  if (nonTravelStops.length === 0) {
    issues.push({
      code: "no_non_travel_stops",
      message: "add at least one real stop beyond the drive before finalizing.",
    });
  }

  for (const indexedStop of stops) {
    const placeholderIssue = detectFinalizePlaceholderIssue(indexedStop);
    if (placeholderIssue) {
      issues.push(placeholderIssue);
    }
  }

  const verification = verifyTripPlan(plan);
  for (const verificationIssue of verification.issues) {
    if (verificationIssue.severity !== "blocking") {
      continue;
    }

    issues.push({
      code: `verification_${verificationIssue.code}`,
      message: verificationIssue.detail,
      dayIndex: verificationIssue.dayIndex,
      stopIndex: verificationIssue.stopIndex,
      stopTitle: verificationIssue.stopTitle,
    });
  }

  return issues;
}

export function summarizeTripPlanInvariantIssues(
  stage: TripPlanInvariantStage,
  issues: TripPlanInvariantIssue[]
) {
  if (!issues.length) return undefined;

  const prefix = stage === "finalize" ? "Finalize blocked" : "Save blocked";
  const firstIssue = issues[0];
  if (issues.length === 1) return `${prefix}: ${firstIssue.message}`;
  return `${prefix}: ${firstIssue.message} (${issues.length} issues total).`;
}

export function validateTripPlanInvariants(
  plan: TripPlan,
  options?: {
    stage?: TripPlanInvariantStage;
  }
): TripPlanInvariantResult {
  const stage = options?.stage ?? "save";
  const issues = [
    ...collectBaseIssues(plan),
    ...(stage === "finalize" ? collectFinalizeIssues(plan) : []),
  ];

  return {
    ok: issues.length === 0,
    stage,
    issues,
    message: summarizeTripPlanInvariantIssues(stage, issues),
  };
}
