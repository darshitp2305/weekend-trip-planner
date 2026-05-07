import { loadEnvConfig } from "@next/env";
import { buildTripPlan } from "../lib/buildTripPlan";
import { rankDestinations } from "../lib/rankDestinations";
import { deriveTripEndDate } from "../lib/tripDates";
import type { ItineraryStop, TripInput, TripPlan, TripStyle } from "../lib/types";

loadEnvConfig(process.cwd());

type TestCase = {
  id: string;
  input: TripInput;
};

type StopAudit = {
  passed: boolean;
  destination?: string;
  foodStops: string[];
  activityStops: string[];
  stayStops: string[];
  notes: string[];
  warnings: string[];
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
    { id: "S01", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 180, budget: 360, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "S02", input: makeInput({ style: "foodie", startCity: "Calgary", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S03", input: makeInput({ style: "adventure", startCity: "Edmonton", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 5, includeStaycations: false }) },
    { id: "S04", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 420, budget: 840, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S05", input: makeInput({ style: "outdoors", startCity: "Red Deer", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
    { id: "S06", input: makeInput({ style: "outdoors", startCity: "Grande Prairie", budgetPerTraveler: 320, budget: 640, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "S07", input: makeInput({ style: "chill", startCity: "Edmonton", budgetPerTraveler: 160, budget: 320, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "S08", input: makeInput({ style: "chill", startCity: "Calgary", budgetPerTraveler: 300, budget: 600, tripLengthDays: 4, maxDriveHours: 4 }) },
    { id: "S09", input: makeInput({ style: "solo reset", startCity: "St. Albert", travelerCount: 1, budgetPerTraveler: 220, budget: 220, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "S10", input: makeInput({ style: "solo reset", startCity: "Airdrie", travelerCount: 1, budgetPerTraveler: 340, budget: 340, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S11", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "S12", input: makeInput({ style: "hidden gems", startCity: "Medicine Hat", budgetPerTraveler: 300, budget: 600, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "S13", input: makeInput({ style: "foodie", startCity: "Sherwood Park", veganFriendly: true, budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5 }) },
    { id: "S14", input: makeInput({ style: "adventure", startCity: "Fort McMurray", budgetPerTraveler: 450, budget: 900, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "S15", input: makeInput({ style: "chill", startCity: "Lethbridge", budgetPerTraveler: 260, budget: 520, tripLengthDays: 3, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "S16", input: makeInput({ style: "outdoors", startCity: "Calgary", budgetPerTraveler: 210, budget: 420, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "S17", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 500, budget: 1000, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "S18", input: makeInput({ style: "solo reset", startCity: "Calgary", travelerCount: 1, budgetPerTraveler: 180, budget: 180, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true, includeStaycations: true }) },
    { id: "S19", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 380, budget: 760, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "S20", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 275, budget: 550, tripLengthDays: 2, maxDriveHours: 3, strictBudget: true, includeStaycations: false }) },
    { id: "S21", input: makeInput({ style: "must see", startCity: "Calgary", budgetPerTraveler: 475, budget: 950, tripLengthDays: 3, maxDriveHours: 4, preferredDestination: "Banff" }) },
    { id: "S22", input: makeInput({ style: "foodie", startCity: "Vancouver", budgetPerTraveler: 300, budget: 600, tripLengthDays: 2, maxDriveHours: 3, veganFriendly: true }) },
    { id: "S23", input: makeInput({ style: "chill", startCity: "Victoria", budgetPerTraveler: 300, budget: 600, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "S24", input: makeInput({ style: "outdoors", startCity: "Kelowna", budgetPerTraveler: 375, budget: 750, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S25", input: makeInput({ style: "adventure", startCity: "Kamloops", budgetPerTraveler: 325, budget: 650, tripLengthDays: 2, maxDriveHours: 4, includeStaycations: false }) },
    { id: "S26", input: makeInput({ style: "hidden gems", startCity: "Saskatoon", budgetPerTraveler: 325, budget: 650, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S27", input: makeInput({ style: "must see", startCity: "Winnipeg", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S28", input: makeInput({ style: "foodie", startCity: "Toronto", budgetPerTraveler: 375, budget: 750, tripLengthDays: 2, maxDriveHours: 3, veganFriendly: true }) },
    { id: "S29", input: makeInput({ style: "chill", startCity: "Ottawa", budgetPerTraveler: 375, budget: 750, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "S30", input: makeInput({ style: "must see", startCity: "Montreal", budgetPerTraveler: 400, budget: 800, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "S31", input: makeInput({ style: "hidden gems", startCity: "Quebec City", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "S32", input: makeInput({ style: "outdoors", startCity: "Halifax", budgetPerTraveler: 425, budget: 850, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "S33", input: makeInput({ style: "must see", startCity: "St. John's", budgetPerTraveler: 450, budget: 900, tripLengthDays: 3, maxDriveHours: 4 }) },
    { id: "S34", input: makeInput({ style: "solo reset", startCity: "Whitehorse", travelerCount: 1, budgetPerTraveler: 450, budget: 450, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "S35", input: makeInput({ style: "chill", startCity: "Yellowknife", travelerCount: 1, budgetPerTraveler: 500, budget: 500, tripLengthDays: 2, maxDriveHours: 2.5 }) },
    { id: "S36", input: makeInput({ style: "outdoors", startCity: "Iqaluit", travelerCount: 1, budgetPerTraveler: 500, budget: 500, tripLengthDays: 2, maxDriveHours: 2 }) },
    { id: "S37", input: makeInput({ style: "foodie", startCity: "Moncton", budgetPerTraveler: 325, budget: 650, tripLengthDays: 2, maxDriveHours: 3 }) },
    { id: "S38", input: makeInput({ style: "chill", startCity: "Charlottetown", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 3.5 }) },
    { id: "S39", input: makeInput({ style: "adventure", startCity: "Prince George", budgetPerTraveler: 425, budget: 850, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "S40", input: makeInput({ style: "hidden gems", startCity: "Nanaimo", budgetPerTraveler: 350, budget: 700, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
  ];
}

function normalize(value?: string) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stopText(stop: ItineraryStop) {
  return normalize([stop.time, stop.title, stop.description].filter(Boolean).join(" "));
}

function stopLabel(stop: ItineraryStop) {
  return `${stop.time ?? "Flexible"}:${stop.title}`;
}

function stopsByKind(plan: TripPlan, kind: ItineraryStop["kind"]) {
  return plan.itineraryDays.flatMap((day) =>
    day.stops.filter((stop) => stop.kind === kind)
  );
}

function isFallbackFoodChoice(stop: ItineraryStop) {
  const title = normalize(stop.title);
  const text = stopText(stop);

  return (
    title.startsWith("local dinner in") ||
    title.startsWith("last coffee stop in") ||
    title.startsWith("local brunch or bakery stop") ||
    title.startsWith("last local coffee") ||
    title.startsWith("pick a local food stop") ||
    title.startsWith("keep this meal close") ||
    text.includes("keep this slot")
  );
}

function isAreaLevelFoodChoice(stop: ItineraryStop) {
  const title = normalize(stop.title);

  return (
    /\b(?:restaurants?|casual dining|dining cluster|dining core|dining|food crawl|food run|dinner run|cafe loop|cafes|casual stops|patio)\b/.test(
      title
    ) &&
    !/\b(?:bistro|bakery|coffee roasters|cafe$|pub$|restaurant$)\b/.test(
      title
    )
  ) ||
    /\b(?:downtown|old strathcona|whyte|beltline|kensington|inglewood|ramsay|main street|village|market|row|district|north end|plateau|mile end|queen west|byward|broadway|riversdale|warehouse|pleasant)\b/.test(
      title
    );
}

function isWeakActivityChoice(stop: ItineraryStop) {
  const title = normalize(stop.title);
  const text = stopText(stop);

  return (
    title.includes("pick a nearby") ||
    title.includes("one more scenic stop") ||
    title.includes("classic sights day") ||
    title.includes("low key final day") ||
    title.includes("fallback") ||
    text.includes("while more destination data loads")
  );
}

function foodMatchesStyle(stop: ItineraryStop, style: TripStyle) {
  const text = stopText(stop);

  if (style === "foodie") {
    return /\b(?:food|restaurant|dinner|coffee|cafe|bakery|market|brunch|brew|patio|pub|seafood|bistro|dining|downtown|street|village|row|district|kensington|beltline|strathcona|whyte|mile end|queen west|byward|broadway|riversdale)\b/.test(
      text
    );
  }

  if (style === "solo reset" || style === "chill") {
    return /\b(?:coffee|cafe|cafes|brunch|bakery|casual|simple|dinner|market|local|low key|low friction|downtown|village|street|waterfront|harbour|harbor|kensington|inglewood|ramsay|strathcona|whyte|victoria row)\b/.test(
      text
    );
  }

  return /\b(?:dinner|restaurant|casual|coffee|cafe|cafes|bakery|local|food|market|simple|dining|downtown|village|street|row|district)\b/.test(
    text
  );
}

function activityMatchesStyle(stop: ItineraryStop, style: TripStyle) {
  const text = stopText(stop);

  if (style === "adventure" || style === "outdoors") {
    return /\b(?:trail|hike|lake|lakes|river|falls|canyon|mountain|ridge|park|parks|parkway|view|views|viewpoint|viewpoints|lookout|coast|shore|shoreline|fjord|gondola|ski|scenic|loop|drive|wildlife|bison|boat|island|tundra|granite|waterfront|dark sky|stargazing|slide|recovery|tidal|sea stack|sea-stack|floor|alpine)\b/.test(
      text
    );
  }

  if (style === "must see") {
    return /\b(?:classic|must|iconic|landmark|museum|historic|view|views|viewpoint|lookout|falls|gondola|coast|rocks|national park|signature|village|old town|waterfront|boat|island|hill|citadel)\b/.test(
      text
    );
  }

  if (style === "hidden gems") {
    return /\b(?:local|heritage|historic|museum|main street|lookout|scenic|trail|market|small town|downtown|coast|shore|shoreline|view|views|viewpoint|bay|island|bridge|park|walk|falls)\b/.test(
      text
    );
  }

  return /\b(?:walk|stroll|scenic|view|views|viewpoint|lake|lakes|river|park|coffee|cafe|cafes|food|crawl|market|dinner|restaurant|light|easy|reset|downtime|harbour|harbor|waterfront|shoreline|bay|garden|hot springs|spa|wander|loop|recovery|downtown|shops|historic|island|boat|lookout)\b/.test(
    text
  );
}

function auditCase(testCase: TestCase): StopAudit {
  const winner = rankDestinations(testCase.input, 1)[0];
  if (!winner) {
    return {
      passed: false,
      foodStops: [],
      activityStops: [],
      stayStops: [],
      notes: ["No destination matched."],
      warnings: [],
    };
  }

  const plan = buildTripPlan(winner, testCase.input, "static-ranking");
  const foodStops = stopsByKind(plan, "food");
  const activityStops = stopsByKind(plan, "activity");
  const stayStops = stopsByKind(plan, "stay");
  const notes: string[] = [];
  const warnings: string[] = [];
  const fallbackFoodStops = foodStops.filter(isFallbackFoodChoice);
  const areaLevelFoodStops = foodStops.filter(
    (stop) => isAreaLevelFoodChoice(stop) && !isFallbackFoodChoice(stop)
  );
  const weakActivityStops = activityStops.filter(isWeakActivityChoice);
  const foodMismatches = foodStops.filter(
    (stop) => !foodMatchesStyle(stop, testCase.input.style)
  );
  const activityMismatches = activityStops.filter(
    (stop) => !activityMatchesStyle(stop, testCase.input.style)
  );

  if (foodStops.length === 0 && testCase.input.tripLengthDays >= 2) {
    notes.push("No food/restaurant stop selected.");
  }

  if (activityStops.length === 0) {
    notes.push("No activity/location stop selected.");
  }

  if (fallbackFoodStops.length > 0) {
    notes.push(`Fallback food slot(s), not actual restaurant picks: ${fallbackFoodStops.map((stop) => stop.title).join(", ")}.`);
  }

  if (areaLevelFoodStops.length > 0) {
    warnings.push(`Area-level dining pick(s), not named restaurants: ${areaLevelFoodStops.map((stop) => stop.title).join(", ")}.`);
  }

  if (weakActivityStops.length > 0) {
    notes.push(`Weak activity choice(s): ${weakActivityStops.map((stop) => stop.title).join(", ")}.`);
  }

  if (foodMismatches.length > 0) {
    notes.push(`Food/style mismatch: ${foodMismatches.map((stop) => stop.title).join(", ")}.`);
  }

  if (activityMismatches.length > 0) {
    notes.push(`Activity/style mismatch: ${activityMismatches.map((stop) => stop.title).join(", ")}.`);
  }

  return {
    passed: notes.length === 0,
    destination: winner.name,
    foodStops: foodStops.map(stopLabel),
    activityStops: activityStops.map(stopLabel),
    stayStops: stayStops.map(stopLabel),
    notes,
    warnings,
  };
}

function main() {
  const cases = buildCases();
  const results = cases.map((testCase) => ({
    testCase,
    result: auditCase(testCase),
  }));
  const passCount = results.filter(({ result }) => result.passed).length;
  const warningCount = results.filter(({ result }) => result.warnings.length > 0).length;

  console.log(`Ran ${results.length} stop-choice tests.`);
  console.log(`Pass count: ${passCount}/${results.length}`);
  console.log(`Warning count: ${warningCount}/${results.length}`);
  console.log("");

  for (const { testCase, result } of results) {
    const status = result.passed
      ? result.warnings.length > 0
        ? "WARN"
        : "PASS"
      : "FAIL";
    console.log(
      [
        status,
        testCase.id,
        testCase.input.style,
        `from=${testCase.input.startCity}`,
        `dest=${result.destination ?? "none"}`,
      ].join(" | ")
    );
    console.log(`  food: ${result.foodStops.join(" | ") || "none"}`);
    console.log(`  activities: ${result.activityStops.join(" | ") || "none"}`);
    console.log(`  stays: ${result.stayStops.join(" | ") || "none"}`);
    for (const note of result.notes) {
      console.log(`  - ${note}`);
    }
    for (const warning of result.warnings) {
      console.log(`  ! ${warning}`);
    }
  }

  const failed = results.filter(({ result }) => !result.passed);
  if (failed.length > 0) {
    console.log("");
    console.log("Failing stop-choice cases:");
    for (const { testCase, result } of failed) {
      console.log(`${testCase.id}: ${result.notes.join(" ")}`);
    }
    process.exitCode = 1;
  }
}

main();
