import { POST as enrichTripPost } from "../app/api/enrich-trip/route";
import { POST as generateTripPost } from "../app/api/generate-trip/route";
import { POST as osmRoutePost } from "../app/api/osm-route/route";
import { GET as placePhotoGet } from "../app/api/place-photo/route";
import { POST as rankTripsPost } from "../app/api/rank-trips/route";
import { buildTripPlan } from "../lib/buildTripPlan";
import { rankDestinations } from "../lib/rankDestinations";
import { deriveTripEndDate } from "../lib/tripDates";
import { TripInput, TripPlan, TripStyle } from "../lib/types";

type TestResult = {
  id: string;
  area: string;
  passed: boolean;
  details: string;
};

type TestCase = {
  id: string;
  input: TripInput;
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

function buildPlannerCases(): TestCase[] {
  return [
    { id: "P01", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 180, budget: 360, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P02", input: makeInput({ style: "foodie", startCity: "Calgary", budgetPerTraveler: 350, budget: 700, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "P03", input: makeInput({ style: "adventure", startCity: "Edmonton", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 5, includeStaycations: false }) },
    { id: "P04", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 420, budget: 840, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "P05", input: makeInput({ style: "outdoors", startCity: "Red Deer", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
    { id: "P06", input: makeInput({ style: "outdoors", startCity: "Grande Prairie", budgetPerTraveler: 320, budget: 640, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "P07", input: makeInput({ style: "chill", startCity: "Edmonton", budgetPerTraveler: 160, budget: 320, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P08", input: makeInput({ style: "chill", startCity: "Calgary", budgetPerTraveler: 300, budget: 600, tripLengthDays: 4, maxDriveHours: 4 }) },
    { id: "P09", input: makeInput({ style: "solo reset", startCity: "St. Albert", travelerCount: 1, budgetPerTraveler: 220, budget: 220, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P10", input: makeInput({ style: "solo reset", startCity: "Airdrie", travelerCount: 1, budgetPerTraveler: 340, budget: 340, tripLengthDays: 3, maxDriveHours: 4.5 }) },
    { id: "P11", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "P12", input: makeInput({ style: "hidden gems", startCity: "Medicine Hat", budgetPerTraveler: 300, budget: 600, tripLengthDays: 3, maxDriveHours: 5 }) },
    { id: "P13", input: makeInput({ style: "foodie", startCity: "Sherwood Park", veganFriendly: true, budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 3.5 }) },
    { id: "P14", input: makeInput({ style: "adventure", startCity: "Fort McMurray", budgetPerTraveler: 450, budget: 900, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "P15", input: makeInput({ style: "chill", startCity: "Lethbridge", budgetPerTraveler: 260, budget: 520, tripLengthDays: 3, maxDriveHours: 4.5, includeStaycations: false }) },
    { id: "P16", input: makeInput({ style: "outdoors", startCity: "Calgary", budgetPerTraveler: 210, budget: 420, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P17", input: makeInput({ style: "foodie", startCity: "Edmonton", budgetPerTraveler: 500, budget: 1000, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "P18", input: makeInput({ style: "solo reset", startCity: "Calgary", travelerCount: 1, budgetPerTraveler: 180, budget: 180, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true, includeStaycations: true }) },
    { id: "P19", input: makeInput({ style: "hidden gems", startCity: "Edmonton", budgetPerTraveler: 380, budget: 760, tripLengthDays: 4, maxDriveHours: 5 }) },
    { id: "P20", input: makeInput({ style: "adventure", startCity: "Calgary", budgetPerTraveler: 275, budget: 550, tripLengthDays: 2, maxDriveHours: 3, strictBudget: true, includeStaycations: false }) },
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
  return plan.itineraryDays.reduce(
    (total, day) => total + day.stops.filter((stop) => stop.kind === kind).length,
    0
  );
}

function countKeywords(text: string, keywords: string[]): number {
  return keywords.reduce((total, keyword) => total + (text.includes(keyword) ? 1 : 0), 0);
}

function scoreStyle(plan: TripPlan, style: TripStyle): boolean {
  const text = joinedItineraryText(plan);
  const foodStops = countKind(plan, "food");
  const activityStops = countKind(plan, "activity");
  let score = 0;

  if (style === "foodie") {
    score += foodStops * 2;
    score += countKeywords(text, ["restaurant", "food", "coffee", "cafe", "bakery", "market", "brew"]);
  } else if (style === "adventure" || style === "outdoors") {
    score += activityStops * 2;
    score += countKeywords(text, ["trail", "hike", "lake", "summit", "canyon", "waterfall", "gondola", "park", "viewpoint"]);
  } else if (style === "chill" || style === "solo reset") {
    score += foodStops + activityStops;
    score += countKeywords(text, ["relax", "reset", "light", "scenic", "viewpoint", "cafe", "coffee", "downtime", "low-friction"]);
  } else if (style === "hidden gems") {
    score += activityStops;
    score += countKeywords(text, ["local", "historic", "heritage", "lookout", "scenic", "museum", "trail", "distinctive"]);
  }

  const thresholds: Record<TripStyle, number> = {
    foodie: 6,
    adventure: 5,
    outdoors: 5,
    chill: 4,
    "solo reset": 4,
    "hidden gems": 4,
  };

  return score >= thresholds[style];
}

function budgetPass(plan: TripPlan, input: TripInput): boolean {
  const totalExpected = plan.budgetBreakdown.totalExpected;
  if (input.strictBudget) return totalExpected <= input.budget;
  return totalExpected <= input.budget * 1.15;
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runPlannerTests(): Promise<TestResult[]> {
  return buildPlannerCases().map((testCase) => {
    const winner = rankDestinations(testCase.input, 1)[0];
    const plan = winner ? buildTripPlan(winner, testCase.input, "static-ranking") : null;
    const passed = Boolean(
      winner &&
      plan &&
      plan.itineraryDays.length === testCase.input.tripLengthDays &&
      budgetPass(plan, testCase.input) &&
      scoreStyle(plan, testCase.input.style)
    );

    return {
      id: testCase.id,
      area: "planner",
      passed,
      details: winner
        ? `${winner.name} | budget=${plan?.budgetBreakdown.totalExpected} | days=${plan?.itineraryDays.length}`
        : "No destination matched filters",
    };
  });
}

async function runRouteTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const validInput = makeInput({
    style: "foodie",
    startCity: "Edmonton",
    budgetPerTraveler: 260,
    budget: 520,
    tripLengthDays: 2,
    maxDriveHours: 3.5,
  });
  const topRanked = rankDestinations(validInput, 3);

  const rankInvalid = await rankTripsPost(
    new Request("http://local/api/rank-trips", {
      method: "POST",
      body: JSON.stringify({ input: { startCity: "Nowhere" } }),
      headers: { "Content-Type": "application/json" },
    })
  );
  results.push({
    id: "R21",
    area: "rank-trips",
    passed: rankInvalid.status === 400,
    details: `status=${rankInvalid.status}`,
  });

  const rankValid = await rankTripsPost(
    new Request("http://local/api/rank-trips", {
      method: "POST",
      body: JSON.stringify({ input: validInput }),
      headers: { "Content-Type": "application/json" },
    })
  );
  const rankValidJson = await readJson(rankValid);
  results.push({
    id: "R22",
    area: "rank-trips",
    passed:
      rankValid.status === 200 &&
      rankValidJson.success === true &&
      Array.isArray(rankValidJson.results) &&
      rankValidJson.results.length > 0,
    details: `status=${rankValid.status} results=${rankValidJson.results?.length ?? 0}`,
  });

  const rankExcluded = await rankTripsPost(
    new Request("http://local/api/rank-trips", {
      method: "POST",
      body: JSON.stringify({
        input: validInput,
        excludedDestinationNames: [topRanked[0]?.name],
      }),
      headers: { "Content-Type": "application/json" },
    })
  );
  const rankExcludedJson = await readJson(rankExcluded);
  results.push({
    id: "R23",
    area: "rank-trips",
    passed:
      rankExcluded.status === 200 &&
      Array.isArray(rankExcludedJson.results) &&
      rankExcludedJson.results[0]?.name !== topRanked[0]?.name,
    details: `first=${rankExcludedJson.results?.[0]?.name ?? "none"}`,
  });

  const generateInvalid = await generateTripPost(
    new Request("http://local/api/generate-trip", {
      method: "POST",
      body: JSON.stringify({ foo: "bar" }),
      headers: { "Content-Type": "application/json" },
    })
  );
  results.push({
    id: "R24",
    area: "generate-trip",
    passed: generateInvalid.status === 400,
    details: `status=${generateInvalid.status}`,
  });

  const generateValid = await generateTripPost(
    new Request("http://local/api/generate-trip", {
      method: "POST",
      body: JSON.stringify({ input: validInput, results: topRanked }),
      headers: { "Content-Type": "application/json" },
    })
  );
  const generateValidJson = await readJson(generateValid);
  results.push({
    id: "R25",
    area: "generate-trip",
    passed:
      generateValid.status === 200 &&
      generateValidJson.success === true &&
      generateValidJson.source === "fallback-template" &&
      Array.isArray(generateValidJson.results) &&
      typeof generateValidJson.results[0]?.aiSummary === "string",
    details: `source=${generateValidJson.source} results=${generateValidJson.results?.length ?? 0}`,
  });

  const generateDirect = await generateTripPost(
    new Request("http://local/api/generate-trip", {
      method: "POST",
      body: JSON.stringify(validInput),
      headers: { "Content-Type": "application/json" },
    })
  );
  const generateDirectJson = await readJson(generateDirect);
  results.push({
    id: "R26",
    area: "generate-trip",
    passed:
      generateDirect.status === 200 &&
      generateDirectJson.success === true &&
      Array.isArray(generateDirectJson.results) &&
      generateDirectJson.results.length > 0,
    details: `status=${generateDirect.status} results=${generateDirectJson.results?.length ?? 0}`,
  });

  const enrichMissing = await enrichTripPost(
    new Request("http://local/api/enrich-trip", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    }) as never
  );
  const enrichMissingJson = await readJson(enrichMissing);
  results.push({
    id: "R27",
    area: "enrich-trip",
    passed: enrichMissingJson.success === false,
    details: `success=${enrichMissingJson.success}`,
  });

  const originalFetch = global.fetch;
  global.fetch = (async () => {
    throw new Error("mock network failure");
  }) as typeof fetch;
  const enrichFallback = await enrichTripPost(
    new Request("http://local/api/enrich-trip", {
      method: "POST",
      body: JSON.stringify({ trip: topRanked[0], input: validInput }),
      headers: { "Content-Type": "application/json" },
    }) as never
  );
  const enrichFallbackJson = await readJson(enrichFallback);
  global.fetch = originalFetch;
  results.push({
    id: "R28",
    area: "enrich-trip",
    passed:
      enrichFallback.status === 200 &&
      enrichFallbackJson.success === true &&
      enrichFallbackJson.source === "static-fallback",
    details: `source=${enrichFallbackJson.source}`,
  });

  const osmMissing = await osmRoutePost(
    new Request("http://local/api/osm-route", {
      method: "POST",
      body: JSON.stringify({ origin: null }),
      headers: { "Content-Type": "application/json" },
    }) as never
  );
  results.push({
    id: "R29",
    area: "osm-route",
    passed: osmMissing.status === 400,
    details: `status=${osmMissing.status}`,
  });

  global.fetch = (async (input: string | URL) => {
    const url = String(input);

    if (url.includes("router.project-osrm.org")) {
      return new Response(
        JSON.stringify({
          routes: [
            {
              distance: 12500,
              duration: 900,
              geometry: { type: "LineString", coordinates: [[-113.5, 53.5], [-113.4, 53.6]] },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const osmSuccess = await osmRoutePost(
    new Request("http://local/api/osm-route", {
      method: "POST",
      body: JSON.stringify({
        origin: { lat: 53.5461, lon: -113.4938, label: "Edmonton" },
        destination: { lat: 53.5408, lon: -113.4194, label: "Sherwood Park" },
      }),
      headers: { "Content-Type": "application/json" },
    }) as never
  );
  const osmSuccessJson = await readJson(osmSuccess);
  global.fetch = originalFetch;
  results.push({
    id: "R30",
    area: "osm-route",
    passed:
      osmSuccess.status === 200 &&
      osmSuccessJson.success === true &&
      osmSuccessJson.route?.distanceMeters === 12500,
    details: `distance=${osmSuccessJson.route?.distanceMeters ?? "none"}`,
  });

  const previousMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  const placePhoto = await placePhotoGet(
    new Request("http://local/api/place-photo?ref=abc123")
  );
  const placePhotoJson = await readJson(placePhoto);
  if (previousMapsKey !== undefined) {
    process.env.GOOGLE_MAPS_API_KEY = previousMapsKey;
  }
  results.push({
    id: "R31",
    area: "place-photo",
    passed: placePhoto.status === 500 && placePhotoJson.success === false,
    details: `status=${placePhoto.status}`,
  });

  return results;
}

async function main() {
  const plannerResults = await runPlannerTests();
  const routeResults = await runRouteTests();
  const allResults = [...plannerResults, ...routeResults];

  console.log(`Ran ${allResults.length} site-flow tests.`);
  console.log(`Pass count: ${allResults.filter((result) => result.passed).length}/${allResults.length}`);
  console.log("");

  for (const result of allResults) {
    console.log(`${result.passed ? "PASS" : "FAIL"} | ${result.id} | ${result.area} | ${result.details}`);
  }

  const failed = allResults.filter((result) => !result.passed);
  console.log("");
  if (failed.length === 0) {
    console.log("No failing cases.");
    return;
  }

  console.log("Failing cases summary:");
  for (const result of failed) {
    console.log(`${result.id}: ${result.area} -> ${result.details}`);
  }
}

void main();
