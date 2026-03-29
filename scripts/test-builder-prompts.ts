import { loadEnvConfig } from "@next/env";
import { applyItineraryPrompt } from "../lib/itineraryPrompt";
import { buildDefaultSelectionState } from "../lib/tripSelections";
import {
  Activity,
  FoodSpot,
  HotelOption,
  ItineraryDayData,
} from "../lib/types";

loadEnvConfig(process.cwd());

type TestResult = {
  id: string;
  passed: boolean;
  details: string;
};

type Fixture = {
  days: ItineraryDayData[];
  hotels: HotelOption[];
  foodSpots: FoodSpot[];
  externalFoodSpots: FoodSpot[];
  activities: Activity[];
  externalActivities: Activity[];
};

function makeFixture(): Fixture {
  const hotels: HotelOption[] = [
    {
      name: "Pyramid Lake Lodge",
      bookingLink: "https://example.com/pyramid",
      shortDescription: "Lakefront stay just outside Jasper town.",
      rating: 4.6,
      latitude: 52.911,
      longitude: -118.104,
    },
    {
      name: "Mountain Mist B&B",
      bookingLink: "https://example.com/mountain-mist",
      shortDescription: "Small Jasper base close to town.",
      rating: 4.8,
      latitude: 52.874,
      longitude: -118.081,
    },
  ];

  const foodSpots: FoodSpot[] = [
    {
      name: "Harvest Food & Drink",
      tags: ["restaurant", "vegetarian-friendly"],
      shortDescription: "Polished dinner spot with broad crowd-pleasing plates.",
      category: "Restaurant",
      priceLevel: "$$$",
      rating: 4.9,
      estimatedCost: 38,
      latitude: 52.912,
      longitude: -118.1032,
    },
    {
      name: "Otto's Cache Provisions + Cafe",
      tags: ["cafe", "vegetarian-friendly"],
      shortDescription: "Popular Jasper cafe with pastries, sandwiches, and picnic-friendly bites.",
      category: "Cafe",
      priceLevel: "$$",
      rating: 4.7,
      estimatedCost: 16,
      latitude: 52.8737,
      longitude: -118.0828,
    },
  ];

  const externalFoodSpots: FoodSpot[] = [
    {
      name: "Andromeda Coffee",
      tags: ["coffee"],
      shortDescription: "Local counter-service cafe near the lodge with quick grab-and-go drinks.",
      category: "Cafe",
      priceLevel: "$",
      rating: 4.5,
      estimatedCost: 12,
      latitude: 52.9098,
      longitude: -118.1012,
    },
    {
      name: "Wild Flour Bakery",
      tags: ["vegetarian-friendly"],
      shortDescription: "Bakery lunch counter with soups, sandwiches, and strong vegetarian options.",
      category: "Bakery",
      priceLevel: "$$",
      rating: 4.6,
      estimatedCost: 18,
      latitude: 52.9015,
      longitude: -118.058,
    },
  ];

  const activities: Activity[] = [
    {
      name: "Maligne Canyon",
      type: "Hiking Area",
      costEstimate: 0,
      rating: 4.8,
      shortDescription: "Easy scenic canyon walk for an arrival afternoon.",
      latitude: 52.886,
      longitude: -118.051,
    },
    {
      name: "Skyline Hiking Trailhead",
      type: "Hiking Area",
      costEstimate: 0,
      rating: 4.9,
      shortDescription: "Main daytime hiking anchor with strong mountain scenery.",
      latitude: 52.907,
      longitude: -118.043,
    },
  ];

  const externalActivities: Activity[] = [
    {
      name: "Patricia Lake Shoreline Walk",
      type: "Scenic Walk",
      costEstimate: 0,
      rating: 4.7,
      shortDescription: "Quiet lakeside walk with easy terrain and mountain reflections.",
      latitude: 52.902,
      longitude: -118.095,
    },
  ];

  const days: ItineraryDayData[] = [
    {
      title: "Day 1 - Arrival and easy first day",
      stops: [
        {
          time: "morning",
          kind: "travel",
          title: "Drive from Edmonton to Jasper",
          description: "Estimated drive: 4 hours.",
        },
        {
          time: "afternoon",
          kind: "stay",
          title: "Check in at Pyramid Lake Lodge",
          description: "Settle in before heading out.",
        },
        {
          time: "late afternoon",
          kind: "activity",
          title: "Maligne Canyon",
          description: "Short arrival-day activity before dinner.",
        },
        {
          time: "evening",
          kind: "food",
          title: "Harvest Food & Drink",
          description: "Vegetarian-friendly dinner stop.",
        },
      ],
    },
    {
      title: "Day 2 - Final half-day and drive back",
      stops: [
        {
          time: "morning",
          kind: "food",
          title: "Otto's Cache Provisions + Cafe",
          description: "Start with a vegetarian-friendly morning stop.",
        },
        {
          time: "late morning",
          kind: "activity",
          title: "Skyline Hiking Trailhead",
          description: "Main daytime anchor.",
        },
        {
          time: "afternoon",
          kind: "travel",
          title: "Drive back to Edmonton",
          description: "Head back without turning the final day into a scramble.",
        },
      ],
    },
  ];

  return {
    days,
    hotels,
    foodSpots,
    externalFoodSpots,
    activities,
    externalActivities,
  };
}

function addedStopsForDay(
  result: ReturnType<typeof applyItineraryPrompt>,
  dayIndex: number
) {
  return result.selection.addedStops?.[`day-${dayIndex}`] ?? [];
}

function firstAddedStop(
  result: ReturnType<typeof applyItineraryPrompt>,
  dayIndex: number
) {
  return addedStopsForDay(result, dayIndex)[0];
}

function customStopForKey(
  result: ReturnType<typeof applyItineraryPrompt>,
  key: string
) {
  return result.selection.customStops?.[key];
}

function buildResult(
  prompt: string,
  overrides?: Partial<Pick<Fixture, "foodSpots" | "externalFoodSpots" | "activities" | "externalActivities">>
) {
  const fixture = makeFixture();

  return applyItineraryPrompt({
    prompt,
    days: fixture.days,
    hotels: fixture.hotels,
    foodSpots: overrides?.foodSpots ?? fixture.foodSpots,
    externalFoodSpots: overrides?.externalFoodSpots ?? fixture.externalFoodSpots,
    activities: overrides?.activities ?? fixture.activities,
    externalActivities: overrides?.externalActivities ?? fixture.externalActivities,
    selection: buildDefaultSelectionState(
      fixture.days,
      fixture.hotels,
      fixture.foodSpots,
      fixture.activities
    ),
    travelerCount: 4,
  });
}

function buildTests(): TestResult[] {
  const tests: TestResult[] = [];

  {
    const result = buildResult("Add a coffee stop before Maligne Canyon in Jasper.");
    const addedStop = firstAddedStop(result, 0);

    tests.push({
      id: "BP01",
      passed:
        result.appliedChanges.length === 1 &&
        result.appliedChanges[0]?.dayIndex === 0 &&
        result.appliedChanges[0]?.source === "catalog" &&
        addedStop?.title === "Andromeda Coffee" &&
        addedStop?.sourceType === "catalog_match" &&
        addedStop?.insertAfterStopIndex === 1,
      details: `issues=${result.issues.join(" | ") || "none"} added=${addedStop?.title ?? "none"} insertAfter=${addedStop?.insertAfterStopIndex ?? "n/a"}`,
    });
  }

  {
    const result = buildResult(
      "Add a vegetarian lunch stop on day 2 before Skyline Hiking Trailhead."
    );
    const addedStop = firstAddedStop(result, 1);

    tests.push({
      id: "BP02",
      passed:
        result.appliedChanges.length === 1 &&
        result.appliedChanges[0]?.source === "catalog" &&
        addedStop?.title === "Wild Flour Bakery" &&
        addedStop?.sourceType === "catalog_match" &&
        addedStop?.insertAfterStopIndex === 0,
      details: `issues=${result.issues.join(" | ") || "none"} added=${addedStop?.title ?? "none"} insertAfter=${addedStop?.insertAfterStopIndex ?? "n/a"}`,
    });
  }

  {
    const result = buildResult("Add a cheap breakfast stop on day 2 near the stay.");
    const addedStop = firstAddedStop(result, 1);

    tests.push({
      id: "BP03",
      passed:
        result.appliedChanges.length === 1 &&
        result.appliedChanges[0]?.source === "catalog" &&
        addedStop?.title === "Andromeda Coffee" &&
        addedStop?.sourceType === "catalog_match" &&
        addedStop?.insertAfterStopIndex === -1,
      details: `issues=${result.issues.join(" | ") || "none"} added=${addedStop?.title ?? "none"} insertAfter=${addedStop?.insertAfterStopIndex ?? "n/a"}`,
    });
  }

  {
    const result = buildResult("Replace Maligne Canyon with a quiet lakeside walk.");
    const customStop = customStopForKey(result, "day-0-stop-2");

    tests.push({
      id: "BP04",
      passed:
        result.appliedChanges.length === 1 &&
        result.appliedChanges[0]?.source === "catalog" &&
        result.appliedChanges[0]?.dayIndex === 0 &&
        customStop?.title === "Patricia Lake Shoreline Walk" &&
        customStop?.sourceType === "catalog_match",
      details: `issues=${result.issues.join(" | ") || "none"} selected=${customStop?.title ?? "none"}`,
    });
  }

  {
    const result = buildResult(
      "Add Otto's Cache Provisions + Cafe on day 2 before Skyline Hiking Trailhead."
    );

    tests.push({
      id: "BP05",
      passed:
        result.appliedChanges.length === 0 &&
        result.issues.some((issue) => /already/i.test(issue)),
      details: `issues=${result.issues.join(" | ") || "none"} changes=${result.appliedChanges.length}`,
    });
  }

  return tests;
}

function main() {
  const results = buildTests();
  const passedCount = results.filter((result) => result.passed).length;

  console.log(`Ran ${results.length} builder-prompt tests.`);
  console.log(`Pass count: ${passedCount}/${results.length}`);
  console.log("");

  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} | ${result.id} | ${result.details}`);
  }

  console.log("");
  const failures = results.filter((result) => !result.passed);
  if (failures.length === 0) {
    console.log("No failing cases.");
    return;
  }

  console.log("Failing cases summary:");
  for (const failure of failures) {
    console.log(`${failure.id}: ${failure.details}`);
  }

  process.exitCode = 1;
}

main();
