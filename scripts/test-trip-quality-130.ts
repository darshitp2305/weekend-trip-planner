import { loadEnvConfig } from "@next/env";
import { buildTripPlan } from "../lib/buildTripPlan";
import { rankDestinations } from "../lib/rankDestinations";
import { deriveTripEndDate } from "../lib/tripDates";
import type { StartCity } from "../lib/startCities";
import type { ItineraryStop, TripInput, TripPlan, TripStyle } from "../lib/types";

loadEnvConfig(process.cwd());

type QualityExpectation = {
  minFoodStops?: number;
  minActivityStops?: number;
  requiresCoffee?: boolean;
  requiresDinner?: boolean;
  requiresScenic?: boolean;
  requiresHeritageOrCulture?: boolean;
  requiresMustSeeSignal?: boolean;
  relaxedPacing?: boolean;
  localNoLongDrive?: boolean;
  maxStopsPerDay?: number;
  strictDestinationMatch?: boolean;
};

type ScenarioTemplate = {
  id: string;
  style: TripStyle;
  tripLengthDays: number;
  travelerCount: number;
  budgetPerTraveler: number;
  maxDriveHours: number;
  season: string;
  strictBudget?: boolean;
  includeStaycations?: boolean;
  destinationIndex: number;
  prompt: (args: { startCity: StartCity; destination: string; budget: number }) => string;
  expectations: QualityExpectation;
};

type RegionConfig = {
  code: string;
  name: string;
  startCities: StartCity[];
  destinations: string[];
};

type QualityCase = {
  id: string;
  provinceCode: string;
  provinceName: string;
  templateId: string;
  input: TripInput;
  expectedDestination: string;
  expectations: QualityExpectation;
};

type QualityResult = {
  passed: boolean;
  destination?: string;
  totalExpected?: number;
  driveHours?: number;
  notes: string[];
  inspectedSummary?: string;
};

const REGIONS: RegionConfig[] = [
  {
    code: "AB",
    name: "Alberta",
    startCities: ["Calgary", "Edmonton", "Red Deer", "Lethbridge", "Medicine Hat"],
    destinations: [
      "Calgary Staycation",
      "Edmonton Staycation",
      "Red Deer",
      "Medicine Hat",
      "Banff",
      "Canmore",
      "Drumheller",
      "Crowsnest Pass",
      "Waterton Lakes",
      "Elk Island National Park",
      "Nordegg + Abraham Lake",
      "Lac La Biche",
      "Writing-on-Stone",
    ],
  },
  {
    code: "BC",
    name: "British Columbia",
    startCities: ["Vancouver", "Victoria", "Kelowna", "Kamloops", "Nanaimo", "Prince George"],
    destinations: [
      "Vancouver Staycation",
      "Victoria Staycation",
      "Prince George Staycation",
      "Whistler",
      "Vancouver Island",
      "Okanagan / Kelowna",
      "Squamish",
      "Revelstoke",
      "Tofino / Ucluelet",
      "Sunshine Coast",
      "Nelson / Kootenay Lake",
    ],
  },
  {
    code: "MB",
    name: "Manitoba",
    startCities: ["Winnipeg", "Brandon"],
    destinations: [
      "Winnipeg Staycation",
      "Riding Mountain National Park",
      "Gimli / Lake Winnipeg",
      "Whiteshell",
    ],
  },
  {
    code: "NB",
    name: "New Brunswick",
    startCities: ["Moncton", "Fredericton", "Saint John"],
    destinations: ["Hopewell Rocks", "Fundy Coast", "St. Andrews-by-the-Sea"],
  },
  {
    code: "NL",
    name: "Newfoundland and Labrador",
    startCities: ["St. John's", "Corner Brook"],
    destinations: [
      "St. John's Staycation",
      "Gros Morne",
      "Bonavista Peninsula",
      "Twillingate",
      "Terra Nova National Park",
    ],
  },
  {
    code: "NS",
    name: "Nova Scotia",
    startCities: ["Halifax", "Sydney"],
    destinations: [
      "Halifax Staycation",
      "Cabot Trail",
      "Lunenburg / South Shore",
      "Wolfville / Annapolis Valley",
      "Northumberland Shore",
    ],
  },
  {
    code: "NT",
    name: "Northwest Territories",
    startCities: ["Yellowknife"],
    destinations: ["Yellowknife Staycation", "Ingraham Trail / Prelude Lake"],
  },
  {
    code: "NU",
    name: "Nunavut",
    startCities: ["Iqaluit"],
    destinations: ["Iqaluit Staycation", "Sylvia Grinnell / Apex"],
  },
  {
    code: "ON",
    name: "Ontario",
    startCities: ["Toronto", "Ottawa", "Hamilton", "London", "Kitchener"],
    destinations: [
      "Toronto Staycation",
      "Ottawa Staycation",
      "Stratford",
      "Prince Edward County",
      "Niagara-on-the-Lake",
      "Muskoka",
      "Kingston",
      "Stratford",
      "Blue Mountains / Collingwood",
      "Bruce Peninsula / Tobermory",
      "Thousand Islands / Gananoque",
    ],
  },
  {
    code: "PE",
    name: "Prince Edward Island",
    startCities: ["Charlottetown"],
    destinations: ["Charlottetown Staycation", "PEI North Shore / Cavendish"],
  },
  {
    code: "QC",
    name: "Quebec",
    startCities: ["Montreal", "Quebec City", "Laval", "Gatineau", "Sherbrooke"],
    destinations: [
      "Montreal Staycation",
      "Quebec City",
      "Mont-Tremblant",
      "Charlevoix / Baie-Saint-Paul",
      "Eastern Townships",
      "Saguenay / Fjord",
      "Tadoussac",
      "Mauricie National Park",
    ],
  },
  {
    code: "SK",
    name: "Saskatchewan",
    startCities: ["Saskatoon", "Regina", "Prince Albert", "Moose Jaw"],
    destinations: [
      "Saskatoon Staycation",
      "Regina Staycation",
      "Moose Jaw Staycation",
      "Prince Albert National Park",
      "Grasslands National Park",
    ],
  },
  {
    code: "YT",
    name: "Yukon",
    startCities: ["Whitehorse"],
    destinations: ["Whitehorse Staycation", "Kluane", "Dawson City"],
  },
];

const TEMPLATES: ScenarioTemplate[] = [
  {
    id: "food-staycation",
    style: "foodie",
    tripLengthDays: 2,
    travelerCount: 2,
    budgetPerTraveler: 450,
    maxDriveHours: 2.5,
    season: "summer",
    destinationIndex: 0,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 2-day food-forward staycation-style trip from ${startCity} to ${destination} with a total budget around $${budget} CAD. Include good coffee, one memorable dinner, one easy walk or viewpoint, and no long drive. Avoid generic filler stops.`,
    expectations: {
      minFoodStops: 2,
      minActivityStops: 1,
      requiresCoffee: true,
      requiresDinner: true,
      requiresScenic: true,
      relaxedPacing: true,
      localNoLongDrive: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "quiet-reset",
    style: "chill",
    tripLengthDays: 2,
    travelerCount: 2,
    budgetPerTraveler: 425,
    maxDriveHours: 7,
    season: "fall",
    destinationIndex: 1,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a quiet 2-day reset from ${startCity} to ${destination} for two adults with about $${budget} CAD total. Include one scenic walk or viewpoint, good coffee, one low-key dinner, and enough downtime that it does not feel packed.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresCoffee: true,
      requiresDinner: true,
      requiresScenic: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "outdoor-anchor",
    style: "outdoors",
    tripLengthDays: 2,
    travelerCount: 2,
    budgetPerTraveler: 500,
    maxDriveHours: 8.5,
    season: "summer",
    includeStaycations: false,
    destinationIndex: 2,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 2-day outdoors trip from ${startCity} to ${destination} with a total budget around $${budget} CAD. Include one scenic hike, trail, coastal walk, or lake walk as the main activity, one relaxed viewpoint or waterfront stop, simple food, and a practical route.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresScenic: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "must-see",
    style: "must see",
    tripLengthDays: 3,
    travelerCount: 2,
    budgetPerTraveler: 600,
    maxDriveHours: 8.5,
    season: "summer",
    destinationIndex: 3,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 3-day must-see trip from ${startCity} to ${destination} for two adults with about $${budget} CAD total. Include the signature landmark, museum, classic viewpoint, coast, or historic sight, plus one good local dinner. Keep the pacing realistic.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 2,
      requiresDinner: true,
      requiresMustSeeSignal: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "hidden-heritage",
    style: "hidden gems",
    tripLengthDays: 3,
    travelerCount: 2,
    budgetPerTraveler: 525,
    maxDriveHours: 8.5,
    season: "fall",
    destinationIndex: 4,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 3-day hidden-gems trip from ${startCity} to ${destination} with a total budget around $${budget} CAD. Include a local heritage, museum, main-street, lookout, or small-town stop, one independent cafe or coffee stop, and one low-key dinner. Avoid tourist-trap days.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresCoffee: true,
      requiresDinner: true,
      requiresHeritageOrCulture: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "balanced-adventure",
    style: "adventure",
    tripLengthDays: 3,
    travelerCount: 3,
    budgetPerTraveler: 550,
    maxDriveHours: 8.5,
    season: "summer",
    includeStaycations: false,
    destinationIndex: 5,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 3-day balanced adventure from ${startCity} to ${destination} for three adults with about $${budget} CAD total. Make one outdoor anchor the clear main event, keep arrival night easy with dinner, add one lighter scenic stop, and avoid an overpacked itinerary.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 2,
      requiresDinner: true,
      requiresScenic: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "solo-local",
    style: "solo reset",
    tripLengthDays: 2,
    travelerCount: 1,
    budgetPerTraveler: 450,
    maxDriveHours: 2.5,
    season: "summer",
    destinationIndex: 0,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 2-day solo reset from ${startCity} to ${destination} with a budget around $${budget} CAD. Keep it local or no-long-drive, include a river, lake, coast, park, or viewpoint walk, good coffee, and one simple dinner. Do not make it hectic.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresCoffee: true,
      requiresDinner: true,
      requiresScenic: true,
      relaxedPacing: true,
      localNoLongDrive: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "strict-value",
    style: "chill",
    tripLengthDays: 2,
    travelerCount: 2,
    budgetPerTraveler: 350,
    maxDriveHours: 3,
    season: "summer",
    strictBudget: true,
    destinationIndex: 0,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a 2-day value-focused trip from ${startCity} to ${destination} with a hard total budget under $${budget} CAD. Use simple food, one free or low-cost scenic stop, and no expensive resort day. Keep the route easy.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresScenic: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "winter-culture",
    style: "chill",
    tripLengthDays: 2,
    travelerCount: 2,
    budgetPerTraveler: 475,
    maxDriveHours: 8.5,
    season: "fall",
    destinationIndex: 1,
    prompt: ({ startCity, destination, budget }) =>
      `Plan a cozy cool-weather 2-day trip from ${startCity} to ${destination} with a total budget around $${budget} CAD. Include an indoor culture, museum, historic, main-street, cafe, or easy viewpoint stop, one good dinner, and avoid a long exposed hike.`,
    expectations: {
      minFoodStops: 1,
      minActivityStops: 1,
      requiresDinner: true,
      requiresHeritageOrCulture: true,
      relaxedPacing: true,
      strictDestinationMatch: true,
    },
  },
  {
    id: "four-day-unhurried",
    style: "hidden gems",
    tripLengthDays: 4,
    travelerCount: 2,
    budgetPerTraveler: 650,
    maxDriveHours: 8.5,
    season: "fall",
    destinationIndex: 6,
    prompt: ({ startCity, destination, budget }) =>
      `Plan an unhurried 4-day trip from ${startCity} to ${destination} with a total budget around $${budget} CAD. Include good coffee, one memorable dinner, a scenic drive or viewpoint, and a local heritage or nature stop. Avoid extra filler and keep each day practical.`,
    expectations: {
      minFoodStops: 2,
      minActivityStops: 2,
      requiresCoffee: true,
      requiresDinner: true,
      requiresScenic: true,
      relaxedPacing: true,
      maxStopsPerDay: 4,
      strictDestinationMatch: true,
    },
  },
];

function makeInput(options: {
  startCity: StartCity;
  style: TripStyle;
  travelerCount: number;
  budgetPerTraveler: number;
  tripLengthDays: number;
  season: string;
  maxDriveHours: number;
  preferredDestination: string;
  tripPrompt: string;
  strictBudget?: boolean;
  includeStaycations?: boolean;
}): TripInput {
  const tripStartDate = options.season === "winter" ? "2026-02-06" : "2026-07-10";
  const budget = options.travelerCount * options.budgetPerTraveler;

  return {
    startCity: options.startCity,
    maxDriveHours: options.maxDriveHours,
    maxDriveMinutesBetweenStops: 45,
    budget,
    budgetPerTraveler: options.budgetPerTraveler,
    travelerCount: options.travelerCount,
    tripLengthDays: options.tripLengthDays,
    season: options.season,
    style: options.style,
    veganFriendly: false,
    includeStaycations: options.includeStaycations ?? true,
    strictBudget: options.strictBudget ?? false,
    preferredDestination: options.preferredDestination,
    tripPrompt: options.tripPrompt,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, options.tripLengthDays),
  };
}

function buildCases(): QualityCase[] {
  return REGIONS.flatMap((region) =>
    TEMPLATES.map((template, templateIndex) => {
      const startCity = selectStartCity(region, template, templateIndex);
      const destination = selectDestination(region, template, startCity);
      const budget = template.travelerCount * template.budgetPerTraveler;
      const tripPrompt = template.prompt({ startCity, destination, budget });

      return {
        id: `${region.code}-${String(templateIndex + 1).padStart(2, "0")}`,
        provinceCode: region.code,
        provinceName: region.name,
        templateId: template.id,
        expectedDestination: destination,
        expectations: template.expectations,
        input: makeInput({
          startCity,
          style: template.style,
          travelerCount: template.travelerCount,
          budgetPerTraveler: template.budgetPerTraveler,
          tripLengthDays: template.tripLengthDays,
          season: template.season,
          maxDriveHours: template.maxDriveHours,
          preferredDestination: destination,
          tripPrompt,
          strictBudget: template.strictBudget,
          includeStaycations: template.includeStaycations,
        }),
      };
    })
  );
}

function selectStartCity(
  region: RegionConfig,
  template: ScenarioTemplate,
  templateIndex: number
): StartCity {
  const startOverride = getStartCityOverride(region.code, template.id);
  if (startOverride) return startOverride;

  const localTemplate = [
    "food-staycation",
    "solo-local",
    "strict-value",
  ].includes(template.id);

  if (localTemplate) {
    const rotatedStartCity = region.startCities[templateIndex % region.startCities.length];
    if (findLocalDestination(region, rotatedStartCity)) {
      return rotatedStartCity;
    }

    return (
      region.startCities.find((startCity) => findLocalDestination(region, startCity)) ??
      rotatedStartCity
    );
  }

  return region.startCities[0];
}

function getStartCityOverride(regionCode: string, templateId: string): StartCity | undefined {
  if (regionCode === "NL" && templateId === "quiet-reset") return "Corner Brook";
  if (regionCode === "SK" && templateId === "hidden-heritage") return "Regina";
  return undefined;
}

function findLocalDestination(region: RegionConfig, startCity: StartCity) {
  const normalizedStartCity = normalize(startCity);
  return region.destinations.find((destination) => {
    const normalizedDestination = normalize(destination);
    return (
      normalizedDestination === normalizedStartCity ||
      normalizedDestination.includes(normalizedStartCity)
    );
  });
}

function selectDestination(
  region: RegionConfig,
  template: ScenarioTemplate,
  startCity: StartCity
) {
  const availableDestinations =
    template.includeStaycations === false
      ? region.destinations.filter((destination) => !/staycation/i.test(destination))
      : region.destinations;
  const destinationPool =
    availableDestinations.length > 0 ? availableDestinations : region.destinations;
  const localTemplate = [
    "food-staycation",
    "solo-local",
    "strict-value",
  ].includes(template.id);

  if (localTemplate) {
    const localDestination = findLocalDestination(
      { ...region, destinations: destinationPool },
      startCity
    );

    if (localDestination) return localDestination;
  }

  const destinationOverride = getDestinationOverride(region.code, template.id);
  if (destinationOverride) return destinationOverride;

  if (template.id === "winter-culture") {
    return destinationPool[0];
  }

  return destinationPool[template.destinationIndex % destinationPool.length];
}

function getDestinationOverride(regionCode: string, templateId: string): string | undefined {
  if (regionCode === "NL" && templateId === "hidden-heritage") {
    return "Bonavista Peninsula";
  }
  if (regionCode === "NS" && templateId === "hidden-heritage") {
    return "Lunenburg / South Shore";
  }
  return undefined;
}

function normalize(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function allStops(plan: TripPlan): ItineraryStop[] {
  return plan.itineraryDays.flatMap((day) => day.stops);
}

function stopsByKind(plan: TripPlan, kind: ItineraryStop["kind"]) {
  return allStops(plan).filter((stop) => stop.kind === kind);
}

function itineraryText(plan: TripPlan): string {
  return normalize(
    plan.itineraryDays
      .flatMap((day) => [
        day.title,
        day.summary,
        ...day.stops.flatMap((stop) => [
          stop.time,
          stop.title,
          stop.description,
          stop.mapsUrl,
          stop.websiteUrl,
          stop.allTrailsUrl,
        ]),
      ])
      .filter(Boolean)
      .join(" ")
  );
}

function namedStopDuplicates(plan: TripPlan): string[] {
  const names = allStops(plan)
    .filter((stop) => stop.kind === "food" || stop.kind === "activity")
    .map((stop) => normalize(stop.title))
    .filter(Boolean);

  return Array.from(
    new Set(names.filter((name, index) => names.indexOf(name) !== index))
  );
}

function hasDinnerStop(plan: TripPlan): boolean {
  return stopsByKind(plan, "food").some((stop) => {
    const text = normalize([stop.time, stop.title, stop.description].join(" "));
    return containsAny(text, [
      "dinner",
      "evening",
      "restaurant",
      "bistro",
      "kitchen",
      "grill",
      "pub",
      "supper",
    ]);
  });
}

function hasCoffeeStop(plan: TripPlan): boolean {
  return stopsByKind(plan, "food").some((stop) => {
    const text = normalize([stop.time, stop.title, stop.description].join(" "));
    return containsAny(text, [
      "coffee",
      "cafe",
      "espresso",
      "bakery",
      "latte",
      "brunch",
      "breakfast",
      "market",
    ]);
  });
}

function buildInspectionSummary(plan: TripPlan): string {
  return plan.itineraryDays
    .map((day, index) => {
      const stops = day.stops
        .map((stop) => `${stop.time ?? "Flexible"}:${stop.kind ?? "stop"}:${stop.title}`)
        .join(" > ");
      return `D${index + 1} ${day.title ?? "Untitled"} [${stops}]`;
    })
    .join(" || ");
}

function destinationMatches(actual: string | undefined, expected: string): boolean {
  const actualText = normalize(actual);
  const expectedText = normalize(expected);
  if (!actualText || !expectedText) return false;
  if (actualText === expectedText) return true;
  if (actualText.includes(expectedText) || expectedText.includes(actualText)) return true;

  const expectedTokens = expectedText
    .split(" ")
    .filter((token) => token.length >= 4 && token !== "staycation");
  return expectedTokens.length > 0 && expectedTokens.every((token) => actualText.includes(token));
}

function evaluatePlan(testCase: QualityCase): QualityResult {
  const winner = rankDestinations(testCase.input, 1)[0];
  if (!winner) {
    return {
      passed: false,
      notes: ["No destination matched the prompt and hard filters."],
    };
  }

  const plan = buildTripPlan(winner, testCase.input, "static-ranking");
  const notes: string[] = [];
  const text = itineraryText(plan);
  const foodStops = stopsByKind(plan, "food");
  const activityStops = stopsByKind(plan, "activity");
  const stayStops = stopsByKind(plan, "stay");
  const placeholders = [
    "pick a nearby activity",
    "pick a local food stop",
    "keep this activity close",
    "while more destination data loads",
    "generic placeholder",
  ];
  const duplicateStops = namedStopDuplicates(plan);
  const maxStopsPerDay = testCase.expectations.maxStopsPerDay ?? 5;
  const hasNoLongDriveLanguage = /\b(no long drive|local|staycation)\b/i.test(
    testCase.input.tripPrompt ?? ""
  );

  if (testCase.expectations.strictDestinationMatch && !destinationMatches(winner.name, testCase.expectedDestination)) {
    notes.push(
      `Destination mismatch: expected ${testCase.expectedDestination}, got ${winner.name}.`
    );
  }

  if (plan.itineraryDays.length !== testCase.input.tripLengthDays) {
    notes.push(
      `Day count mismatch: expected ${testCase.input.tripLengthDays}, got ${plan.itineraryDays.length}.`
    );
  }

  const emptyDays = plan.itineraryDays
    .filter((day) => day.stops.length === 0)
    .map((day) => day.title ?? "Untitled day");
  if (emptyDays.length > 0) {
    notes.push(`Empty day(s): ${emptyDays.join(", ")}.`);
  }

  const overpackedDays = plan.itineraryDays.filter(
    (day) => day.stops.length > maxStopsPerDay
  );
  if (overpackedDays.length > 0) {
    notes.push(
      `Overpacked day(s): ${overpackedDays
        .map((day) => `${day.title ?? "Untitled"} has ${day.stops.length} stops`)
        .join("; ")}.`
    );
  }

  if (placeholders.some((placeholder) => text.includes(placeholder))) {
    notes.push("Itinerary contains placeholder/fallback wording.");
  }

  if (duplicateStops.length > 0) {
    notes.push(`Repeated named stop(s): ${duplicateStops.join(", ")}.`);
  }

  if (
    typeof plan.driveHoursFromStart === "number" &&
    !plan.isStaycation &&
    plan.driveHoursFromStart > testCase.input.maxDriveHours + 0.25
  ) {
    notes.push(
      `Drive limit miss: ${plan.driveHoursFromStart}h vs ${testCase.input.maxDriveHours}h.`
    );
  }

  if (
    testCase.expectations.localNoLongDrive &&
    typeof plan.driveHoursFromStart === "number" &&
    plan.driveHoursFromStart > 1.25
  ) {
    notes.push(`Expected local/no-long-drive shape, got ${plan.driveHoursFromStart}h.`);
  }

  if (testCase.input.strictBudget && plan.budgetBreakdown.totalExpected > testCase.input.budget) {
    notes.push(
      `Strict budget miss: expected ${plan.budgetBreakdown.totalExpected}, budget ${testCase.input.budget}.`
    );
  } else if (
    !testCase.input.strictBudget &&
    plan.budgetBreakdown.totalExpected > testCase.input.budget * 1.2
  ) {
    notes.push(
      `Budget miss: expected ${plan.budgetBreakdown.totalExpected}, budget ${testCase.input.budget}.`
    );
  }

  if (!Number.isFinite(plan.budgetBreakdown.totalExpected)) {
    notes.push("Budget estimate is not finite.");
  }

  if (foodStops.length < (testCase.expectations.minFoodStops ?? 0)) {
    notes.push(
      `Too few food stops: expected at least ${testCase.expectations.minFoodStops}, got ${foodStops.length}.`
    );
  }

  if (activityStops.length < (testCase.expectations.minActivityStops ?? 0)) {
    notes.push(
      `Too few activity stops: expected at least ${testCase.expectations.minActivityStops}, got ${activityStops.length}.`
    );
  }

  if (testCase.expectations.requiresCoffee && !hasCoffeeStop(plan)) {
    notes.push("Prompt asked for coffee/cafe support, but no coffee-like food stop was visible.");
  }

  if (testCase.expectations.requiresDinner && !hasDinnerStop(plan)) {
    notes.push("Prompt asked for dinner, but no dinner-like food stop was visible.");
  }

  if (
    testCase.expectations.requiresScenic &&
    !containsAny(text, [
      "scenic",
      "view",
      "viewpoint",
      "lookout",
      "overlook",
      "trail",
      "hike",
      "walk",
      "stroll",
      "loop",
      "lake",
      "river",
      "creek",
      "waterfront",
      "shore",
      "coast",
      "beach",
      "park",
      "falls",
      "canyon",
      "mountain",
      "fjord",
      "rocks",
      "tundra",
    ])
  ) {
    notes.push("Prompt asked for a scenic/outdoor stop, but the itinerary lacks a scenic signal.");
  }

  if (
    testCase.expectations.requiresHeritageOrCulture &&
    !containsAny(text, [
      "museum",
      "historic",
      "heritage",
      "culture",
      "cultural",
      "main street",
      "downtown",
      "viewpoint",
      "lookout",
      "boardwalk",
      "harbour",
      "harbor",
      "village",
      "town",
      "waterfront",
      "landmark",
      "market",
      "gallery",
      "interpretive",
      "old town",
      "fort",
    ])
  ) {
    notes.push("Prompt asked for heritage/culture/main-street support, but none was visible.");
  }

  if (
    testCase.expectations.requiresMustSeeSignal &&
    !containsAny(text, [
      "iconic",
      "classic",
      "must see",
      "must-see",
      "landmark",
      "signature",
      "museum",
      "historic",
      "viewpoint",
      "lookout",
      "coast",
      "falls",
      "rocks",
      "gondola",
      "national park",
    ])
  ) {
    notes.push("Prompt asked for a must-see anchor, but no must-see signal was visible.");
  }

  if (
    !hasNoLongDriveLanguage &&
    testCase.input.tripLengthDays >= 2 &&
    !plan.isStaycation &&
    stayStops.length < 1
  ) {
    notes.push("Expected an overnight stay stop for a non-staycation multi-day trip.");
  }

  return {
    passed: notes.length === 0,
    destination: winner.name,
    totalExpected: plan.budgetBreakdown.totalExpected,
    driveHours: plan.driveHoursFromStart,
    notes,
    inspectedSummary: buildInspectionSummary(plan),
  };
}

function main() {
  const cases = buildCases();
  const results = cases.map((testCase) => ({
    testCase,
    result: evaluatePlan(testCase),
  }));
  const passCount = results.filter(({ result }) => result.passed).length;

  console.log(`Ran ${results.length} province/territory trip-quality tests.`);
  console.log(`Pass count: ${passCount}/${results.length}`);
  console.log("");

  for (const { testCase, result } of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      [
        status,
        testCase.id,
        testCase.provinceName,
        testCase.templateId,
        `from=${testCase.input.startCity}`,
        `expected=${testCase.expectedDestination}`,
        `dest=${result.destination ?? "none"}`,
        `days=${testCase.input.tripLengthDays}`,
        `budget=${testCase.input.budget}`,
        `expectedCost=${result.totalExpected ?? "n/a"}`,
      ].join(" | ")
    );

    if (!result.passed) {
      for (const note of result.notes) {
        console.log(`  - ${note}`);
      }
      if (result.inspectedSummary) {
        console.log(`  - inspected: ${result.inspectedSummary}`);
      }
    }
  }

  console.log("");
  for (const region of REGIONS) {
    const regionResults = results.filter(
      ({ testCase }) => testCase.provinceCode === region.code
    );
    const regionPassCount = regionResults.filter(({ result }) => result.passed).length;
    console.log(`${region.name}: ${regionPassCount}/${regionResults.length}`);
  }

  const failed = results.filter(({ result }) => !result.passed);
  if (failed.length > 0) {
    console.log("");
    console.log("Failing cases summary:");
    for (const { testCase, result } of failed) {
      console.log(
        `${testCase.id} ${testCase.provinceName} ${testCase.templateId}: ${result.notes.join(" ")}`
      );
    }
    process.exitCode = 1;
  }
}

main();
