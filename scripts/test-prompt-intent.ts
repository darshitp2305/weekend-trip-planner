import { loadEnvConfig } from "@next/env";
import { mergePromptParametersIntoTripInput } from "../lib/openAiPromptParameters";
import {
  deriveTripIntentFromPrompt,
  extractPromptBudget,
  extractPromptDepartureTime,
  extractPromptStartCity,
  extractPromptTravelerCount,
} from "../lib/tripIntent";
import { TripInput } from "../lib/types";

loadEnvConfig(process.cwd());

type TestResult = {
  id: string;
  passed: boolean;
  details: string;
};

function makeInput(overrides?: Partial<TripInput>): TripInput {
  return {
    startCity: "Edmonton",
    maxDriveHours: 5,
    maxDriveMinutesBetweenStops: 45,
    budget: 600,
    budgetPerTraveler: 300,
    travelerCount: 2,
    tripLengthDays: 2,
    season: "spring",
    style: "adventure",
    tripPrompt: "We want a quick Banff overnight for 2 people.",
    veganFriendly: false,
    includeStaycations: true,
    strictBudget: false,
    tripStartDate: "2026-03-29",
    tripEndDate: "2026-03-30",
    ...overrides,
  };
}

function buildTests(): TestResult[] {
  const tests: TestResult[] = [];

  {
    const prompt =
      "We want a quick Banff overnight for 2 people starting today, and we're leaving Edmonton at 4pm. Keep day 1 realistic based on when we'll reach the hotel.";
    const departureTime = extractPromptDepartureTime(prompt);
    const intent = deriveTripIntentFromPrompt(prompt);

    tests.push({
      id: "PI01",
      passed:
        departureTime === "16:00" &&
        intent.preferredDestination === "Banff" &&
        intent.suggestedTravelerCount === 2,
      details: `departure=${departureTime ?? "none"} destination=${intent.preferredDestination ?? "none"} travelers=${intent.suggestedTravelerCount ?? "none"}`,
    });
  }

  {
    const prompt = "We can't leave until 6:30 pm tonight, so keep the first day very light.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI02",
      passed: departureTime === "18:30",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt = "Earliest we can head out is about 3pm tomorrow.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI03",
      passed: departureTime === "15:00",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt = "We won't be able to drive out before 7:15 am, so don't plan much on arrival day.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI04",
      passed: departureTime === "07:15",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt = "We're leaving after work and just want dinner on the first night.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI05",
      passed: departureTime === "17:30",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt = "Let's go first thing in the morning and keep it simple.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI06",
      passed: departureTime === "08:00",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt =
      "We're 3 people in Calgary and want a Banff or Canmore overnight starting today.";
    const startCity = extractPromptStartCity(prompt);

    tests.push({
      id: "PI06B",
      passed: startCity === "Calgary",
      details: `startCity=${startCity ?? "none"}`,
    });
  }

  {
    const prompt = "We can't head out until 6pm and only want check-in plus dinner.";
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI07",
      passed: departureTime === "18:00",
      details: `departure=${departureTime ?? "none"}`,
    });
  }

  {
    const prompt = "We want Banff, and our total budget is around $600 for 2 people.";
    const budget = extractPromptBudget(prompt);
    const travelerCount = extractPromptTravelerCount(prompt);
    const intent = deriveTripIntentFromPrompt(prompt);

    tests.push({
      id: "PI08",
      passed:
        budget?.amount === 600 &&
        budget.scope === "group_total" &&
        budget.approximate &&
        travelerCount === 2 &&
        intent.preferredDestination === "Banff",
      details: `budget=${budget?.amount ?? "none"} scope=${budget?.scope ?? "none"} approx=${budget?.approximate ?? "none"} travelers=${travelerCount ?? "none"} destination=${intent.preferredDestination ?? "none"}`,
    });
  }

  {
    const prompt = "Budget is $250 each for 3 people and we want Jasper.";
    const budget = extractPromptBudget(prompt);
    const travelerCount = extractPromptTravelerCount(prompt);
    const intent = deriveTripIntentFromPrompt(prompt);

    tests.push({
      id: "PI09",
      passed:
        budget?.amount === 250 &&
        budget.scope === "per_traveler" &&
        budget.approximate === false &&
        travelerCount === 3 &&
        intent.preferredDestination === "Jasper",
      details: `budget=${budget?.amount ?? "none"} scope=${budget?.scope ?? "none"} approx=${budget?.approximate ?? "none"} travelers=${travelerCount ?? "none"} destination=${intent.preferredDestination ?? "none"}`,
    });
  }

  {
    const prompt =
      "We want a quick Banff overnight for 2 people, but not until 4:45 pm because of work.";
    const departureTime = extractPromptDepartureTime(prompt);
    const intent = deriveTripIntentFromPrompt(prompt);

    tests.push({
      id: "PI10",
      passed:
        departureTime === "16:45" &&
        intent.preferredDestination === "Banff" &&
        intent.suggestedTravelerCount === 2,
      details: `departure=${departureTime ?? "none"} destination=${intent.preferredDestination ?? "none"} travelers=${intent.suggestedTravelerCount ?? "none"}`,
    });
  }

  {
    const prompt =
      "We're 3 people in Calgary and want a Banff or Canmore overnight starting today, but we can't head out until after work, around 5:45pm. Keep the first night to check-in and a late casual dinner only, no hike on arrival day. Budget is about $220 each, we want cozy more than intense, but still want one scenic stop the next morning before driving back. Don't make us drive more than about 6 hours total for the trip.";
    const intent = deriveTripIntentFromPrompt(prompt);
    const startCity = extractPromptStartCity(prompt);
    const departureTime = extractPromptDepartureTime(prompt);

    tests.push({
      id: "PI10B",
      passed:
        startCity === "Calgary" &&
        departureTime === "17:45" &&
        intent.style === "chill" &&
        intent.activityFocus === undefined &&
        intent.preferredDestination === "Canmore" &&
        intent.suggestedTravelerCount === 3 &&
        intent.suggestedBudgetPerTraveler === 220,
      details: `startCity=${startCity ?? "none"} departure=${departureTime ?? "none"} style=${intent.style} activity=${intent.activityFocus ?? "none"} destination=${intent.preferredDestination ?? "none"} travelers=${intent.suggestedTravelerCount ?? "none"} budgetEach=${intent.suggestedBudgetPerTraveler ?? "none"}`,
    });
  }

  {
    const prompt =
      "We're 2 people in Calgary and want a Banff overnight with one scenic hike as the main activity. Make Johnston Canyon the signature hike, keep the rest of the trip easy, and suggest a cozy trip with minimal planning friction.";
    const intent = deriveTripIntentFromPrompt(prompt);

    tests.push({
      id: "PI10C",
      passed:
        intent.preferredDestination === "Banff" &&
        intent.requestedActivityName === "Johnston Canyon to Upper Falls" &&
        intent.style === "chill",
      details: `destination=${intent.preferredDestination ?? "none"} requestedActivity=${intent.requestedActivityName ?? "none"} style=${intent.style}`,
    });
  }

  {
    const merged = mergePromptParametersIntoTripInput(
      makeInput({
        tripPrompt:
          "We're leaving Calgary at 4pm for a Canmore overnight for 3 people with about $220 each and we don't mind a 6 hour drive.",
      }),
      {
        startCity: "Calgary",
        travelerCount: 3,
        budgetPerTraveler: 220,
        maxDriveHours: 6,
        preferredDestination: "Canmore",
        departureTime: "16:00",
        style: "adventure",
      }
    );

    tests.push({
      id: "PI11",
      passed:
        merged.startCity === "Calgary" &&
        merged.travelerCount === 3 &&
        merged.budgetPerTraveler === 220 &&
        merged.budget === 660 &&
        merged.maxDriveHours === 6 &&
        merged.preferredDestination === "Canmore" &&
        merged.departureTime === "16:00",
      details: `start=${merged.startCity} travelers=${merged.travelerCount} budgetEach=${merged.budgetPerTraveler} budget=${merged.budget} drive=${merged.maxDriveHours} destination=${merged.preferredDestination ?? "none"} departure=${merged.departureTime ?? "none"}`,
    });
  }

  {
    const merged = mergePromptParametersIntoTripInput(
      makeInput({
        budgetPerTraveler: 450,
        budget: 900,
        maxDriveHours: 3,
        tripPrompt:
          "Budget is $300 each for 2 people and we want Banff, but keep the drive short.",
      }),
      {
        budgetPerTraveler: 300,
        maxDriveHours: 5,
        preferredDestination: "Banff",
      }
    );

    tests.push({
      id: "PI12",
      passed:
        merged.budgetPerTraveler === 450 &&
        merged.budget === 900 &&
        merged.maxDriveHours === 3 &&
        merged.preferredDestination === "Banff",
      details: `budgetEach=${merged.budgetPerTraveler} budget=${merged.budget} drive=${merged.maxDriveHours} destination=${merged.preferredDestination ?? "none"}`,
    });
  }

  {
    const merged = mergePromptParametersIntoTripInput(
      makeInput({
        startCity: "Red Deer",
        tripPrompt: "We're leaving Edmonton at 4pm for Banff.",
      }),
      {
        startCity: "Edmonton",
        departureTime: "16:00",
      }
    );

    tests.push({
      id: "PI13",
      passed:
        merged.startCity === "Red Deer" &&
        merged.departureTime === "16:00",
      details: `start=${merged.startCity} departure=${merged.departureTime ?? "none"}`,
    });
  }

  return tests;
}

function main() {
  const results = buildTests();
  const passedCount = results.filter((result) => result.passed).length;

  console.log(`Ran ${results.length} prompt-intent tests.`);
  console.log(`Pass count: ${passedCount}/${results.length}`);
  console.log("");

  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} | ${result.id} | ${result.details}`
    );
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
