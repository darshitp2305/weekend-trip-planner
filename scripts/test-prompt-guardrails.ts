import { loadEnvConfig } from "@next/env";
import { applyItineraryPrompt } from "../lib/itineraryPrompt";
import {
  validateBuilderPrompt,
  validateTripPrompt,
} from "../lib/promptValidation";
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
  activities: Activity[];
};

function describeValidation(
  validation:
    | ReturnType<typeof validateTripPrompt>
    | ReturnType<typeof validateBuilderPrompt>,
  successText: string
) {
  if (validation.ok) {
    return successText;
  }

  return (validation as { ok: false; message: string; reason: string }).reason;
}

function makeFixture(): Fixture {
  const hotels: HotelOption[] = [
    {
      name: "Pyramid Lake Lodge",
      bookingLink: "https://example.com/pyramid",
      shortDescription: "Lakefront stay just outside Jasper town.",
      rating: 4.6,
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
    },
    {
      name: "Otto's Cache Provisions + Cafe",
      tags: ["cafe", "vegetarian-friendly"],
      shortDescription: "Popular Jasper cafe with pastries and sandwiches.",
      category: "Cafe",
      priceLevel: "$$",
      rating: 4.7,
      estimatedCost: 16,
    },
  ];

  const activities: Activity[] = [
    {
      name: "Maligne Canyon",
      type: "Hiking Area",
      costEstimate: 0,
      rating: 4.8,
      shortDescription: "Easy scenic canyon walk for an arrival afternoon.",
    },
    {
      name: "Skyline Hiking Trailhead",
      type: "Hiking Area",
      costEstimate: 0,
      rating: 4.9,
      shortDescription: "Main daytime hiking anchor with strong mountain scenery.",
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
          description: "Dinner stop.",
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
          description: "Start with coffee and breakfast.",
        },
        {
          time: "late morning",
          kind: "activity",
          title: "Skyline Hiking Trailhead",
          description: "Main daytime anchor.",
        },
      ],
    },
  ];

  return {
    days,
    hotels,
    foodSpots,
    activities,
  };
}

function buildPromptApplyResult(prompt: string) {
  const fixture = makeFixture();

  return applyItineraryPrompt({
    prompt,
    days: fixture.days,
    hotels: fixture.hotels,
    foodSpots: fixture.foodSpots,
    activities: fixture.activities,
    selection: buildDefaultSelectionState(
      fixture.days,
      fixture.hotels,
      fixture.foodSpots,
      fixture.activities
    ),
    travelerCount: 2,
  });
}

function buildTests(): TestResult[] {
  const tests: TestResult[] = [];

  {
    const validation = validateTripPrompt("asdf qwrty zxcvb asdf");

    tests.push({
      id: "PG01",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateTripPrompt("😂😂😂 weekend ??? idk lol");

    tests.push({
      id: "PG02",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateTripPrompt(
      "Plan whatever, surprise me, maybe something nice I guess."
    );

    tests.push({
      id: "PG03",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateTripPrompt(
      "Plan a weekend trip to Vancouver for two with sushi and a seawall walk."
    );

    tests.push({
      id: "PG04",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateTripPrompt(
      "Plan a Jasper weekend from Edmonton for 2 people with one scenic hike and good coffee."
    );

    tests.push({
      id: "PG05",
      passed: validation.ok,
      details: describeValidation(validation, "accepted"),
    });
  }

  {
    const validation = validateBuilderPrompt("make it better");

    tests.push({
      id: "PG06",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateBuilderPrompt(
      "lol just do something cool for the vibe"
    );

    tests.push({
      id: "PG07",
      passed: !validation.ok,
      details: describeValidation(validation, "unexpectedly accepted"),
    });
  }

  {
    const validation = validateBuilderPrompt(
      "Add a coffee stop on day 2 before we leave."
    );

    tests.push({
      id: "PG08",
      passed: validation.ok,
      details: describeValidation(validation, "accepted"),
    });
  }

  {
    const result = buildPromptApplyResult("make it better");

    tests.push({
      id: "PG09",
      passed: result.appliedChanges.length === 0 && result.issues.length > 0,
      details: `changes=${result.appliedChanges.length} issues=${result.issues.length}`,
    });
  }

  {
    const result = buildPromptApplyResult(
      "just vibes lol maybe some stuff and whatever"
    );

    tests.push({
      id: "PG10",
      passed: result.appliedChanges.length === 0 && result.issues.length > 0,
      details: `changes=${result.appliedChanges.length} issues=${result.issues.length}`,
    });
  }

  return tests;
}

function main() {
  const results = buildTests();
  const passedCount = results.filter((result) => result.passed).length;

  console.log(`Ran ${results.length} prompt-guardrail tests.`);
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
