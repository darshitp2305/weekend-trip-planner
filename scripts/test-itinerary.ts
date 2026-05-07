import { loadEnvConfig } from "@next/env";
import { buildTripPlan } from "../lib/buildTripPlan";
import { rankDestinations } from "../lib/rankDestinations";
import { getPromptAwareTripSummary } from "../lib/tripSpecificity";
import { deriveTripEndDate } from "../lib/tripDates";
import { TripInput, TripPlan, TripStyle } from "../lib/types";

loadEnvConfig(process.cwd());

type TestCase = {
  id: string;
  input: TripInput;
};

type Evaluation = {
  styleScore: number;
  stylePassed: boolean;
  budgetPassed: boolean;
  lengthPassed: boolean;
  qualityPassed: boolean;
  chosenDestination?: string;
  totalExpected?: number;
  notes: string[];
};

type RegressionCheck = {
  id: string;
  passed: boolean;
  notes: string[];
};

function makeInput(partial: Partial<TripInput> & Pick<TripInput, "style">): TripInput {
  const travelerCount = partial.travelerCount ?? 2;
  const budgetPerTraveler = partial.budgetPerTraveler ?? 300;
  const tripLengthDays = partial.tripLengthDays ?? 2;
  const tripStartDate = partial.tripStartDate ?? "2026-06-12";

  return {
    startCity: partial.startCity ?? "Edmonton",
    maxDriveHours: partial.maxDriveHours ?? 4,
    maxDriveMinutesBetweenStops: partial.maxDriveMinutesBetweenStops ?? 45,
    budget: partial.budget ?? travelerCount * budgetPerTraveler,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    season: partial.season ?? "summer",
    style: partial.style,
    veganFriendly: partial.veganFriendly ?? false,
    includeStaycations: partial.includeStaycations ?? true,
    strictBudget: partial.strictBudget ?? false,
    preferredDestination: partial.preferredDestination,
    tripPrompt: partial.tripPrompt,
    activityFocus: partial.activityFocus,
    departureTime: partial.departureTime,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
  };
}

function buildCases(): TestCase[] {
  return [
    { id: "T01", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 180, budget: 360, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "T02", input: makeInput({ style: "foodie", startCity: "Calgary", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T03", input: makeInput({ style: "adventure", startCity: "Edmonton", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 5, includeStaycations: false }) },
    { id: "T04", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 420, budget: 840, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T05", input: makeInput({ style: "outdoors", startCity: "Red Deer", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
    { id: "T06", input: makeInput({ style: "outdoors", startCity: "Grande Prairie", budgetPerTraveler: 320, budget: 640, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "T07", input: makeInput({ style: "chill", startCity: "Edmonton", budgetPerTraveler: 160, budget: 320, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "T08", input: makeInput({ style: "chill", startCity: "Calgary", budgetPerTraveler: 300, budget: 600, tripLengthDays: 4, maxDriveHours: 4 }) },
    { id: "T09", input: makeInput({ style: "solo reset", startCity: "St. Albert", travelerCount: 1, budgetPerTraveler: 220, budget: 220, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "T10", input: makeInput({ style: "solo reset", startCity: "Airdrie", travelerCount: 1, budgetPerTraveler: 340, budget: 340, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T11", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "T12", input: makeInput({ style: "hidden gems", startCity: "Medicine Hat", budgetPerTraveler: 300, budget: 600, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "T13", input: makeInput({ style: "foodie", startCity: "Sherwood Park", veganFriendly: true, budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5 }) },
    { id: "T14", input: makeInput({ style: "adventure", startCity: "Fort McMurray", budgetPerTraveler: 450, budget: 900, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "T15", input: makeInput({ style: "chill", startCity: "Lethbridge", budgetPerTraveler: 260, budget: 520, tripLengthDays: 3, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "T16", input: makeInput({ style: "outdoors", startCity: "Calgary", budgetPerTraveler: 210, budget: 420, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "T17", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 500, budget: 1000, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "T18", input: makeInput({ style: "solo reset", startCity: "Calgary", travelerCount: 1, budgetPerTraveler: 180, budget: 180, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true, includeStaycations: true }) },
    { id: "T19", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 380, budget: 760, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "T20", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 275, budget: 550, tripLengthDays: 2, maxDriveHours: 3, strictBudget: true, includeStaycations: false }) },
    { id: "T21", input: makeInput({ style: "must see", startCity: "Calgary", budgetPerTraveler: 475, budget: 950, tripLengthDays: 3, maxDriveHours: 4, preferredDestination: "Banff" }) },
    { id: "T22", input: makeInput({ style: "foodie", startCity: "Vancouver", budgetPerTraveler: 300, budget: 600, tripLengthDays: 2, maxDriveHours: 3, veganFriendly: true }) },
    { id: "T23", input: makeInput({ style: "chill", startCity: "Victoria", budgetPerTraveler: 300, budget: 600, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "T24", input: makeInput({ style: "outdoors", startCity: "Kelowna", budgetPerTraveler: 375, budget: 750, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T25", input: makeInput({ style: "adventure", startCity: "Kamloops", budgetPerTraveler: 325, budget: 650, tripLengthDays: 2, maxDriveHours: 4, includeStaycations: false }) },
    { id: "T26", input: makeInput({ style: "hidden gems", startCity: "Saskatoon", budgetPerTraveler: 325, budget: 650, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T27", input: makeInput({ style: "must see", startCity: "Winnipeg", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T28", input: makeInput({ style: "foodie", startCity: "Toronto", budgetPerTraveler: 375, budget: 750, tripLengthDays: 2, maxDriveHours: 3, veganFriendly: true }) },
    { id: "T29", input: makeInput({ style: "chill", startCity: "Ottawa", budgetPerTraveler: 375, budget: 750, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "T30", input: makeInput({ style: "must see", startCity: "Montreal", budgetPerTraveler: 400, budget: 800, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "T31", input: makeInput({ style: "hidden gems", startCity: "Quebec City", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "T32", input: makeInput({ style: "outdoors", startCity: "Halifax", budgetPerTraveler: 425, budget: 850, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "T33", input: makeInput({ style: "must see", startCity: "St. John's", budgetPerTraveler: 450, budget: 900, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "T34", input: makeInput({ style: "solo reset", startCity: "Whitehorse", travelerCount: 1, budgetPerTraveler: 450, budget: 450, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "T35", input: makeInput({ style: "chill", startCity: "Yellowknife", travelerCount: 1, budgetPerTraveler: 500, budget: 500, tripLengthDays: 2, maxDriveHours: 2.5 }) },
    { id: "T36", input: makeInput({ style: "outdoors", startCity: "Iqaluit", travelerCount: 1, budgetPerTraveler: 500, budget: 500, tripLengthDays: 2, maxDriveHours: 2 }) },
    { id: "T37", input: makeInput({ style: "foodie", startCity: "Moncton", budgetPerTraveler: 325, budget: 650, tripLengthDays: 2, maxDriveHours: 3 }) },
    { id: "T38", input: makeInput({ style: "chill", startCity: "Charlottetown", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "T39", input: makeInput({ style: "adventure", startCity: "Prince George", budgetPerTraveler: 425, budget: 850, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "T40", input: makeInput({ style: "hidden gems", startCity: "Nanaimo", budgetPerTraveler: 350, budget: 700, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
  ];
}

function joinedItineraryText(plan: TripPlan): string {
  return plan.itineraryDays
    .flatMap((day) => [
      day.title ?? "",
      day.summary ?? "",
      ...day.stops.flatMap((stop) => [stop.time ?? "", stop.title, stop.description ?? ""]),
    ])
    .join(" ")
    .toLowerCase();
}

function countKind(plan: TripPlan, kind: "food" | "activity" | "stay" | "travel"): number {
  return plan.itineraryDays.reduce((total, day) => {
    return total + day.stops.filter((stop) => stop.kind === kind).length;
  }, 0);
}

function countKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
}

function scoreStyle(plan: TripPlan, style: TripStyle): { score: number; passed: boolean; notes: string[] } {
  const text = joinedItineraryText(plan);
  const foodStops = countKind(plan, "food");
  const activityStops = countKind(plan, "activity");
  const notes: string[] = [];
  let score = 0;

  if (style === "foodie") {
    score += foodStops * 2;
    score += countKeywords(text, ["restaurant", "food", "coffee", "cafe", "bakery", "market", "brew"]);
    if (foodStops >= Math.max(2, plan.tripLengthDays ?? 2)) score += 2;
    if (foodStops < 2) notes.push("Too few food stops for a foodie trip.");
  } else if (style === "adventure" || style === "outdoors") {
    score += activityStops * 2;
    score += countKeywords(text, ["trail", "hike", "lake", "summit", "canyon", "waterfall", "gondola", "park", "viewpoint"]);
    if (activityStops < 2) notes.push("Too few activity anchors for an adventure/outdoors trip.");
  } else if (style === "chill" || style === "solo reset") {
    score += foodStops;
    score += activityStops;
    score += countKeywords(text, ["relax", "reset", "light", "scenic", "viewpoint", "cafe", "coffee", "downtime", "low-friction"]);
    if ((plan.tripLengthDays ?? 2) <= 2 && activityStops > 2) {
      score -= 2;
      notes.push("May be too busy for a chill/reset short trip.");
    }
  } else if (style === "hidden gems") {
    score += activityStops;
    score += countKeywords(text, ["local", "historic", "heritage", "lookout", "scenic", "museum", "trail", "favorites"]);
    if (text.includes("downtown")) score -= 1;
  } else if (style === "must see") {
    score += activityStops * 2;
    score += countKeywords(text, [
      "iconic",
      "landmark",
      "famous",
      "must-see",
      "must see",
      "classic",
      "sight",
      "museum",
      "viewpoint",
      "lookout",
      "gondola",
      "waterfall",
      "hot spring",
    ]);
    if (activityStops < 2) notes.push("Too few sightseeing anchors for a must-see trip.");
  }

  const thresholds: Record<TripStyle, number> = {
    foodie: 6,
    adventure: 5,
    outdoors: 5,
    chill: 4,
    "solo reset": 4,
    "must see": 5,
    "hidden gems": 4,
  };

  return {
    score,
    passed: score >= thresholds[style],
    notes,
  };
}

function evaluateBudget(plan: TripPlan, input: TripInput): { passed: boolean; note?: string } {
  const totalExpected = plan.budgetBreakdown.totalExpected;

  if (input.strictBudget) {
    return {
      passed: totalExpected <= input.budget,
      note:
        totalExpected <= input.budget
          ? undefined
          : `Strict budget miss: expected ${totalExpected} vs budget ${input.budget}.`,
    };
  }

  const withinTolerance = totalExpected <= input.budget * 1.15;
  return {
    passed: withinTolerance,
    note: withinTolerance
      ? undefined
      : `Soft budget miss: expected ${totalExpected} vs budget ${input.budget}.`,
  };
}

function normalizeStopName(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluatePlanQuality(plan: TripPlan, input: TripInput): { passed: boolean; notes: string[] } {
  const notes: string[] = [];
  const itineraryText = joinedItineraryText(plan);
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const foodStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "food")
  );
  const namedStops = [...activityStops, ...foodStops]
    .map((stop) => normalizeStopName(stop.title))
    .filter(Boolean);
  const duplicateStopNames = namedStops.filter(
    (name, index) => namedStops.indexOf(name) !== index
  );
  const emptyDayTitles = plan.itineraryDays
    .filter((day) => day.stops.length === 0)
    .map((day) => day.title ?? "Untitled day");
  const placeholderPatterns = [
    /\bpick a nearby activity\b/,
    /\bkeep this activity close\b/,
    /\bactivity in [a-z\s]+$/,
    /\bgrab\s*(?:&|and)\s*go\b/,
  ];

  if (emptyDayTitles.length > 0) {
    notes.push(`Empty itinerary day(s): ${emptyDayTitles.join(", ")}.`);
  }

  if (placeholderPatterns.some((pattern) => pattern.test(itineraryText))) {
    notes.push("Itinerary contains fallback or placeholder stop wording.");
  }

  if (duplicateStopNames.length > 0) {
    notes.push(`Repeated named stop(s): ${Array.from(new Set(duplicateStopNames)).join(", ")}.`);
  }

  if (
    typeof plan.driveHoursFromStart === "number" &&
    !plan.isStaycation &&
    plan.driveHoursFromStart > input.maxDriveHours + 0.15
  ) {
    notes.push(
      `Drive limit miss: ${plan.driveHoursFromStart}h vs max ${input.maxDriveHours}h.`
    );
  }

  if (!Number.isFinite(plan.budgetBreakdown.totalExpected)) {
    notes.push("Budget estimate is not finite.");
  }

  if (shouldHaveFoodCoverage(input) && foodStops.length < 1) {
    notes.push("Expected at least one food stop for this trip shape.");
  }

  if (shouldHaveActivityCoverage(input) && activityStops.length < 1) {
    notes.push("Expected at least one activity stop for this trip shape.");
  }

  if (input.tripLengthDays >= 2 && !plan.isStaycation && countKind(plan, "stay") < 1) {
    notes.push("Expected an overnight stay stop for a non-staycation multi-day trip.");
  }

  return {
    passed: notes.length === 0,
    notes,
  };
}

function shouldHaveFoodCoverage(input: TripInput): boolean {
  return (
    input.style === "foodie" ||
    input.style === "chill" ||
    input.style === "solo reset" ||
    input.tripLengthDays >= 2
  );
}

function shouldHaveActivityCoverage(input: TripInput): boolean {
  return input.style !== "foodie" || input.tripLengthDays >= 3;
}

function evaluateCase(testCase: TestCase): Evaluation {
  const ranked = rankDestinations(testCase.input, 1);
  const winner = ranked[0];

  if (!winner) {
    return {
      styleScore: 0,
      stylePassed: false,
      budgetPassed: false,
      lengthPassed: false,
      qualityPassed: false,
      notes: ["No destination matched the hard filters."],
    };
  }

  const plan = buildTripPlan(winner, testCase.input, "static-ranking");
  const style = scoreStyle(plan, testCase.input.style);
  const budget = evaluateBudget(plan, testCase.input);
  const quality = evaluatePlanQuality(plan, testCase.input);
  const lengthPassed = plan.itineraryDays.length === testCase.input.tripLengthDays;
  const notes = [...style.notes, ...quality.notes];

  if (!lengthPassed) {
    notes.push(
      `Length mismatch: itinerary has ${plan.itineraryDays.length} day(s), expected ${testCase.input.tripLengthDays}.`
    );
  }

  if (budget.note) notes.push(budget.note);

  return {
    styleScore: style.score,
    stylePassed: style.passed,
    budgetPassed: budget.passed,
    lengthPassed,
    qualityPassed: quality.passed,
    chosenDestination: winner.name,
    totalExpected: plan.budgetBreakdown.totalExpected,
    notes,
  };
}

function evaluatePromptDrivenCanmoreRegression(): RegressionCheck {
  const tripPrompt =
    "We're 3 people in Calgary and want a Banff or Canmore overnight starting today, but we can't head out until after work, around 5:45pm. Keep the first night to check-in and a late casual dinner only, no hike on arrival day. Budget is about $220 each, we want cozy more than intense, but still want one scenic stop the next morning before driving back. Don't make us drive more than about 6 hours total for the trip.";

  const input: TripInput = {
    ...makeInput({
      style: "chill",
      startCity: "Calgary",
      travelerCount: 3,
      budgetPerTraveler: 220,
      budget: 660,
      tripLengthDays: 2,
      maxDriveHours: 5,
      preferredDestination: "Canmore",
    }),
    tripPrompt,
    departureTime: "17:45",
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R01",
      passed: false,
      notes: ["No destination matched the prompt-driven Canmore regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const activityText = activityStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();

  const hospitalityActivityChosen = ["hotel", "resort", "lodge", "inn", "motel"].some((term) =>
    activityText.includes(term)
  );
  const hasScenicLightActivity = ["view", "viewpoint", "lookout", "lake", "river", "creek", "walk", "trail", "boardwalk", "garden"].some(
    (term) => activityText.includes(term)
  );

  const notes: string[] = [];
  if (!winner.name.toLowerCase().includes("canmore")) {
    notes.push(`Expected Canmore to win, got ${winner.name}.`);
  }
  if (activityStops.length < 1) {
    notes.push("Expected at least one daytime activity stop for the final morning.");
  }
  if (hospitalityActivityChosen) {
    notes.push("A hospitality property was selected as an activity anchor.");
  }
  if (!hasScenicLightActivity) {
    notes.push("Expected a scenic/light activity for the chill Canmore brief.");
  }

  return {
    id: "R01",
    passed:
      winner.name.toLowerCase().includes("canmore") &&
      activityStops.length >= 1 &&
      !hospitalityActivityChosen &&
      hasScenicLightActivity,
    notes,
  };
}

function evaluateRequestedActivityRegression(): RegressionCheck {
  const tripPrompt =
    "We're 2 people in Calgary and want a Banff overnight with one scenic hike as the main activity. Make Johnston Canyon the signature hike, keep the rest of the trip easy, and suggest a cozy trip with minimal planning friction.";

  const input: TripInput = {
    ...makeInput({
      style: "chill",
      startCity: "Calgary",
      travelerCount: 2,
      budgetPerTraveler: 300,
      budget: 600,
      tripLengthDays: 2,
      maxDriveHours: 5,
      preferredDestination: "Banff",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R02",
      passed: false,
      notes: ["No destination matched the Johnston Canyon regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const itineraryText = joinedItineraryText(plan);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("banff")) {
    notes.push(`Expected Banff to win, got ${winner.name}.`);
  }

  if (!itineraryText.includes("johnston canyon")) {
    notes.push("Expected the itinerary to keep Johnston Canyon as the requested hike.");
  }

  return {
    id: "R02",
    passed:
      winner.name.toLowerCase().includes("banff") &&
      itineraryText.includes("johnston canyon"),
    notes,
  };
}

function evaluatePromptDinnerGuaranteeRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 2-day Banff trip from Calgary for 4 travelers starting August 26, 2026. Keep the total budget under $350 per traveler. I want one scenic nearby hike, one solid local dinner, and a real overnight stay in Banff. Keep day 1 easy after the drive. Do not use distant hikes, fallback activities, or generic placeholder stops in the finalized trip.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Calgary",
      travelerCount: 4,
      budgetPerTraveler: 350,
      budget: 1400,
      tripLengthDays: 2,
      maxDriveHours: 5,
      preferredDestination: "Banff",
      tripStartDate: "2026-08-26",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R10",
      passed: false,
      notes: ["No destination matched the Banff dinner guarantee regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const foodStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "food")
  );
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const itineraryText = joinedItineraryText(plan);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("banff")) {
    notes.push(`Expected Banff to win, got ${winner.name}.`);
  }
  if (foodStops.length < 1) {
    notes.push("Expected at least one real food stop for the requested local dinner.");
  }
  if (activityStops.length < 1) {
    notes.push("Expected at least one activity stop for the requested nearby hike.");
  }
  if (itineraryText.includes("mistaya canyon")) {
    notes.push("Expected the nearby-hike brief to avoid far-away Mistaya Canyon.");
  }

  return {
    id: "R10",
    passed:
      winner.name.toLowerCase().includes("banff") &&
      foodStops.length >= 1 &&
      activityStops.length >= 1 &&
      !itineraryText.includes("mistaya canyon"),
    notes,
  };
}

function evaluateScenicHikeCoffeeRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 2-day outdoors trip to Banff from Calgary for 2 travelers in summer with one scenic hike, good coffee, and a budget of $500 per traveler.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Calgary",
      travelerCount: 2,
      budgetPerTraveler: 500,
      budget: 1000,
      tripLengthDays: 2,
      maxDriveHours: 5,
      preferredDestination: "Banff",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R11",
      passed: false,
      notes: ["No destination matched the scenic-hike-and-coffee regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const activityText = plan.itineraryDays
    .flatMap((day) => day.stops.filter((stop) => stop.kind === "activity"))
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const foodText = plan.itineraryDays
    .flatMap((day) => day.stops.filter((stop) => stop.kind === "food"))
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const hasMorningFoodStop = plan.itineraryDays.some((day) =>
    day.stops.some(
      (stop) => stop.kind === "food" && (stop.time ?? "").toLowerCase().includes("morning")
    )
  );
  const hasExplicitCoffeeStop = ["coffee", "cafe", "bakery", "espresso"].some((term) =>
    foodText.includes(term)
  );
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("banff")) {
    notes.push(`Expected Banff to win, got ${winner.name}.`);
  }
  if (
    !["trail", "hike", "canyon", "waterfall", "ridge", "summit"].some((term) =>
      activityText.includes(term)
    )
  ) {
    notes.push("Expected the itinerary to use a real hike-like anchor, not just a generic park stop.");
  }
  if (!hasExplicitCoffeeStop && !(hasMorningFoodStop && winner.confidence !== "high")) {
    notes.push(
      "Expected either a visible coffee-style stop or a lighter-confidence fallback with a dedicated morning food slot."
    );
  }
  if (foodText.includes("grab & go") || foodText.includes("grab and go")) {
    notes.push("Expected the coffee stop to avoid generic grab-and-go wording.");
  }

  return {
    id: "R11",
    passed:
      winner.name.toLowerCase().includes("banff") &&
      ["trail", "hike", "canyon", "waterfall", "ridge", "summit"].some((term) =>
        activityText.includes(term)
      ) &&
      (hasExplicitCoffeeStop || (hasMorningFoodStop && winner.confidence !== "high")) &&
      !foodText.includes("grab & go") &&
      !foodText.includes("grab and go"),
    notes,
  };
}

function evaluateSkiTripRegression(): RegressionCheck {
  const tripPrompt =
    "We're 2 people in Calgary and want a Banff overnight built around one ski day. Make skiing the main event on day 2, keep the arrival night easy with a cozy dinner, and avoid anything that makes the trip feel hectic or overplanned.";

  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Calgary",
      travelerCount: 2,
      budgetPerTraveler: 300,
      budget: 600,
      tripLengthDays: 2,
      maxDriveHours: 5,
      preferredDestination: "Banff",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R03",
      passed: false,
      notes: ["No destination matched the ski regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const activityText = activityStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("banff")) {
    notes.push(`Expected Banff to win, got ${winner.name}.`);
  }

  if (
    ![
      "ski",
      "skiing",
      "sunshine village",
      "lake louise ski resort",
      "norquay",
      "chairlift",
      "snowboard",
    ].some((term) => activityText.includes(term))
  ) {
    notes.push("Expected the itinerary to keep a ski-day activity as the main day-2 anchor.");
  }

  return {
    id: "R03",
    passed:
      winner.name.toLowerCase().includes("banff") &&
      [
        "ski",
        "skiing",
        "sunshine village",
        "lake louise ski resort",
        "norquay",
        "chairlift",
        "snowboard",
      ].some((term) => activityText.includes(term)),
    notes,
  };
}

function evaluateMultiDaySkiTripRegression(): RegressionCheck {
  const tripPrompt =
    "We're 4 people starting in Edmonton and want a 3-day ski trip in Jasper with about $300 each. Keep the arrival day easy because of the drive, but make the full middle day and the final morning both about skiing.";

  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Edmonton",
      travelerCount: 4,
      budgetPerTraveler: 300,
      budget: 1200,
      tripLengthDays: 3,
      maxDriveHours: 5,
      preferredDestination: "Jasper",
      season: "spring",
      tripStartDate: "2026-04-03",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R04",
      passed: false,
      notes: ["No destination matched the multi-day Jasper ski regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const skiKeywords = [
    "ski",
    "skiing",
    "snowboard",
    "chairlift",
    "gondola",
    "marmot basin",
  ];
  const skiDays = plan.itineraryDays
    .map((day, index) => ({
      dayNumber: index + 1,
      hasSkiActivity: day.stops.some((stop) => {
        if (stop.kind !== "activity") return false;
        const stopText = `${stop.title} ${stop.description ?? ""}`.toLowerCase();
        return skiKeywords.some((term) => stopText.includes(term));
      }),
    }))
    .filter((day) => day.hasSkiActivity)
    .map((day) => day.dayNumber);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("jasper")) {
    notes.push(`Expected Jasper to win, got ${winner.name}.`);
  }

  if (!skiDays.includes(2)) {
    notes.push("Expected the middle day to include a ski activity.");
  }

  if (!skiDays.includes(3)) {
    notes.push("Expected the final day to keep a ski activity before the drive back.");
  }

  return {
    id: "R04",
    passed:
      winner.name.toLowerCase().includes("jasper") &&
      skiDays.includes(2) &&
      skiDays.includes(3),
    notes,
  };
}

function evaluateFutureDateTimingRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day ski trip in Jasper for 4 people starting from Edmonton on April 3, 2026. Keep day 1 easy because of the drive, make day 2 a full ski day, and keep skiing on the morning of day 3 before heading back. Budget is about $300 per person total, so choose the most budget-friendly stay and food options that still make sense.";

  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Edmonton",
      travelerCount: 4,
      budgetPerTraveler: 300,
      budget: 1200,
      tripLengthDays: 3,
      maxDriveHours: 5,
      preferredDestination: "Jasper",
      season: "spring",
      tripStartDate: "2026-04-03",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R05",
      passed: false,
      notes: ["No destination matched the future-date timing regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  if (!plan) {
    return {
      id: "R05",
      passed: false,
      notes: ["Planner failed to build the future-date timing regression case."],
    };
  }
  const firstDayText = [
    plan.itineraryDays[0]?.title ?? "",
    plan.itineraryDays[0]?.summary ?? "",
    ...(plan.itineraryDays[0]?.stops ?? []).flatMap((stop) => [
      stop.time ?? "",
      stop.title,
      stop.description ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
  const notes: string[] = [];

  if (/\bleav(?:e|ing) around\b/.test(firstDayText)) {
    notes.push("Expected future-dated trips without a prompt time to avoid invented departure copy.");
  }

  if (/\b\d{1,2}:\d{2}\s*(am|pm)\b/.test(firstDayText)) {
    notes.push("Expected future-dated trips without a prompt time to avoid exact clock times.");
  }

  return {
    id: "R05",
    passed:
      !/\bleav(?:e|ing) around\b/.test(firstDayText) &&
      !/\b\d{1,2}:\d{2}\s*(am|pm)\b/.test(firstDayText),
    notes,
  };
}

function evaluateMultiDaySkiSummaryRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day ski trip in Jasper for 4 people starting from Edmonton on April 3, 2026. Keep day 1 easy because of the drive, make day 2 a full ski day, and keep skiing on the morning of day 3 before heading back. Budget is about $300 per person total, so choose the most budget-friendly stay and food options that still make sense.";

  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Edmonton",
      travelerCount: 4,
      budgetPerTraveler: 300,
      budget: 1200,
      tripLengthDays: 3,
      maxDriveHours: 5,
      preferredDestination: "Jasper",
      season: "spring",
      tripStartDate: "2026-04-03",
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R06",
      passed: false,
      notes: ["No destination matched the multi-day ski summary regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  if (!plan) {
    return {
      id: "R06",
      passed: false,
      notes: ["Planner failed to build the multi-day ski summary regression case."],
    };
  }
  const summary = (
    getPromptAwareTripSummary({
      summary: plan.summary,
      tripPrompt: plan.tripPrompt,
      tripLengthDays: plan.itineraryDays?.length,
      destinationName: plan.destinationName,
      destination: plan.destination,
      homeBaseCity: plan.homeBaseCity,
      name: plan.name,
      topActivities: plan.topActivities,
      itineraryDays: plan.itineraryDays,
      savedSelectionState: plan.savedSelectionState,
    }) ?? ""
  ).toLowerCase();
  const notes: string[] = [];

  if (!summary.includes("across 2 days")) {
    notes.push(`Expected the ski summary to reflect multi-day skiing, got: ${summary}`);
  }

  if (summary.includes("one clear winter-sports day")) {
    notes.push("Expected the ski summary to stop describing the trip as a one-day winter-sports plan.");
  }

  if (summary.includes("jasper ski day")) {
    notes.push("Expected the ski summary to avoid generated placeholder ski-anchor names.");
  }

  return {
    id: "R06",
    passed:
      summary.includes("across 2 days") &&
      !summary.includes("one clear winter-sports day") &&
      !summary.includes("jasper ski day"),
    notes,
  };
}

function evaluateDistanceCappedActivityRegression(): RegressionCheck {
  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Edmonton",
      travelerCount: 2,
      budgetPerTraveler: 275,
      budget: 550,
      tripLengthDays: 2,
      maxDriveHours: 5,
      maxDriveMinutesBetweenStops: 45,
      preferredDestination: "Banff",
    }),
    tripPrompt:
      "Plan a Banff overnight with one scenic hike and keep the stops close to town.",
  };

  const baseTrip = rankDestinations(input, 1)[0];
  if (!baseTrip) {
    return {
      id: "R07",
      passed: false,
      notes: ["No destination matched the distance-capped Banff regression case."],
    };
  }

  const syntheticTrip = {
    ...baseTrip,
    latitude: 51.1784,
    longitude: -115.5708,
    hotelOptions: [
      {
        name: "Tunnel Mountain area stay",
        bookingLink: "https://example.com/hotel",
        latitude: 51.1787,
        longitude: -115.5549,
      },
    ],
    topActivities: [
      {
        name: "Banff Gondola",
        type: "Scenic",
        costEstimate: 70,
        latitude: 51.1499,
        longitude: -115.5739,
      },
      {
        name: "Mistaya Canyon Trail Head - Banff",
        type: "Hiking Area",
        costEstimate: 0,
        latitude: 51.9189,
        longitude: -116.4638,
      },
    ],
    foodSpots: [
      {
        name: "Banff Ave Cafe",
        tags: ["Cafe"],
        latitude: 51.178,
        longitude: -115.571,
      },
    ],
  };

  const plan = buildTripPlan(syntheticTrip, input, "static-ranking");
  const itineraryText = joinedItineraryText(plan);

  return {
    id: "R07",
    passed:
      itineraryText.includes("banff gondola") &&
      !itineraryText.includes("mistaya canyon"),
    notes:
      itineraryText.includes("mistaya canyon")
        ? ["Expected far-off activities to be excluded when a nearby Banff option exists."]
        : [],
  };
}

function evaluatePlanPersistenceRegression(): RegressionCheck {
  const input = makeInput({
    style: "adventure",
    startCity: "Calgary",
    travelerCount: 2,
    budgetPerTraveler: 300,
    budget: 600,
    tripLengthDays: 2,
    preferredDestination: "Banff",
  });

  const baseTrip = rankDestinations(input, 1)[0];
  if (!baseTrip) {
    return {
      id: "R08",
      passed: false,
      notes: ["No destination matched the saved-plan persistence regression case."],
    };
  }

  const plan = buildTripPlan(
    {
      ...baseTrip,
      latitude: 51.1784,
      longitude: -115.5708,
      routeSummary: {
        distanceMeters: 128000,
        durationSeconds: 5400,
        origin: {
          lat: 51.0447,
          lon: -114.0719,
          label: "Calgary, Alberta",
        },
        destination: {
          lat: 51.1784,
          lon: -115.5708,
          label: "Banff, Alberta",
        },
      },
    },
    input,
    "static-ranking"
  );

  const notes: string[] = [];
  if (!plan.routeSummary?.durationSeconds) {
    notes.push("Expected saved plans to retain route summary data.");
  }
  if (typeof plan.latitude !== "number" || typeof plan.longitude !== "number") {
    notes.push("Expected saved plans to retain destination coordinates.");
  }

  return {
    id: "R08",
    passed: notes.length === 0,
    notes,
  };
}

function evaluateFarOnlyActivityFallbackRegression(): RegressionCheck {
  const input: TripInput = {
    ...makeInput({
      style: "adventure",
      startCity: "Edmonton",
      travelerCount: 2,
      budgetPerTraveler: 275,
      budget: 550,
      tripLengthDays: 2,
      maxDriveHours: 5,
      maxDriveMinutesBetweenStops: 45,
      preferredDestination: "Banff",
    }),
    tripPrompt:
      "Plan a Banff overnight with a nearby scenic activity, not a huge detour.",
  };

  const baseTrip = rankDestinations(input, 1)[0];
  if (!baseTrip) {
    return {
      id: "R09",
      passed: false,
      notes: ["No destination matched the far-only activity fallback case."],
    };
  }

  const syntheticTrip = {
    ...baseTrip,
    latitude: 51.1784,
    longitude: -115.5708,
    hotelOptions: [
      {
        name: "Tunnel Mountain area stay",
        bookingLink: "https://example.com/hotel",
        latitude: 51.1787,
        longitude: -115.5549,
      },
    ],
    topActivities: [
      {
        name: "Mistaya Canyon Trail Head - Banff",
        type: "Hiking Area",
        costEstimate: 0,
        latitude: 51.9189,
        longitude: -116.4638,
      },
    ],
    foodSpots: [
      {
        name: "Banff Ave Cafe",
        tags: ["Cafe"],
        latitude: 51.178,
        longitude: -115.571,
      },
    ],
  };

  const plan = buildTripPlan(syntheticTrip, input, "static-ranking");
  const itineraryText = joinedItineraryText(plan);
  const activityStopCount = countKind(plan, "activity");
  const hasLocalFallbackCopy =
    itineraryText.includes("nearby activity in banff") ||
    itineraryText.includes("keep this activity close to banff");

  return {
    id: "R09",
    passed:
      !itineraryText.includes("mistaya canyon") &&
      (hasLocalFallbackCopy || activityStopCount === 0),
    notes:
      itineraryText.includes("mistaya canyon")
        ? ["Expected the planner to fall back to a local placeholder when every activity is too far away."]
        : !(hasLocalFallbackCopy || activityStopCount === 0)
          ? ["Expected the planner to keep the day local or omit the activity slot when every option is too far away."]
          : [],
  };
}

function evaluateBanffGentleHikeWellnessRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day mountain weekend from Calgary to Banff in early summer for 2 travelers with a $450 per-person budget. We want one scenic but beginner-friendly hike, good coffee each morning, a relaxing hot springs or spa moment, and no packed schedule. Keep driving between stops short, include practical parking or shuttle advice, and make sure the builder catches must-have items like bear spray, layers, water, and a park pass.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Calgary",
      travelerCount: 2,
      budgetPerTraveler: 450,
      budget: 900,
      tripLengthDays: 3,
      maxDriveHours: 4,
      maxDriveMinutesBetweenStops: 45,
      preferredDestination: "Banff",
    }),
    activityFocus: "hiking",
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R12",
      passed: false,
      notes: ["No destination matched the gentle Banff hike and hot springs case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const itineraryText = joinedItineraryText(plan);
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const arrivalActivities =
    plan.itineraryDays[0]?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const summary = getPromptAwareTripSummary({
    name: "Banff",
    destinationName: "Banff",
    homeBaseCity: "Banff",
    tripPrompt,
    tripLengthDays: 3,
    topActivities: [
      {
        name: "Kluane Ridge Trail",
        type: "Hiking Area",
        costEstimate: 0,
        shortDescription: "A summit trail through Kluane National Park.",
        rating: 5,
      },
      {
        name: "Johnston Canyon to Upper Falls",
        type: "nature",
        costEstimate: 0,
        shortDescription: "Signature Banff-area canyon hike with a strong scenic payoff.",
        rating: 4.8,
      },
    ],
    foodSpots: winner.foodSpots,
  });
  const liveLikePlan = buildTripPlan(
    {
      ...winner,
      hotelOptions: [
        {
          name: "Best Western Plus Banff International Lodge",
          bookingLink: "https://example.com/banff-hotel",
          latitude: 51.1814,
          longitude: -115.5664,
        },
      ],
      foodSpots: [
        {
          name: "Mountain Folk Coffee Co.",
          tags: ["Cafe", "coffee"],
          category: "Cafe",
          rating: 4.6,
          latitude: 51.178,
          longitude: -115.571,
        },
        {
          name: "The Fat Ox of Banff",
          tags: ["Restaurant"],
          category: "Restaurant",
          rating: 4.5,
          latitude: 51.1801,
          longitude: -115.5676,
        },
      ],
      topActivities: [
        {
          name: "Silverton Falls",
          type: "Scenic Spot",
          costEstimate: 0,
          rating: 4.6,
          shortDescription: "Waterfall trail near Banff National Park.",
          latitude: 51.248,
          longitude: -115.842,
        },
        {
          name: "Banff Upper Hot Springs",
          type: "Public bath",
          costEstimate: 32,
          rating: 4.2,
          shortDescription: "Classic relaxing hot springs soak near Banff.",
          latitude: 51.1511,
          longitude: -115.5607,
        },
        {
          name: "Sulphur Mountain Trail",
          type: "Hiking Area",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Steeper Banff hiking trail to mountain viewpoints.",
          latitude: 51.148,
          longitude: -115.556,
        },
      ],
    },
    input,
    "live-google-places"
  );
  const liveLikeText = joinedItineraryText(liveLikePlan);
  const liveLikeActivityStops = liveLikePlan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("banff")) {
    notes.push(`Expected Banff to win, got ${winner.name}.`);
  }
  if (!/hot spring|hot springs|spa/.test(itineraryText)) {
    notes.push("Expected the explicit hot springs or spa request to show up in the itinerary.");
  }
  if (activityStops.length > 2) {
    notes.push(`Expected the no-packed-schedule brief to stay near two activity stops, got ${activityStops.length}.`);
  }
  if (arrivalActivities.length > 0) {
    notes.push("Expected arrival day to stay light and save the hike for the full day.");
  }
  if ((summary ?? "").toLowerCase().includes("kluane")) {
    notes.push("Expected Banff summary copy to reject off-destination Kluane hike language.");
  }
  if ((summary ?? "").toLowerCase().includes("exchange district")) {
    notes.push("Expected food/coffee wording to avoid becoming a fake requested hike anchor.");
  }
  if (liveLikeText.includes("sulphur mountain trail")) {
    notes.push("Expected the beginner-friendly one-hike live-like plan to prefer the gentler waterfall hike over Sulphur Mountain Trail.");
  }
  if (liveLikeActivityStops.length > 2) {
    notes.push(`Expected the live-like one-hike plan to stay near two activity stops, got ${liveLikeActivityStops.length}.`);
  }

  return {
    id: "R12",
    passed:
      winner.name.toLowerCase().includes("banff") &&
      /hot spring|hot springs|spa/.test(itineraryText) &&
      activityStops.length <= 2 &&
      arrivalActivities.length === 0 &&
      !(summary ?? "").toLowerCase().includes("kluane") &&
      !(summary ?? "").toLowerCase().includes("exchange district") &&
      liveLikeText.includes("silverton falls") &&
      !liveLikeText.includes("sulphur mountain trail") &&
      liveLikeActivityStops.length <= 2,
    notes,
  };
}

function evaluatePreferredDestinationBudgetNearMissRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day relaxed mountain weekend from Calgary to Canmore in early summer for 2 travelers with a $400 per-person budget. We want one beginner-friendly scenic hike or lake walk, good coffee each morning, one relaxing spa or hot springs-style recovery stop, and no packed schedule. Keep drives between stops short, avoid steep summit hikes, include practical parking or shuttle advice, and make sure the must-haves include layers, water, sun protection, and bear spray.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Calgary",
      travelerCount: 2,
      budgetPerTraveler: 400,
      budget: 800,
      tripLengthDays: 3,
      maxDriveHours: 2,
      maxDriveMinutesBetweenStops: 45,
      preferredDestination: "Canmore",
      strictBudget: true,
    }),
    activityFocus: "hiking",
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  const notes: string[] = [];

  if (!winner) {
    return {
      id: "R13",
      passed: false,
      notes: ["Expected the preferred Canmore near-budget case to return a ranked destination instead of showing a destination-blocked modal."],
    };
  }

  if (!winner.name.toLowerCase().includes("canmore")) {
    notes.push(`Expected Canmore to remain selected, got ${winner.name}.`);
  }
  if (winner.estimatedCost <= input.budget) {
    notes.push("Expected this regression to exercise the small over-budget path.");
  }
  if (!winner.warnings.some((warning) => warning.toLowerCase().includes("budget"))) {
    notes.push("Expected the trip to keep a budget warning instead of hiding the overage.");
  }
  const cardSummary = getPromptAwareTripSummary({
    summary: winner.aiSummary ?? winner.summary,
    tripPrompt,
    tripLengthDays: input.tripLengthDays,
    destinationName: winner.name,
    destination: winner.name,
    homeBaseCity: winner.homeBaseCity,
    name: winner.name,
    foodSpots: winner.foodSpots,
    topActivities: winner.topActivities,
  })?.toLowerCase();

  const liveLikePlan = buildTripPlan(
    {
      ...winner,
      hotelOptions: [
        {
          name: "Canmore Inn & Suites",
          bookingLink: "https://example.com/canmore-hotel",
          latitude: 51.0959,
          longitude: -115.3587,
        },
      ],
      foodSpots: [
        {
          name: "Eclipse Coffee Roasters",
          tags: ["Cafe", "coffee"],
          category: "Cafe",
          rating: 4.5,
          latitude: 51.097,
          longitude: -115.356,
        },
        {
          name: "Blondies Cafe",
          tags: ["Coffee Shop", "Cafe"],
          category: "Coffee Shop",
          rating: 4.5,
          latitude: 51.092,
          longitude: -115.359,
        },
        {
          name: "Communitea Cafe",
          tags: ["Restaurant"],
          category: "Restaurant",
          rating: 4.6,
          latitude: 51.089,
          longitude: -115.357,
        },
      ],
      topActivities: [
        {
          name: "Canmore Engine Bridge",
          type: "Bridge",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Bridge near downtown Canmore.",
          latitude: 51.083,
          longitude: -115.367,
        },
        {
          name: "Grassi Lakes Trail",
          type: "Hiking Area",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Short beginner-friendly lake hike near Canmore.",
          latitude: 51.0706,
          longitude: -115.4002,
        },
        {
          name: "One Wellness Canmore",
          type: "Spa",
          costEstimate: 65,
          rating: 4.6,
          shortDescription: "In-town spa and wellness recovery stop.",
          latitude: 51.0858,
          longitude: -115.3418,
        },
      ],
    },
    input,
    "live-google-places"
  );
  const liveLikeText = joinedItineraryText(liveLikePlan);
  const liveLikeActivityStops = liveLikePlan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const thinLivePlan = buildTripPlan(
    {
      ...winner,
      hotelOptions: [
        {
          name: "Canmore Inn & Suites",
          bookingLink: "https://example.com/canmore-hotel",
          latitude: 51.0959,
          longitude: -115.3587,
        },
      ],
      foodSpots: [
        {
          name: "Eclipse Coffee Roasters",
          tags: ["Cafe", "coffee"],
          category: "Cafe",
          rating: 4.5,
          latitude: 51.097,
          longitude: -115.356,
        },
      ],
      topActivities: [
        {
          name: "Canmore Engine Bridge",
          type: "Bridge",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Bridge near downtown Canmore.",
          latitude: 51.083,
          longitude: -115.367,
        },
        {
          name: "Everwild Canmore - Nordic Spa & Hotel",
          type: "Hotel",
          costEstimate: 65,
          rating: 4.5,
          shortDescription: "Hotel and nordic spa in Canmore.",
          latitude: 51.092,
          longitude: -115.341,
        },
      ],
    },
    input,
    "live-google-places"
  );
  const thinLiveText = joinedItineraryText(thinLivePlan);

  if (!/grassi lakes trail|policeman's creek boardwalk|quarry lake park loop/.test(liveLikeText)) {
    notes.push("Expected the live-like Canmore plan to use a real beginner-friendly hike or lake walk.");
  }
  if (!/one wellness canmore|spa|wellness|hot spring|hot springs/.test(liveLikeText)) {
    notes.push("Expected the live-like Canmore plan to include a real spa or wellness recovery stop.");
  }
  if (liveLikeText.includes("canmore engine bridge")) {
    notes.push("Expected the live-like Canmore plan not to treat Canmore Engine Bridge as the main scenic hike.");
  }
  if (thinLiveText.includes("canmore engine bridge")) {
    notes.push("Expected thin live results not to fall back to Canmore Engine Bridge as the scenic hike.");
  }
  if (!/grassi lakes|policeman's creek boardwalk|quarry lake park loop/.test(cardSummary ?? "")) {
    notes.push("Expected the recommendation card summary to name a real easy scenic hike or lake walk.");
  }
  if ((cardSummary ?? "").includes("canmore engine bridge")) {
    notes.push("Expected the recommendation card summary not to name Canmore Engine Bridge as the scenic hike.");
  }
  if (liveLikeActivityStops.length > 2) {
    notes.push(`Expected the no-packed-schedule Canmore plan to stay near two activity stops, got ${liveLikeActivityStops.length}.`);
  }

  return {
    id: "R13",
    passed:
      winner.name.toLowerCase().includes("canmore") &&
      winner.estimatedCost > input.budget &&
      winner.warnings.some((warning) => warning.toLowerCase().includes("budget")) &&
      /grassi lakes trail|policeman's creek boardwalk|quarry lake park loop/.test(liveLikeText) &&
      /one wellness canmore|spa|wellness|hot spring|hot springs/.test(liveLikeText) &&
      !liveLikeText.includes("canmore engine bridge") &&
      !thinLiveText.includes("canmore engine bridge") &&
      /grassi lakes|policeman's creek boardwalk|quarry lake park loop/.test(cardSummary ?? "") &&
      !(cardSummary ?? "").includes("canmore engine bridge") &&
      liveLikeActivityStops.length <= 2,
    notes,
  };
}

function evaluateEdmontonScenicWeekendRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day weekend trip from Edmonton for 4 adults in early July with a total budget around $1,600 CAD. We want a mountain or lake destination within about 5 hours of driving, with one scenic hike that feels worth the drive, one relaxed waterfront or viewpoint stop, good coffee, one memorable dinner, and enough downtime that it does not feel packed. Avoid tourist-trap days, avoid very expensive resorts, and prioritize places where the route, meals, and activities make practical sense together.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Edmonton",
      travelerCount: 4,
      budgetPerTraveler: 400,
      budget: 1600,
      tripLengthDays: 3,
      maxDriveHours: 5,
      maxDriveMinutesBetweenStops: 45,
    }),
    activityFocus: "hiking",
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R14",
      passed: false,
      notes: ["No destination matched the Edmonton scenic weekend regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const itineraryText = joinedItineraryText(plan);
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const foodStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "food")
  );
  const notes: string[] = [];

  if (plan.itineraryDays.length !== 3) {
    notes.push(`Expected 3 itinerary days, got ${plan.itineraryDays.length}.`);
  }
  if (itineraryText.includes("summit")) {
    notes.push("Expected a generic scenic-hike prompt not to become a summit-hike itinerary.");
  }
  if (!/scenic hike day|beginner-friendly scenic hike|planned scenic hike/.test(itineraryText)) {
    notes.push("Expected the itinerary copy to frame the main activity as one lighter scenic hike.");
  }
  if (activityStops.length > 2) {
    notes.push(`Expected the downtime brief to keep activity count low, got ${activityStops.length}.`);
  }
  if (!/coffee|cafe|cafes|cafés|bakery/.test(itineraryText)) {
    notes.push("Expected a visible coffee or cafe-style stop.");
  }
  if (!/dinner|restaurant|main street/.test(itineraryText)) {
    notes.push("Expected a visible dinner-style stop.");
  }
  if (foodStops.length < 2) {
    notes.push("Expected at least two food stops across the 3-day weekend.");
  }

  const liveLikePlan = buildTripPlan(
    {
      ...winner,
      foodSpots: [
        {
          name: "ankor restaurants",
          category: "Restaurant",
          tags: ["restaurant"],
          rating: 4.5,
          latitude: 51.089,
          longitude: -115.356,
        },
        {
          name: "Eclipse Coffee Roasters",
          category: "Cafe",
          tags: ["coffee", "cafe"],
          rating: 4.7,
          latitude: 51.091,
          longitude: -115.354,
        },
        {
          name: "Communitea Cafe",
          category: "Restaurant",
          tags: ["restaurant", "cafe"],
          rating: 4.6,
          latitude: 51.09,
          longitude: -115.357,
        },
      ],
      topActivities: [
        {
          name: "Policeman's Creek Boardwalk",
          type: "Scenic Walk",
          costEstimate: 0,
          rating: 4.6,
          shortDescription: "Easy creekside boardwalk in Canmore.",
          latitude: 51.086,
          longitude: -115.352,
        },
        {
          name: "Quarry Lake Park loop",
          type: "Scenic Walk",
          costEstimate: 0,
          rating: 4.7,
          shortDescription:
            "Low-effort lake walk close to Canmore with mountain views and an easy recovery-day feel.",
          latitude: 51.083,
          longitude: -115.384,
        },
      ],
    },
    input,
    "live-google-places"
  );
  const liveFoodTitles = liveLikePlan.itineraryDays
    .flatMap((day) => day.stops)
    .filter((stop) => stop.kind === "food")
    .map((stop) => stop.title.toLowerCase());
  const liveLikeActivityStops = liveLikePlan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const liveFinalDay = liveLikePlan.itineraryDays.at(-1);
  const liveFinalDayActivityStops =
    liveFinalDay?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const liveFinalDaySummary = liveFinalDay?.summary?.toLowerCase() ?? "";
  const duplicatedLiveFoodTitles = liveFoodTitles.filter(
    (title, index) => liveFoodTitles.indexOf(title) !== index
  );
  const liveSummary = getPromptAwareTripSummary({
    summary: winner.summary,
    tripPrompt,
    tripLengthDays: input.tripLengthDays,
    destinationName: winner.name,
    destination: winner.name,
    homeBaseCity: winner.homeBaseCity,
    name: winner.name,
    foodSpots: liveLikePlan.foodSpots,
    topActivities: liveLikePlan.topActivities,
    itineraryDays: liveLikePlan.itineraryDays,
  })?.toLowerCase();

  if (duplicatedLiveFoodTitles.length > 0) {
    notes.push(`Expected live-like food stops not to repeat, got ${duplicatedLiveFoodTitles.join(", ")}.`);
  }
  if (!liveSummary?.includes("quarry lake park loop")) {
    notes.push("Expected the recommendation summary to follow the itinerary's selected scenic hike.");
  }
  if (!liveSummary?.includes("policeman's creek boardwalk")) {
    notes.push("Expected the recommendation summary to include the relaxed final scenic stop when it is part of the itinerary.");
  }
  if ((liveSummary ?? "").includes(" now ")) {
    notes.push("Expected the recommendation summary to avoid update-oriented 'now' wording.");
  }
  if (liveLikeActivityStops.length < 2) {
    notes.push("Expected the relaxed waterfront/viewpoint request to produce a second light scenic stop when one is available.");
  }
  if (liveFinalDaySummary.includes("scenic stop") && liveFinalDayActivityStops.length === 0) {
    notes.push("Expected the final-day summary not to promise a scenic stop unless the final day has an activity stop.");
  }

  return {
    id: "R14",
    passed:
      plan.itineraryDays.length === 3 &&
      !itineraryText.includes("summit") &&
      /scenic hike day|beginner-friendly scenic hike|planned scenic hike/.test(itineraryText) &&
      activityStops.length <= 2 &&
      /coffee|cafe|cafes|cafés|bakery/.test(itineraryText) &&
      /dinner|restaurant|main street/.test(itineraryText) &&
      foodStops.length >= 2 &&
      duplicatedLiveFoodTitles.length === 0 &&
      liveLikeActivityStops.length >= 2 &&
      (!liveFinalDaySummary.includes("scenic stop") ||
        liveFinalDayActivityStops.length > 0) &&
      Boolean(liveSummary?.includes("quarry lake park loop")) &&
      Boolean(liveSummary?.includes("policeman's creek boardwalk")) &&
      !(liveSummary ?? "").includes(" now "),
    notes,
  };
}

function evaluateLateArrivalSingleHikeRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 3-day weekend trip from Edmonton for 4 adults starting Friday, April 24, 2026, with a total budget around $1,600 CAD. We can't leave until 5:45 pm, so night 1 should be just check-in and a casual late dinner. Choose a mountain or lake destination within 5 hours. Include one scenic moderate hike, one relaxed waterfront or viewpoint stop, great coffee each morning, one memorable dinner, calm pacing, and no luxury-resort or tourist-trap filler.";

  const input: TripInput = {
    ...makeInput({
      style: "outdoors",
      startCity: "Edmonton",
      travelerCount: 4,
      budgetPerTraveler: 400,
      budget: 1600,
      tripLengthDays: 3,
      maxDriveHours: 5,
      maxDriveMinutesBetweenStops: 45,
      tripStartDate: "2026-04-24",
    }),
    activityFocus: "hiking",
    departureTime: "17:45",
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R15",
      passed: false,
      notes: ["No destination matched the late-arrival single-hike regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const [dayOne, dayTwo, dayThree] = plan.itineraryDays;
  const dayOneFoodStops = dayOne?.stops.filter((stop) => stop.kind === "food") ?? [];
  const dayTwoActivityStops = dayTwo?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const dayThreeFoodStops = dayThree?.stops.filter((stop) => stop.kind === "food") ?? [];
  const dayThreeActivityStops =
    dayThree?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const hikeLikeStops = activityStops.filter((stop) =>
    /\b(hike|trail|trailhead|summit|peak|ridge|scramble|loop)\b/.test(
      [stop.title, stop.description ?? ""].join(" ").toLowerCase()
    )
  );
  const relaxedFinalStopText = dayThreeActivityStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const dayThreeFoodText = dayThreeFoodStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const summary = getPromptAwareTripSummary({
    summary: winner.summary,
    tripPrompt,
    tripLengthDays: input.tripLengthDays,
    destinationName: winner.name,
    destination: winner.name,
    homeBaseCity: winner.homeBaseCity,
    name: winner.name,
    foodSpots: plan.foodSpots,
    topActivities: plan.topActivities,
    itineraryDays: plan.itineraryDays,
  })?.toLowerCase();
  const liveLikePlan = buildTripPlan(
    {
      ...winner,
      foodSpots: [
        {
          name: "ankor restaurants",
          category: "Restaurant",
          tags: ["restaurant"],
          rating: 4.5,
          latitude: 51.089,
          longitude: -115.356,
        },
        {
          name: "Eclipse Coffee Roasters",
          category: "Cafe",
          tags: ["coffee", "cafe"],
          rating: 4.7,
          latitude: 51.091,
          longitude: -115.354,
        },
        {
          name: "Communitea Cafe",
          category: "Restaurant",
          tags: ["restaurant", "cafe"],
          rating: 4.6,
          latitude: 51.09,
          longitude: -115.357,
        },
        {
          name: "Rocky Mountain Bagel Company",
          category: "Bakery",
          tags: ["bakery", "breakfast"],
          rating: 4.7,
          latitude: 51.089,
          longitude: -115.35,
        },
      ],
      topActivities: [
        {
          name: "Grassi Lakes",
          type: "Hike",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Popular moderate lake hike with bright water and mountain views.",
          latitude: 51.089,
          longitude: -115.406,
        },
        {
          name: "Quarry Lake Park",
          type: "Scenic Walk",
          costEstimate: 0,
          rating: 4.7,
          shortDescription: "Easy lakeside walk close to Canmore.",
          latitude: 51.083,
          longitude: -115.384,
        },
      ],
    },
    input,
    "live-google-places"
  );
  const liveLikeSummary = getPromptAwareTripSummary({
    summary: winner.summary,
    tripPrompt,
    tripLengthDays: input.tripLengthDays,
    destinationName: winner.name,
    destination: winner.name,
    homeBaseCity: winner.homeBaseCity,
    name: winner.name,
    foodSpots: liveLikePlan.foodSpots,
    topActivities: liveLikePlan.topActivities,
    itineraryDays: liveLikePlan.itineraryDays,
  })?.toLowerCase();
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("canmore")) {
    notes.push(`Expected Canmore to win, got ${winner.name}.`);
  }
  if (plan.itineraryDays.length !== 3) {
    notes.push(`Expected 3 itinerary days, got ${plan.itineraryDays.length}.`);
  }
  if (dayOneFoodStops.length < 1) {
    notes.push("Expected the explicit late-arrival brief to preserve a day-1 dinner stop.");
  }
  if (dayTwoActivityStops.length > 1) {
    notes.push(`Expected the single-hike brief to keep day 2 to one main activity, got ${dayTwoActivityStops.length}.`);
  }
  if (dayThreeActivityStops.length > 1) {
    notes.push(`Expected the final day to stay light with at most one scenic stop, got ${dayThreeActivityStops.length}.`);
  }
  if (dayThreeActivityStops.length < 1) {
    notes.push("Expected the relaxed waterfront/viewpoint request to keep one light scenic stop on the final day.");
  }
  if (dayThreeFoodStops.length < 1) {
    notes.push("Expected the coffee-each-morning brief to keep a visible final-morning food stop.");
  }
  if (hikeLikeStops.length !== 1) {
    notes.push(`Expected exactly one hike-like activity stop, got ${hikeLikeStops.length}.`);
  }
  if (
    dayThreeActivityStops.length > 0 &&
    !/\b(boardwalk|waterfront|shoreline|lakeside|lakefront|viewpoint|lookout|overlook|creek|river|lake|park)\b/.test(
      relaxedFinalStopText
    )
  ) {
    notes.push("Expected the final-day activity to read like a relaxed scenic stop.");
  }
  if (/\b(trailhead|summit|peak|ridge|scramble)\b/.test(relaxedFinalStopText)) {
    notes.push("Expected the final-day scenic stop to avoid strenuous hike markers.");
  }
  if (
    dayThreeFoodStops.length > 0 &&
    !/\b(coffee|cafe|bakery|espresso|latte)\b/.test(dayThreeFoodText)
  ) {
    notes.push("Expected the final-morning food stop to read like a real coffee stop.");
  }
  if (
    dayOne?.summary?.toLowerCase().includes("hotel near") ||
    dayOne?.summary?.toLowerCase().includes("left after arrival")
  ) {
    notes.push("Expected the pre-route arrival summary copy to avoid precise timing wording.");
  }
  if (!summary?.includes("coffee both mornings")) {
    notes.push("Expected the recommendation summary to reflect the coffee-each-morning brief.");
  }
  if (
    dayThreeActivityStops.length > 0 &&
    !summary?.includes(dayThreeActivityStops[0].title.toLowerCase())
  ) {
    notes.push("Expected the recommendation summary to name the relaxed final scenic stop.");
  }
  if (!liveLikeSummary?.includes("coffee both mornings")) {
    notes.push("Expected the live-data summary to treat a morning bagel/bakery stop as satisfying the coffee-each-morning brief.");
  }

  return {
    id: "R15",
    passed:
      winner.name.toLowerCase().includes("canmore") &&
      plan.itineraryDays.length === 3 &&
      dayOneFoodStops.length >= 1 &&
      dayTwoActivityStops.length <= 1 &&
      dayThreeFoodStops.length >= 1 &&
      dayThreeActivityStops.length >= 1 &&
      dayThreeActivityStops.length <= 1 &&
      hikeLikeStops.length === 1 &&
      (dayThreeFoodStops.length === 0 ||
        /\b(coffee|cafe|bakery|espresso|latte)\b/.test(dayThreeFoodText)) &&
      (!dayThreeActivityStops.length ||
        /\b(boardwalk|waterfront|shoreline|lakeside|lakefront|viewpoint|lookout|overlook|creek|river|lake|park)\b/.test(
          relaxedFinalStopText
        )) &&
      !dayOne?.summary?.toLowerCase().includes("hotel near") &&
      !dayOne?.summary?.toLowerCase().includes("left after arrival") &&
      !/\b(trailhead|summit|peak|ridge|scramble)\b/.test(relaxedFinalStopText) &&
      Boolean(summary?.includes("coffee both mornings")) &&
      Boolean(liveLikeSummary?.includes("coffee both mornings")) &&
      (dayThreeActivityStops.length === 0 ||
        Boolean(summary?.includes(dayThreeActivityStops[0].title.toLowerCase()))),
    notes,
  };
}

function evaluateQuietBadlandsRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 4-day trip from Edmonton for 2 adults in late September with a total budget around $1,100 CAD. Choose Drumheller or a similar Alberta badlands destination. Include exactly 1 scenic drive, exactly 1 museum or main-street stop, exactly 1 easy sunset viewpoint, and exactly 1 memorable low-key dinner. Keep the pace quiet and unhurried, avoid extra filler stops, avoid luxury stays, and make sure the route feels practical.";

  const input: TripInput = {
    ...makeInput({
      style: "chill",
      startCity: "Edmonton",
      travelerCount: 2,
      tripLengthDays: 4,
      budget: 1100,
      budgetPerTraveler: 550,
      season: "fall",
      tripPrompt,
    }),
  };

  const winner = rankDestinations(input, 12).find((candidate) =>
    candidate.name.toLowerCase().includes("drumheller")
  );
  if (!winner) {
    return {
      id: "R16",
      passed: false,
      notes: ["No Drumheller-style destination was available for the quiet badlands regression case."],
    };
  }

  const liveLikePlan = buildTripPlan(
    {
      ...winner,
      foodSpots: [
        {
          name: "Black Mountain Roasters Drumheller",
          category: "Cafe",
          tags: ["coffee", "cafe"],
          rating: 4.7,
          latitude: 51.461,
          longitude: -112.71,
        },
        {
          name: "Sam's Kitchen -An Indian Restaurant -Drumheller",
          category: "Restaurant",
          tags: ["restaurant", "dinner"],
          rating: 4.6,
          latitude: 51.462,
          longitude: -112.707,
        },
        {
          name: "Cafe Ole",
          category: "Cafe",
          tags: ["coffee", "breakfast"],
          rating: 4.5,
          latitude: 51.466,
          longitude: -112.708,
        },
        {
          name: "Prairie Modern Kitchen & Prairie Pop Dirty Soda Shop",
          category: "Restaurant",
          tags: ["restaurant", "dinner"],
          rating: 4.6,
          latitude: 51.468,
          longitude: -112.706,
        },
        {
          name: "WHIFS Flapjack House",
          category: "Diner",
          tags: ["breakfast"],
          rating: 4.4,
          latitude: 51.469,
          longitude: -112.704,
        },
      ],
      topActivities: [
        {
          name: "Royal Tyrrell Museum Lookout",
          type: "Museum",
          costEstimate: 0,
          rating: 4.8,
          shortDescription: "Museum-area lookout tied to Drumheller's signature cultural stop.",
          latitude: 51.473,
          longitude: -112.79,
        },
        {
          name: "Midland Provincial Park",
          type: "Historic Park",
          costEstimate: 0,
          rating: 4.7,
          shortDescription: "Historic badlands park with interpretive value near Drumheller.",
          latitude: 51.474,
          longitude: -112.784,
        },
        {
          name: "Miners Memorial Park",
          type: "Memorial Park",
          costEstimate: 0,
          rating: 4.4,
          shortDescription: "Local heritage stop in town.",
          latitude: 51.466,
          longitude: -112.713,
        },
        {
          name: "Newcastle Beach",
          type: "Scenic Stop",
          costEstimate: 0,
          rating: 4.6,
          shortDescription: "Easy riverside stop that works well for a quieter sunset view.",
          latitude: 51.458,
          longitude: -112.702,
        },
        {
          name: "Drumheller Welcome Sign",
          type: "Landmark",
          costEstimate: 0,
          rating: 4.3,
          shortDescription: "Quick landmark photo stop on the way out of town.",
          latitude: 51.47,
          longitude: -112.69,
        },
      ],
    },
    input,
    "live-google-places"
  );

  const dayTwo = liveLikePlan.itineraryDays[1];
  const dayThree = liveLikePlan.itineraryDays[2];
  const dayFour = liveLikePlan.itineraryDays[3];
  const dayTwoActivityStops = dayTwo?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const dayThreeActivityStops = dayThree?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const dayThreeFoodStops = dayThree?.stops.filter((stop) => stop.kind === "food") ?? [];
  const dayFourActivityStops = dayFour?.stops.filter((stop) => stop.kind === "activity") ?? [];
  const totalActivityStops = liveLikePlan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const dayTwoActivityText = dayTwoActivityStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const dayThreeActivityText = dayThreeActivityStops
    .flatMap((stop) => [stop.title, stop.description ?? ""])
    .join(" ")
    .toLowerCase();
  const summary = getPromptAwareTripSummary({
    summary: winner.summary,
    tripPrompt,
    tripLengthDays: input.tripLengthDays,
    destinationName: winner.name,
    destination: winner.name,
    homeBaseCity: winner.homeBaseCity,
    name: winner.name,
    foodSpots: liveLikePlan.foodSpots,
    topActivities: liveLikePlan.topActivities,
    itineraryDays: liveLikePlan.itineraryDays,
  })?.toLowerCase();
  const notes: string[] = [];

  if (liveLikePlan.itineraryDays.length !== 4) {
    notes.push(`Expected a 4-day itinerary, got ${liveLikePlan.itineraryDays.length}.`);
  }
  if (dayTwoActivityStops.length > 1) {
    notes.push(`Expected the museum/main-street day to stay near one activity, got ${dayTwoActivityStops.length}.`);
  }
  if (dayThreeActivityStops.length > 1) {
    notes.push(`Expected the sunset day to stay near one activity, got ${dayThreeActivityStops.length}.`);
  }
  if (dayThreeFoodStops.length > 1) {
    notes.push(`Expected the sunset day to stay near one food stop, got ${dayThreeFoodStops.length}.`);
  }
  if (dayFourActivityStops.length > 0) {
    notes.push(`Expected the final drive-back day to avoid extra filler activities, got ${dayFourActivityStops.length}.`);
  }
  if (!/\b(museum|historic|heritage|main street|downtown)\b/.test(dayTwoActivityText)) {
    notes.push("Expected day 2 to carry the museum or main-street style anchor.");
  }
  if (!/\b(sunset|viewpoint|lookout|overlook|beach|river|riverside|park)\b/.test(dayThreeActivityText)) {
    notes.push("Expected day 3 to carry the easy sunset/viewpoint-style stop.");
  }
  if (totalActivityStops.length > 3) {
    notes.push(`Expected the quiet badlands trip to avoid stacking too many activity stops, got ${totalActivityStops.length}.`);
  }
  if ((summary ?? "").includes("culture, family, adventure, and scenic")) {
    notes.push("Expected the recommendation summary to avoid generic stock destination copy.");
  }
  if (!summary?.includes("royal tyrrell museum lookout")) {
    notes.push("Expected the recommendation summary to mention the chosen cultural anchor.");
  }
  if (!summary?.includes("newcastle beach")) {
    notes.push("Expected the recommendation summary to mention the easy sunset stop.");
  }

  return {
    id: "R16",
    passed:
      liveLikePlan.itineraryDays.length === 4 &&
      dayTwoActivityStops.length <= 1 &&
      dayThreeActivityStops.length <= 1 &&
      dayThreeFoodStops.length <= 1 &&
      dayFourActivityStops.length === 0 &&
      /\b(museum|historic|heritage|main street|downtown)\b/.test(dayTwoActivityText) &&
      /\b(sunset|viewpoint|lookout|overlook|beach|river|riverside|park)\b/.test(dayThreeActivityText) &&
      totalActivityStops.length <= 3 &&
      !(summary ?? "").includes("culture, family, adventure, and scenic") &&
      Boolean(summary?.includes("royal tyrrell museum lookout")) &&
      Boolean(summary?.includes("newcastle beach")),
    notes,
  };
}

function evaluateWhitehorseStaycationNonEmptyRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 2-day solo reset in Whitehorse in summer with a 450 CAD budget. I want a Yukon River walk, good coffee, one low-key dinner, and no long drive.";

  const input: TripInput = {
    ...makeInput({
      style: "solo reset",
      startCity: "Whitehorse",
      travelerCount: 1,
      budget: 450,
      budgetPerTraveler: 450,
      tripLengthDays: 2,
      maxDriveHours: 2,
      season: "summer",
      preferredDestination: "Whitehorse",
      tripPrompt,
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R17",
      passed: false,
      notes: ["No destination matched the Whitehorse staycation regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const emptyDayTitles = plan.itineraryDays
    .filter((day) => day.stops.length === 0)
    .map((day) => day.title);
  const itineraryText = joinedItineraryText(plan);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("whitehorse")) {
    notes.push(`Expected Whitehorse to win, got ${winner.name}.`);
  }
  if (emptyDayTitles.length > 0) {
    notes.push(`Expected no empty itinerary days, got empty days: ${emptyDayTitles.join(", ")}.`);
  }
  if (!itineraryText.includes("yukon river")) {
    notes.push("Expected the Yukon River walk request to remain visible in the itinerary.");
  }

  return {
    id: "R17",
    passed:
      winner.name.toLowerCase().includes("whitehorse") &&
      emptyDayTitles.length === 0 &&
      itineraryText.includes("yukon river"),
    notes,
  };
}

function evaluateHopewellTwoDayMustSeeRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 2-day must-see trip from Moncton to Hopewell Rocks for 2 adults with 600 CAD total. Include the tide rocks, one easy coastal stop, seafood, and a relaxed pace.";

  const input: TripInput = {
    ...makeInput({
      style: "must see",
      startCity: "Moncton",
      travelerCount: 2,
      budget: 600,
      budgetPerTraveler: 300,
      tripLengthDays: 2,
      maxDriveHours: 2,
      season: "summer",
      preferredDestination: "Hopewell Rocks",
      tripPrompt,
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R18",
      passed: false,
      notes: ["No destination matched the Hopewell Rocks two-day regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const itineraryText = joinedItineraryText(plan);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("hopewell")) {
    notes.push(`Expected Hopewell Rocks to win, got ${winner.name}.`);
  }
  if (activityStops.length < 1) {
    notes.push("Expected at least one activity stop for the tide-rocks/coastal-stop brief.");
  }
  if (!/\b(hopewell|fundy|tide|rocks|coast)\b/.test(itineraryText)) {
    notes.push("Expected the itinerary to keep the Bay of Fundy / Hopewell coastal signal visible.");
  }

  return {
    id: "R18",
    passed:
      winner.name.toLowerCase().includes("hopewell") &&
      activityStops.length >= 1 &&
      /\b(hopewell|fundy|tide|rocks|coast)\b/.test(itineraryText),
    notes,
  };
}

function evaluateIqaluitLocalNatureRegression(): RegressionCheck {
  const tripPrompt =
    "Plan a 2-day chill staycation-style trip from Iqaluit to Sylvia Grinnell or Apex for 1 traveler with a 350 CAD budget. Include one tundra walk, one viewpoint, simple food, and no long drive.";

  const input: TripInput = {
    ...makeInput({
      style: "chill",
      startCity: "Iqaluit",
      travelerCount: 1,
      budget: 350,
      budgetPerTraveler: 350,
      tripLengthDays: 2,
      maxDriveHours: 1,
      season: "summer",
      preferredDestination: "Sylvia Grinnell",
      tripPrompt,
    }),
    tripPrompt,
  };

  const winner = rankDestinations(input, 1)[0];
  if (!winner) {
    return {
      id: "R19",
      passed: false,
      notes: ["No destination matched the Iqaluit local nature regression case."],
    };
  }

  const plan = buildTripPlan(winner, input, "static-ranking");
  const activityStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "activity")
  );
  const stayStops = plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === "stay")
  );
  const itineraryText = joinedItineraryText(plan);
  const notes: string[] = [];

  if (!winner.name.toLowerCase().includes("sylvia grinnell")) {
    notes.push(`Expected Sylvia Grinnell / Apex to win, got ${winner.name}.`);
  }
  if (stayStops.length > 0) {
    notes.push("Expected the staycation-style no-long-drive brief to avoid a hotel check-in stop.");
  }
  if (activityStops.length < 1) {
    notes.push("Expected at least one activity stop for the tundra walk/viewpoint brief.");
  }
  if (plan.budgetBreakdown.totalExpected > input.budget) {
    notes.push(`Expected the local no-hotel version to fit the budget, got ${plan.budgetBreakdown.totalExpected}.`);
  }
  if (!/\b(tundra|sylvia grinnell|apex|viewpoint)\b/.test(itineraryText)) {
    notes.push("Expected the local Arctic nature stop to remain visible in the itinerary.");
  }

  return {
    id: "R19",
    passed:
      winner.name.toLowerCase().includes("sylvia grinnell") &&
      stayStops.length === 0 &&
      activityStops.length >= 1 &&
      plan.budgetBreakdown.totalExpected <= input.budget &&
      /\b(tundra|sylvia grinnell|apex|viewpoint)\b/.test(itineraryText),
    notes,
  };
}

function main() {
  const cases = buildCases();
  const evaluations = cases.map((testCase) => {
    const result = evaluateCase(testCase);
    return { testCase, result };
  });
  const regressionChecks = [
    evaluatePromptDrivenCanmoreRegression(),
    evaluateRequestedActivityRegression(),
    evaluatePromptDinnerGuaranteeRegression(),
    evaluateScenicHikeCoffeeRegression(),
    evaluateSkiTripRegression(),
    evaluateMultiDaySkiTripRegression(),
    evaluateFutureDateTimingRegression(),
    evaluateMultiDaySkiSummaryRegression(),
    evaluateDistanceCappedActivityRegression(),
    evaluatePlanPersistenceRegression(),
    evaluateFarOnlyActivityFallbackRegression(),
    evaluateBanffGentleHikeWellnessRegression(),
    evaluatePreferredDestinationBudgetNearMissRegression(),
    evaluateEdmontonScenicWeekendRegression(),
    evaluateLateArrivalSingleHikeRegression(),
    evaluateQuietBadlandsRegression(),
    evaluateWhitehorseStaycationNonEmptyRegression(),
    evaluateHopewellTwoDayMustSeeRegression(),
    evaluateIqaluitLocalNatureRegression(),
  ];

  const passCount = evaluations.filter(
    ({ result }) =>
      result.stylePassed &&
      result.budgetPassed &&
      result.lengthPassed &&
      result.qualityPassed
  ).length;
  const regressionPassCount = regressionChecks.filter((check) => check.passed).length;

  console.log(`Ran ${evaluations.length} itinerary tests.`);
  console.log(`Full pass count: ${passCount}/${evaluations.length}`);
  console.log(`Prompt regression pass count: ${regressionPassCount}/${regressionChecks.length}`);
  console.log("");

  for (const { testCase, result } of evaluations) {
    const status =
      result.stylePassed &&
      result.budgetPassed &&
      result.lengthPassed &&
      result.qualityPassed
        ? "PASS"
        : "FAIL";
    console.log(
      [
        status,
        testCase.id,
        testCase.input.style,
        `days=${testCase.input.tripLengthDays}`,
        `budget=${testCase.input.budget}`,
        `dest=${result.chosenDestination ?? "none"}`,
        `styleScore=${result.styleScore}`,
        `budgetOk=${result.budgetPassed}`,
        `lengthOk=${result.lengthPassed}`,
        `qualityOk=${result.qualityPassed}`,
      ].join(" | ")
    );

    if (result.notes.length > 0) {
      for (const note of result.notes) {
        console.log(`  - ${note}`);
      }
    }
  }

  console.log("");
  const failed = evaluations.filter(
    ({ result }) =>
      !(
        result.stylePassed &&
        result.budgetPassed &&
        result.lengthPassed &&
        result.qualityPassed
      )
  );
  const failedRegressions = regressionChecks.filter((check) => !check.passed);

  if (failed.length === 0) {
    console.log("No failing cases.");
  } else {
    console.log("Failing cases summary:");
    for (const { testCase, result } of failed) {
      console.log(
        `${testCase.id}: ${testCase.input.style} from ${testCase.input.startCity} -> ${
          result.chosenDestination ?? "none"
        }`
      );
    }
  }

  if (failedRegressions.length === 0) {
    console.log("No failing prompt regressions.");
  } else {
    console.log("Failing prompt regressions:");
    for (const regression of failedRegressions) {
      console.log(`${regression.id}: ${regression.notes.join(" ")}`);
    }
  }
}

main();
