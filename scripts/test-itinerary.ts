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

function evaluateCase(testCase: TestCase): Evaluation {
  const ranked = rankDestinations(testCase.input, 1);
  const winner = ranked[0];

  if (!winner) {
    return {
      styleScore: 0,
      stylePassed: false,
      budgetPassed: false,
      lengthPassed: false,
      notes: ["No destination matched the hard filters."],
    };
  }

  const plan = buildTripPlan(winner, testCase.input, "static-ranking");
  const style = scoreStyle(plan, testCase.input.style);
  const budget = evaluateBudget(plan, testCase.input);
  const lengthPassed = plan.itineraryDays.length === testCase.input.tripLengthDays;
  const notes = [...style.notes];

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
  ];

  const passCount = evaluations.filter(
    ({ result }) => result.stylePassed && result.budgetPassed && result.lengthPassed
  ).length;
  const regressionPassCount = regressionChecks.filter((check) => check.passed).length;

  console.log(`Ran ${evaluations.length} itinerary tests.`);
  console.log(`Full pass count: ${passCount}/${evaluations.length}`);
  console.log(`Prompt regression pass count: ${regressionPassCount}/${regressionChecks.length}`);
  console.log("");

  for (const { testCase, result } of evaluations) {
    const status =
      result.stylePassed && result.budgetPassed && result.lengthPassed ? "PASS" : "FAIL";
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
    ({ result }) => !(result.stylePassed && result.budgetPassed && result.lengthPassed)
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
