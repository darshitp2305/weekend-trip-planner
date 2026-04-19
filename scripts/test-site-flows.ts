import { loadEnvConfig } from "@next/env";
import { POST as enrichTripPost } from "../app/api/enrich-trip/route";
import { POST as generateTripPost } from "../app/api/generate-trip/route";
import { POST as osmRoutePost } from "../app/api/osm-route/route";
import { GET as placePhotoGet } from "../app/api/place-photo/route";
import { POST as rankTripsPost } from "../app/api/rank-trips/route";
import { buildTripPlan } from "../lib/buildTripPlan";
import destinationCatalog from "../lib/destinationCatalog";
import {
  buildActivityTextQuery,
  buildRestaurantTextQuery,
} from "../lib/googlePlaces";
import { recalculateConfidence } from "../lib/generateRankedTrips";
import { mapRawDestination } from "../lib/mapDestination";
import { rankDestinations } from "../lib/rankDestinations";
import { deriveTripEndDate } from "../lib/tripDates";
import {
  optimizeSelectionForBudget,
  pickDefaultActivityForStop,
} from "../lib/tripSelections";
import {
  DriveTimeConfidence,
  DriveTimeSource,
  RankedDestination,
  TripInput,
  TripPlan,
  TripStyle,
} from "../lib/types";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptTravelerCount,
} from "../lib/tripIntent";
import { RawDestination } from "../lib/types";

loadEnvConfig(process.cwd());

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
    activityFocus: partial.activityFocus,
    tripPrompt: partial.tripPrompt,
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
    { id: "P21", input: makeInput({ style: "foodie", startCity: "Toronto", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P22", input: makeInput({ style: "adventure", startCity: "Vancouver", budgetPerTraveler: 550, budget: 1100, tripLengthDays: 3, maxDriveHours: 3, includeStaycations: false }) },
    { id: "P23", input: makeInput({ style: "chill", startCity: "Montreal", budgetPerTraveler: 280, budget: 560, tripLengthDays: 2, maxDriveHours: 3.5 }) },
    { id: "P24", input: makeInput({ style: "foodie", startCity: "Ottawa", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 1.5, strictBudget: true }) },
    { id: "P25", input: makeInput({ style: "chill", startCity: "Kelowna", budgetPerTraveler: 250, budget: 500, tripLengthDays: 2, maxDriveHours: 2.5 }) },
    { id: "P26", input: makeInput({ style: "chill", startCity: "Victoria", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P27", input: makeInput({ style: "outdoors", startCity: "Winnipeg", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 4, includeStaycations: false }) },
    { id: "P28", input: makeInput({ style: "outdoors", startCity: "Saskatoon", budgetPerTraveler: 280, budget: 560, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
    { id: "P29", input: makeInput({ style: "outdoors", startCity: "Saint John", budgetPerTraveler: 280, budget: 560, tripLengthDays: 2, maxDriveHours: 3.5, includeStaycations: false }) },
    { id: "P30", input: makeInput({ style: "chill", startCity: "St. John's", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P31", input: makeInput({ style: "foodie", startCity: "Gatineau", budgetPerTraveler: 220, budget: 440, tripLengthDays: 2, maxDriveHours: 1.5, strictBudget: true }) },
    { id: "P32", input: makeInput({ style: "foodie", startCity: "Laval", budgetPerTraveler: 250, budget: 500, tripLengthDays: 2, maxDriveHours: 1.5, strictBudget: true }) },
    { id: "P33", input: makeInput({ style: "chill", startCity: "Charlottetown", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true }) },
    { id: "P34", input: makeInput({ style: "outdoors", startCity: "Corner Brook", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 3, includeStaycations: false }) },
    { id: "P35", input: makeInput({ style: "foodie", startCity: "Regina", budgetPerTraveler: 220, budget: 440, tripLengthDays: 2, maxDriveHours: 1.5, strictBudget: true }) },
    { id: "P36", input: makeInput({ style: "chill", startCity: "Prince George", budgetPerTraveler: 220, budget: 440, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true }) },
    { id: "P37", input: makeInput({ style: "chill", startCity: "Whitehorse", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P38", input: makeInput({ style: "outdoors", startCity: "Whitehorse", budgetPerTraveler: 300, budget: 600, tripLengthDays: 2, maxDriveHours: 2.5, includeStaycations: false }) },
    { id: "P39", input: makeInput({ style: "chill", startCity: "Yellowknife", budgetPerTraveler: 280, budget: 560, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true }) },
    { id: "P40", input: makeInput({ style: "chill", startCity: "Iqaluit", budgetPerTraveler: 350, budget: 700, tripLengthDays: 2, maxDriveHours: 2, strictBudget: true }) },
    { id: "P41", input: makeInput({ style: "chill", startCity: "Kamloops", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 2.5 }) },
    { id: "P42", input: makeInput({ style: "chill", startCity: "Nanaimo", budgetPerTraveler: 240, budget: 480, tripLengthDays: 2, maxDriveHours: 2.5, strictBudget: true }) },
    { id: "P43", input: makeInput({ style: "adventure", startCity: "Vancouver", budgetPerTraveler: 1000, budget: 4000, travelerCount: 4, tripLengthDays: 4, maxDriveHours: 4, preferredDestination: "Vancouver Island", includeStaycations: false, season: "spring" }) },
    { id: "P44", input: makeInput({ style: "adventure", startCity: "Vancouver", budgetPerTraveler: 500, budget: 1000, tripLengthDays: 3, maxDriveHours: 6, preferredDestination: "Tofino / Ucluelet", includeStaycations: false, season: "summer" }) },
    { id: "P45", input: makeInput({ style: "chill", startCity: "Toronto", budgetPerTraveler: 320, budget: 640, tripLengthDays: 2, maxDriveHours: 3, preferredDestination: "Blue Mountains / Collingwood", season: "fall" }) },
    { id: "P46", input: makeInput({ style: "outdoors", startCity: "Montreal", budgetPerTraveler: 420, budget: 840, tripLengthDays: 3, maxDriveHours: 3, preferredDestination: "Mont-Tremblant", includeStaycations: false, season: "summer" }) },
    { id: "P47", input: makeInput({ style: "chill", startCity: "Winnipeg", budgetPerTraveler: 220, budget: 440, tripLengthDays: 2, maxDriveHours: 2.5, preferredDestination: "Gimli / Lake Winnipeg", strictBudget: true, season: "summer" }) },
    { id: "P48", input: makeInput({ style: "chill", startCity: "Saint John", budgetPerTraveler: 260, budget: 520, tripLengthDays: 2, maxDriveHours: 2, preferredDestination: "St. Andrews-by-the-Sea", season: "summer" }) },
    { id: "P49", input: makeInput({ style: "foodie", startCity: "Halifax", budgetPerTraveler: 320, budget: 640, tripLengthDays: 2, maxDriveHours: 2, preferredDestination: "Wolfville / Annapolis Valley", season: "summer" }) },
    { id: "P50", input: makeInput({ style: "outdoors", startCity: "St. John's", budgetPerTraveler: 360, budget: 720, tripLengthDays: 3, maxDriveHours: 4, preferredDestination: "Bonavista Peninsula", includeStaycations: false, season: "summer" }) },
    { id: "P51", input: makeInput({ style: "hidden gems", startCity: "Whitehorse", budgetPerTraveler: 340, budget: 680, tripLengthDays: 3, maxDriveHours: 6, preferredDestination: "Dawson City", includeStaycations: false, season: "summer" }) },
    { id: "P52", input: makeInput({ style: "outdoors", startCity: "Yellowknife", budgetPerTraveler: 300, budget: 600, tripLengthDays: 2, maxDriveHours: 1.5, preferredDestination: "Ingraham Trail / Prelude Lake", includeStaycations: false, season: "summer" }) },
    { id: "P53", input: makeInput({ style: "chill", startCity: "Iqaluit", budgetPerTraveler: 450, budget: 900, tripLengthDays: 2, maxDriveHours: 1, preferredDestination: "Sylvia Grinnell / Apex", includeStaycations: false, season: "summer" }) },
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
    "must see": 5,
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
      (!testCase.input.preferredDestination ||
        winner.name
          .toLowerCase()
          .includes(testCase.input.preferredDestination.toLowerCase())) &&
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

async function runDriveFallbackTests(): Promise<TestResult[]> {
  const catalog = destinationCatalog as RawDestination[];
  const checks = [
    {
      id: "D01",
      input: makeInput({ style: "adventure", startCity: "Winnipeg", maxDriveHours: 20 }),
      destinationId: "banff_ab",
      expectedDriveTimeSource: "estimated_coordinates" as DriveTimeSource,
      expectedDriveTimeConfidence: "low" as DriveTimeConfidence,
    },
    {
      id: "D02",
      input: makeInput({ style: "outdoors", startCity: "Vancouver", maxDriveHours: 20 }),
      destinationId: "jasper_ab",
      expectedDriveTimeSource: "estimated_coordinates" as DriveTimeSource,
      expectedDriveTimeConfidence: "low" as DriveTimeConfidence,
    },
    {
      id: "D03",
      input: makeInput({ style: "chill", startCity: "Toronto", maxDriveHours: 20 }),
      destinationId: "waterton_lakes_ab",
      expectedDriveTimeSource: "estimated_coordinates" as DriveTimeSource,
      expectedDriveTimeConfidence: "low" as DriveTimeConfidence,
    },
    {
      id: "D04",
      input: makeInput({ style: "chill", startCity: "Calgary", maxDriveHours: 8 }),
      destinationId: "banff_ab",
      expectedDriveTimeSource: "catalog_exact" as DriveTimeSource,
      expectedDriveTimeConfidence: "high" as DriveTimeConfidence,
    },
    {
      id: "D05",
      input: makeInput({ style: "outdoors", startCity: "St. Albert", maxDriveHours: 8 }),
      destinationId: "jasper_ab",
      expectedDriveTimeSource: "catalog_hub" as DriveTimeSource,
      expectedDriveTimeConfidence: "medium" as DriveTimeConfidence,
    },
  ];

  return checks.map((check) => {
    const rawDestination = catalog.find((destination) => destination.id === check.destinationId);
    const mapped = rawDestination ? mapRawDestination(rawDestination, check.input) : null;
    const passed = Boolean(
      mapped &&
        mapped.driveHoursFromStart < 999 &&
        mapped.driveTimeSource === check.expectedDriveTimeSource &&
        mapped.driveTimeConfidence === check.expectedDriveTimeConfidence
    );

    return {
      id: check.id,
      area: "drive-fallback",
      passed,
      details: mapped
        ? `${mapped.name} | start=${check.input.startCity} | driveHours=${mapped.driveHoursFromStart} | source=${mapped.driveTimeSource ?? "missing"} | confidence=${mapped.driveTimeConfidence ?? "missing"}`
        : `Missing destination ${check.destinationId}`,
    };
  });
}

async function runPromptInterpretationTests(): Promise<TestResult[]> {
  const prompt =
    "I want to go on a hike that takes me to the top of a mountain. The hike should be about 15km long for the round trip, and there should be a nice view at the top. I also want to eat good food, and I'm a vegetarian, but my friends are not. Budget of $600 each.";
  const intent = deriveTripIntentFromPrompt(prompt);
  const activityQuery = buildActivityTextQuery("Canmore, Alberta", "outdoors", {
    activityFocus: intent.activityFocus,
    hardConstraints: intent.hardConstraints,
    softPreferences: intent.softPreferences,
  });
  const restaurantQuery = buildRestaurantTextQuery("Canmore, Alberta", {
    veganFriendly: intent.veganFriendly,
    requiresVegetarianOptions: intent.hardConstraints.requiresVegetarianOptions,
    mixedDietGroup: intent.hardConstraints.mixedDietGroup,
    wantsGoodFood: intent.softPreferences.wantsGoodFood,
  });
  const recoveryPrompt =
    "I want to go on a hiking trip to the top of a mountain with scenic views. The hike should be 15km long, round-trip. On the other days I just want to relax and eat good food, I'm a vegetarian, but my friends are not. Our budget is $400 per person.";
  const recoveryIntent = deriveTripIntentFromPrompt(recoveryPrompt);
  const mountainPrompt =
    "I want to go on a hike up a mountain with my friends. It should have a scenic view at the top and be about 15km long.";
  const mountainIntent = deriveTripIntentFromPrompt(mountainPrompt);
  const chillMountainPrompt =
    "I want to go on a hike up a mountain with my friends, and there should be scenic views at the top of the hike. On the other days I just want to chill and eat good food. I'm a vegetarian, but my friends are not. The budget for this trip is $400 each.";
  const chillMountainIntent = deriveTripIntentFromPrompt(chillMountainPrompt);
  const totalBudgetPrompt =
    "We want a weekend in Canmore. Our total budget is $600 for the trip, and there are 2 of us.";
  const totalBudgetMatch = extractPromptBudget(totalBudgetPrompt);
  const totalBudgetTravelerCount = extractPromptTravelerCount(totalBudgetPrompt);
  const fourTravelerPrompt =
    "We are 4 people and our total budget is $600. We want one real summit hike and vegetarian-friendly food.";
  const fourTravelerIntent = deriveTripIntentFromPrompt(fourTravelerPrompt);
  const fourTravelerBudgetMatch = extractPromptBudget(fourTravelerPrompt);
  const fourTravelerPromptDerivedBudgetPerTraveler =
    fourTravelerBudgetMatch?.scope === "group_total" &&
    typeof fourTravelerIntent.suggestedTravelerCount === "number"
      ? Math.round(
          fourTravelerBudgetMatch.amount / fourTravelerIntent.suggestedTravelerCount
        )
      : null;
  const recoveryInput = makeInput({
    style: "outdoors",
    activityFocus: "hiking",
    tripLengthDays: 3,
    budgetPerTraveler: 400,
    budget: 1600,
    maxDriveHours: 5,
    tripPrompt: recoveryPrompt,
  });
  const recoveryFixture: RankedDestination = {
    name: "Canmore",
    province: "Alberta",
    driveHoursFromStart: 4,
    bestSeasons: ["Spring", "Summer", "Fall"],
    avoidSeasons: [],
    tripStyles: ["outdoors", "adventure", "foodie"],
    styleScores: {
      chill: 1,
      outdoors: 3,
      foodie: 2,
      "solo reset": 1,
      adventure: 3,
    },
    budgetLevel: "medium",
    veganFriendly: true,
    summary: "Mountain base with a clear summit-hike anchor and strong food options.",
    homeBaseCity: "Canmore",
    rawVibes: ["Nature", "Food", "Adventure"],
    isStaycation: false,
    latitude: 51.089,
    longitude: -115.359,
    imageUrl: "",
    topActivities: [
      {
        name: "Ha Ling Peak Trailhead",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.8,
        shortDescription: "Summit hike with mountain views and a strong scenic payoff.",
        latitude: 51.06,
        longitude: -115.39,
      },
      {
        name: "Grassi Lakes Trailhead",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.7,
        shortDescription: "Scenic lakes trail with a gentler pace.",
        latitude: 51.08,
        longitude: -115.42,
      },
      {
        name: "Riverside Trail",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.6,
        shortDescription: "Easy river walk for a lighter final morning.",
        latitude: 51.091,
        longitude: -115.352,
      },
    ],
    hotelOptions: [
      {
        name: "Spring Creek Vacations",
        bookingLink: "",
        shortDescription: "Stay close to both downtown meals and trail access.",
        pricePerNight: 285,
        totalStayPrice: 570,
        rating: 4.7,
        latitude: 51.091,
        longitude: -115.358,
      },
    ],
    foodSpots: [
      {
        name: "Harvest Cafe",
        tags: ["cafe", "vegetarian", "brunch"],
        category: "Cafe",
        estimatedCost: 58,
        rating: 4.4,
        latitude: 51.092,
        longitude: -115.357,
      },
      {
        name: "Wild Orchid Bistro",
        tags: ["restaurant", "asian", "fusion", "vegetarian"],
        category: "Restaurant",
        estimatedCost: 120,
        rating: 4.5,
        latitude: 51.089,
        longitude: -115.35,
      },
      {
        name: "The Local - Eatery & Bar",
        tags: ["restaurant", "vegetarian", "shared plates"],
        category: "Restaurant",
        estimatedCost: 102,
        rating: 4.5,
        latitude: 51.088,
        longitude: -115.353,
      },
    ],
    score: 145,
    estimatedCost: 1160,
    budgetBreakdown: {
      hotel: 570,
      food: 420,
      gas: 65,
      activities: 0,
      misc: 77,
      total: 1132,
      totalExpected: 1132,
      totalLow: 1019,
      totalHigh: 1302,
    },
    matchReasons: [],
    warnings: [],
    styleMatchStrength: "strong",
    confidence: "high",
    rankingReasons: [],
  };
  const recoveryPlan = buildTripPlan(
    recoveryFixture,
    recoveryInput,
    "static-ranking"
  );
  const strictSummitBudgetPrompt =
    "I want to go on a hike with my friends up a mountain, where there should be scenic views from the top, and the hike should be about 15km long. On the other days I want to relax and eat good food. I'm a vegetarian, but my friends are not. Our total budget is $600 for the trip.";
  const strictSummitBudgetInput = makeInput({
    style: "outdoors",
    activityFocus: "hiking",
    travelerCount: 4,
    budgetPerTraveler: 150,
    budget: 600,
    tripLengthDays: 2,
    maxDriveHours: 5,
    veganFriendly: true,
    tripPrompt: strictSummitBudgetPrompt,
  });
  const strictSummitBudgetTopResult = rankDestinations(strictSummitBudgetInput, 1)[0];
  const strictSummitBudgetPlan = strictSummitBudgetTopResult
    ? buildTripPlan(strictSummitBudgetTopResult, strictSummitBudgetInput, "static-ranking")
    : null;
  const jasperSkiRankingPrompt =
    "Plan a 3-day ski trip in Jasper for 4 people starting from Edmonton on April 3, 2026. Keep day 1 easy because of the drive, make day 2 a full ski day, and keep skiing on the morning of day 3 before heading back.";
  const jasperSkiRankingInput = makeInput({
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
    tripPrompt: jasperSkiRankingPrompt,
  });
  const jasperSkiTopResult = rankDestinations(jasperSkiRankingInput, 1)[0];
  const jasperSkiActivityTitles =
    jasperSkiTopResult?.topActivities.map((activity) => activity.name.toLowerCase()) ?? [];
  const requestedAnchorInput = makeInput({
    style: "chill",
    startCity: "Calgary",
    travelerCount: 2,
    budgetPerTraveler: 300,
    budget: 600,
    tripLengthDays: 2,
    maxDriveHours: 5,
    preferredDestination: "Banff",
    tripPrompt:
      "We're 2 people in Calgary and want a Banff overnight with one scenic hike as the main activity. Make Johnston Canyon the signature hike, keep the rest of the trip easy, and suggest a cozy trip with minimal planning friction.",
  });
  const requestedAnchorTopResult = rankDestinations(requestedAnchorInput, 1)[0];
  const requestedAnchorTitles =
    requestedAnchorTopResult?.topActivities.map((activity) => activity.name) ?? [];
  const johnstonIndex = requestedAnchorTitles.findIndex((title) =>
    /johnston canyon/i.test(title)
  );
  const weakConfidenceCandidate = requestedAnchorTopResult
    ? recalculateConfidence(
        [
          {
            ...requestedAnchorTopResult,
            confidence: "high",
            foodSpots: [
              {
                name: "Grab & Go - Banff",
                tags: [],
                category: "Restaurant",
                rating: 4.8,
              },
            ],
            topActivities: [
              {
                name: "One Mile Lake Park",
                type: "Park",
                costEstimate: 0,
                rating: 4.8,
              },
            ],
          },
        ],
        {
          ...requestedAnchorInput,
          style: "outdoors",
          tripPrompt:
            "Plan a 2-day outdoors trip to Banff from Calgary for 2 travelers with one scenic hike and good coffee.",
        }
      )[0]
    : undefined;
  const nearbyBanffDefaultActivity = pickDefaultActivityForStop(
    {
      title: "Pick an activity",
      description: "Choose one nearby scenic hike for the first day.",
      kind: "activity",
    },
    [
      {
        name: "Mistaya Canyon Trail Head - Banff",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.8,
        latitude: 51.7427,
        longitude: -116.4333,
      },
      {
        name: "Johnston Canyon",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.7,
        latitude: 51.2447,
        longitude: -115.8397,
      },
      {
        name: "Sulphur Mountain Gondola",
        type: "Viewpoint",
        costEstimate: 0,
        rating: 4.6,
        latitude: 51.1474,
        longitude: -115.5733,
      },
    ],
    {
      day: {
        title: "Arrival and easy first day",
        summary: "Keep the first afternoon simple and nearby after the drive.",
      },
      tripPrompt:
        'Plan a 2-day Banff trip from Calgary for 4 travelers. I want one scenic nearby hike and a real overnight stay in Banff.',
      hotelName: "Tunnel Mountain area stay",
      hotels: [
        {
          name: "Tunnel Mountain area stay",
          bookingLink: "https://example.com/stay",
          latitude: 51.1765,
          longitude: -115.5481,
        },
      ],
      fallbackCenter: {
        latitude: 51.1784,
        longitude: -115.5708,
      },
    }
  );
  const optimizedNearbyBanffSelection = optimizeSelectionForBudget({
    tripLengthDays: 2,
    travelerCount: 4,
    targetTotalBudget: 1400,
    hotelOptions: [
      {
        name: "Tunnel Mountain area stay",
        bookingLink: "https://example.com/stay",
      },
    ],
    foodSpots: [],
    activities: [
      {
        name: "Mistaya Canyon Trail Head - Banff",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.8,
        latitude: 51.7427,
        longitude: -116.4333,
      },
      {
        name: "Johnston Canyon",
        type: "Hiking Area",
        costEstimate: 0,
        rating: 4.7,
        latitude: 51.2447,
        longitude: -115.8397,
      },
      {
        name: "Sulphur Mountain Gondola",
        type: "Viewpoint",
        costEstimate: 0,
        rating: 4.6,
        latitude: 51.1474,
        longitude: -115.5733,
      },
    ],
    itineraryDays: [
      {
        title: "Arrival and easy first day",
        summary: "Because the drive is short, day one can include one real stop without making the trip feel rushed.",
        stops: [
          {
            title: "Drive from Calgary to Banff",
            kind: "travel",
          },
          {
            title: "Pick where to stay",
            kind: "stay",
          },
          {
            title: "Pick an activity",
            description: "Choose one nearby scenic hike for the first day.",
            kind: "activity",
          },
        ],
      },
    ],
    tripPrompt:
      "Plan a 2-day Banff trip from Calgary for 4 travelers. I want one scenic nearby hike and a real overnight stay in Banff. Keep day 1 easy after the drive.",
    fallbackCenter: {
      latitude: 51.1784,
      longitude: -115.5708,
    },
  });
  const recoveryActivityCounts = recoveryPlan
    ? recoveryPlan.itineraryDays.map(
        (day) => day.stops.filter((stop) => stop.kind === "activity").length
      )
    : [];
  const dayTwoActivityTitles = recoveryPlan
    ? recoveryPlan.itineraryDays[1]?.stops
        .filter((stop) => stop.kind === "activity")
        .map((stop) => stop.title.toLowerCase()) ?? []
    : [];

  return [
    {
      id: "I21",
      area: "prompt-intent",
      passed:
        intent.activityFocus === "hiking" &&
        intent.hardConstraints.activityAnchor === "summit_hike" &&
        intent.hardConstraints.hikeDistanceKmTarget === 15 &&
        intent.hardConstraints.requiresScenicView === true &&
        intent.hardConstraints.requiresVegetarianOptions === true &&
        intent.hardConstraints.mixedDietGroup === true &&
        intent.softPreferences.wantsGoodFood === true &&
        intent.suggestedBudgetPerTraveler === 600,
      details: JSON.stringify({
        activityFocus: intent.activityFocus,
        hardConstraints: intent.hardConstraints,
        softPreferences: intent.softPreferences,
        suggestedBudgetPerTraveler: intent.suggestedBudgetPerTraveler,
      }),
    },
    {
      id: "I22",
      area: "prompt-query",
      passed:
        activityQuery.toLowerCase().includes("summit") &&
        activityQuery.toLowerCase().includes("15 km") &&
        activityQuery.toLowerCase().includes("view"),
      details: activityQuery,
    },
    {
      id: "I23",
      area: "food-query",
      passed:
        restaurantQuery.toLowerCase().includes("vegetarian-friendly") &&
        restaurantQuery.toLowerCase().includes("mixed groups"),
      details: restaurantQuery,
    },
    {
      id: "I24",
      area: "prompt-intent",
      passed:
        recoveryIntent.hardConstraints.activityAnchor === "summit_hike" &&
        recoveryIntent.softPreferences.wantsRecoveryDays === true,
      details: JSON.stringify(recoveryIntent.softPreferences),
    },
    {
      id: "I25",
      area: "prompt-intent",
      passed:
        mountainIntent.activityFocus === "hiking" &&
        mountainIntent.hardConstraints.activityAnchor === "summit_hike" &&
        mountainIntent.hardConstraints.requiresScenicView === true &&
        mountainIntent.hardConstraints.hikeDistanceKmTarget === 15,
      details: JSON.stringify(mountainIntent.hardConstraints),
    },
    {
      id: "I26",
      area: "prompt-budget",
      passed:
        totalBudgetMatch?.scope === "group_total" &&
        totalBudgetMatch?.amount === 600 &&
        totalBudgetMatch?.approximate === false &&
        totalBudgetTravelerCount === 2,
      details: JSON.stringify({
        budget: totalBudgetMatch,
        travelerCount: totalBudgetTravelerCount,
      }),
    },
    {
      id: "I27",
      area: "prompt-intent",
      passed:
        chillMountainIntent.activityFocus === "hiking" &&
        chillMountainIntent.hardConstraints.activityAnchor === "summit_hike" &&
        chillMountainIntent.hardConstraints.requiresScenicView === true &&
        chillMountainIntent.softPreferences.wantsRecoveryDays === true &&
        chillMountainIntent.softPreferences.wantsGoodFood === true &&
        chillMountainIntent.suggestedBudgetPerTraveler === 400,
      details: JSON.stringify({
        activityFocus: chillMountainIntent.activityFocus,
        hardConstraints: chillMountainIntent.hardConstraints,
        softPreferences: chillMountainIntent.softPreferences,
        suggestedBudgetPerTraveler: chillMountainIntent.suggestedBudgetPerTraveler,
      }),
    },
    {
      id: "I31",
      area: "prompt-travelers",
      passed:
        fourTravelerIntent.suggestedTravelerCount === 4 &&
        fourTravelerBudgetMatch?.scope === "group_total" &&
        fourTravelerBudgetMatch.amount === 600 &&
        fourTravelerPromptDerivedBudgetPerTraveler === 150,
      details: JSON.stringify({
        suggestedTravelerCount: fourTravelerIntent.suggestedTravelerCount,
        budgetMatch: fourTravelerBudgetMatch,
        promptDerivedBudgetPerTraveler: fourTravelerPromptDerivedBudgetPerTraveler,
      }),
    },
    {
      id: "I28",
      area: "builder-shape",
      passed:
        Boolean(recoveryPlan) &&
        !/trailhead/i.test(recoveryPlan?.title ?? "") &&
        recoveryActivityCounts[0] === 0 &&
        (recoveryActivityCounts[1] ?? 0) <= 1 &&
        (recoveryActivityCounts[2] ?? 0) <= 1 &&
        dayTwoActivityTitles.some((title) =>
          /ha ling|summit|peak|ridge|table mountain/i.test(title)
        ),
      details: recoveryPlan
        ? JSON.stringify({
            title: recoveryPlan.title,
            activityCounts: recoveryActivityCounts,
            dayTwoActivityTitles,
          })
        : "No recovery-hike plan built",
    },
    {
      id: "I29",
      area: "ranked-summit-filter",
      passed:
        !/elk island|hayburger/i.test(strictSummitBudgetTopResult?.name ?? "") &&
        (
          !strictSummitBudgetTopResult ||
          /ha ling|canmore|banff|kananaskis|jasper|grande cache|crowsnest/i.test(
            [
              strictSummitBudgetTopResult.name,
              strictSummitBudgetTopResult.summary,
              strictSummitBudgetTopResult.homeBaseCity,
            ]
              .filter(Boolean)
              .join(" ")
          )
        ),
      details: strictSummitBudgetTopResult
        ? JSON.stringify({
            name: strictSummitBudgetTopResult.name,
            homeBaseCity: strictSummitBudgetTopResult.homeBaseCity,
            summary: strictSummitBudgetTopResult.summary,
          })
        : "No ranked summit result, which is acceptable if no mountain match fits",
    },
    {
      id: "I30",
      area: "summit-title-quality",
      passed:
        !strictSummitBudgetPlan ||
        !/^lookout point$/i.test(strictSummitBudgetPlan.title ?? "") ||
        /crowsnest|blairmore|coleman|table mountain|ha ling|peak|summit/i.test(
          [
            strictSummitBudgetPlan.title,
            strictSummitBudgetPlan.destinationName,
            strictSummitBudgetTopResult?.homeBaseCity,
          ]
            .filter(Boolean)
            .join(" ")
        ),
      details: strictSummitBudgetPlan
        ? JSON.stringify({
            title: strictSummitBudgetPlan.title,
            destinationName: strictSummitBudgetPlan.destinationName,
            homeBaseCity: strictSummitBudgetTopResult?.homeBaseCity,
          })
        : "No summit plan built, which is acceptable if no match fits",
    },
    {
      id: "I32",
      area: "ranking-catalog",
      passed:
        (jasperSkiTopResult?.name ?? "").toLowerCase().includes("jasper") &&
        !jasperSkiActivityTitles.some((title) => title.includes("food crawl")),
      details: JSON.stringify({
        name: jasperSkiTopResult?.name,
        topActivities: jasperSkiTopResult?.topActivities.map((activity) => activity.name),
      }),
    },
    {
      id: "I33",
      area: "ranking-catalog",
      passed:
        (requestedAnchorTopResult?.name ?? "").toLowerCase().includes("banff") &&
        johnstonIndex !== -1 &&
        johnstonIndex <= 1,
      details: JSON.stringify({
        name: requestedAnchorTopResult?.name,
        topActivities: requestedAnchorTitles,
      }),
    },
    {
      id: "I34",
      area: "selection-defaults",
      passed: nearbyBanffDefaultActivity?.name === "Johnston Canyon",
      details: JSON.stringify({
        selectedActivity: nearbyBanffDefaultActivity?.name,
      }),
    },
    {
      id: "I35",
      area: "saved-selection-defaults",
      passed:
        optimizedNearbyBanffSelection.optimizedSelection.activities["day-0-stop-2"] ===
        "Johnston Canyon",
      details: JSON.stringify({
        selectedActivity:
          optimizedNearbyBanffSelection.optimizedSelection.activities["day-0-stop-2"],
      }),
    },
    {
      id: "I36",
      area: "confidence-guardrails",
      passed:
        weakConfidenceCandidate?.confidence === "medium" ||
        weakConfidenceCandidate?.confidence === "low",
      details: JSON.stringify({
        confidence: weakConfidenceCandidate?.confidence,
        activities: weakConfidenceCandidate?.topActivities?.map((activity) => activity.name),
        foodSpots: weakConfidenceCandidate?.foodSpots?.map((food) => food.name),
      }),
    },
  ];
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

  const previousDynamicMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = previousDynamicMapsKey || "test-maps-key";
  const dynamicInput = makeInput({
    style: "outdoors",
    startCity: "Vancouver",
    preferredDestination: "Pemberton",
    budgetPerTraveler: 500,
    budget: 1000,
    tripLengthDays: 3,
    maxDriveHours: 3,
    tripPrompt:
      "Plan a 3-day outdoors trip to Pemberton from Vancouver for 2 travelers with one scenic hike, good coffee, and a budget of $500 per traveler.",
  });
  global.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("places.googleapis.com")) {
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const textQuery = String(body.textQuery ?? "");

      if (textQuery.includes("Pemberton, Canada")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Pemberton" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3201, longitude: -122.8057 },
                primaryType: "locality",
                rating: 4.6,
                userRatingCount: 820,
                googleMapsUri: "https://maps.google.com/?q=Pemberton",
                photos: [{ name: "places/pemberton/photos/main" }],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (textQuery.toLowerCase().includes("top trails, lakes, parks, scenic lookouts")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Pemberton Visitor Centre" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3211, longitude: -122.8058 },
                primaryType: "tourist_information_center",
                rating: 4.2,
                userRatingCount: 85,
              },
              {
                displayName: { text: "Downtown Pemberton Plaza" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3207, longitude: -122.8053 },
                primaryType: "shopping_mall",
                rating: 4.1,
                userRatingCount: 51,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        textQuery.toLowerCase().includes("scenic hike") ||
        textQuery.toLowerCase().includes("waterfall") ||
        textQuery.toLowerCase().includes("mountain lookout") ||
        textQuery.toLowerCase().includes("lake trail") ||
        textQuery.toLowerCase().includes("scenic viewpoint")
      ) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Nairn Falls Trail" },
                formattedAddress: "Nairn Falls Provincial Park, BC, Canada",
                location: { latitude: 50.3395, longitude: -122.7759 },
                primaryType: "hiking_area",
                rating: 4.8,
                userRatingCount: 560,
              },
              {
                displayName: { text: "One Mile Lake Trail" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3165, longitude: -122.8012 },
                primaryType: "park",
                rating: 4.7,
                userRatingCount: 420,
              },
              {
                displayName: { text: "Joffre Lakes Viewpoint" },
                formattedAddress: "Joffre Lakes Provincial Park, BC, Canada",
                location: { latitude: 50.3723, longitude: -122.4931 },
                primaryType: "tourist_attraction",
                rating: 4.9,
                userRatingCount: 2100,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (textQuery.toLowerCase().includes("restaurant")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Mile One Eating House" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.321, longitude: -122.806 },
                primaryType: "restaurant",
                rating: 4.5,
                userRatingCount: 240,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (textQuery.toLowerCase().includes("cafe")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Mount Currie Coffee Co." },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3204, longitude: -122.8049 },
                primaryType: "cafe",
                rating: 4.4,
                userRatingCount: 180,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (textQuery.toLowerCase().includes("hotel")) {
        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "Pemberton Valley Lodge" },
                formattedAddress: "Pemberton, BC, Canada",
                location: { latitude: 50.3178, longitude: -122.8051 },
                primaryType: "lodging",
                rating: 4.3,
                userRatingCount: 310,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ places: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unexpected network call: ${url}`);
  }) as typeof fetch;
  const dynamicRank = await rankTripsPost(
    new Request("http://local/api/rank-trips", {
      method: "POST",
      body: JSON.stringify({
        input: dynamicInput,
      }),
      headers: { "Content-Type": "application/json" },
    })
  );
  const dynamicRankJson = await readJson(dynamicRank);
  const dynamicWinner = dynamicRankJson.results?.[0];
  const dynamicPlan = dynamicWinner
    ? buildTripPlan(dynamicWinner, dynamicInput, "live-google-places")
    : null;
  const dynamicDayTwoActivityTitles =
    dynamicPlan?.itineraryDays?.[1]?.stops
      .filter((stop) => stop.kind === "activity")
      .map((stop) => stop.title.toLowerCase()) ?? [];
  global.fetch = originalFetch;
  if (previousDynamicMapsKey === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = previousDynamicMapsKey;
  }
  results.push({
    id: "R32",
    area: "dynamic-geography",
    passed:
      dynamicRank.status === 200 &&
      dynamicRankJson.success === true &&
      Array.isArray(dynamicRankJson.results) &&
      dynamicWinner?.name === "Pemberton" &&
      dynamicWinner?.topActivities?.some((activity: { name?: string }) =>
        /nairn falls|one mile lake|joffre lakes/i.test(activity?.name ?? "")
      ),
    details: `status=${dynamicRank.status} winner=${dynamicWinner?.name ?? "none"}`,
  });
  results.push({
    id: "R33",
    area: "dynamic-itinerary",
    passed:
      Boolean(dynamicPlan) &&
      countKind(dynamicPlan!, "activity") >= 2 &&
      dynamicDayTwoActivityTitles.length >= 1 &&
      dynamicDayTwoActivityTitles.some((title) =>
        /nairn falls|one mile lake|joffre lakes/i.test(title)
      ),
    details: dynamicPlan
      ? JSON.stringify({
          activityCount: countKind(dynamicPlan, "activity"),
          dayTwoActivityTitles: dynamicDayTwoActivityTitles,
        })
      : "No dynamic plan built",
  });

  return results;
}

async function main() {
  const plannerResults = await runPlannerTests();
  const driveFallbackResults = await runDriveFallbackTests();
  const promptInterpretationResults = await runPromptInterpretationTests();
  const routeResults = await runRouteTests();
  const allResults = [
    ...plannerResults,
    ...driveFallbackResults,
    ...promptInterpretationResults,
    ...routeResults,
  ];

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
