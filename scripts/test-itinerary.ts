import { loadEnvConfig } from "@next/env";
import { buildTripPlan } from "../lib/buildTripPlan";
import { rankDestinations } from "../lib/rankDestinations";
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
  }

  const thresholds: Record<TripStyle, number> = {
    foodie: 6,
    adventure: 5,
    outdoors: 5,
    chill: 4,
    "solo reset": 4,
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

function main() {
  const cases = buildCases();
  const evaluations = cases.map((testCase) => {
    const result = evaluateCase(testCase);
    return { testCase, result };
  });
  const regressionChecks = [
    evaluatePromptDrivenCanmoreRegression(),
    evaluateRequestedActivityRegression(),
    evaluateSkiTripRegression(),
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
