import { NextResponse } from "next/server";
import { deriveTripEndDate, isIsoDate } from "../../../lib/tripDates";
import { generateRankedTrips } from "../../../lib/generateRankedTrips";
import { TripInput } from "../../../lib/types";

function isTripInput(value: any): value is TripInput {
  return (
    value &&
    typeof value === "object" &&
    (value.startCity === "Edmonton" || value.startCity === "Calgary") &&
    typeof value.maxDriveHours === "number" &&
    typeof value.budget === "number" &&
    typeof value.budgetPerTraveler === "number" &&
    typeof value.travelerCount === "number" &&
    typeof value.tripLengthDays === "number" &&
    typeof value.season === "string" &&
    typeof value.style === "string" &&
    typeof value.veganFriendly === "boolean" &&
    typeof value.includeStaycations === "boolean" &&
    typeof value.strictBudget === "boolean" &&
    (value.preferredDestination === undefined ||
      typeof value.preferredDestination === "string") &&
    (value.tripStartDate === undefined || typeof value.tripStartDate === "string") &&
    (value.tripEndDate === undefined || typeof value.tripEndDate === "string")
  );
}

function normalizeInput(raw: any): TripInput | null {
  if (!raw || typeof raw !== "object") return null;

  const travelerCount = Number(raw.travelerCount);
  const budgetPerTraveler = Number(raw.budgetPerTraveler);
  const tripStartDate = isIsoDate(raw.tripStartDate) ? raw.tripStartDate : undefined;
  const tripLengthDays = Number(raw.tripLengthDays);

  const candidate = {
    startCity: raw.startCity,
    maxDriveHours: Number(raw.maxDriveHours),
    budget: travelerCount * budgetPerTraveler,
    budgetPerTraveler,
    travelerCount,
    tripLengthDays,
    season: raw.season,
    style: raw.style,
    veganFriendly: Boolean(raw.veganFriendly),
    includeStaycations: Boolean(raw.includeStaycations),
    strictBudget: Boolean(raw.strictBudget),
    preferredDestination:
      typeof raw.preferredDestination === "string"
        ? raw.preferredDestination.trim() || undefined
        : undefined,
    tripStartDate,
    tripEndDate: deriveTripEndDate(tripStartDate, tripLengthDays),
  };

  if (!isTripInput(candidate)) return null;
  return candidate;
}

function normalizeExcludedDestinationNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = normalizeInput(body?.input ?? body);
    const excludedDestinationNames = normalizeExcludedDestinationNames(
      body?.excludedDestinationNames
    );

    if (!input) {
      return NextResponse.json(
        { error: "Invalid TripInput payload." },
        { status: 400 }
      );
    }

    const pipeline = await generateRankedTrips(input, {
      shortlistSize: input.preferredDestination ? 3 : 6,
      finalLimit: input.preferredDestination ? 1 : 3,
      excludedDestinationNames,
    });

    return NextResponse.json({
      success: true,
      initialCandidates: pipeline.initialCandidates,
      results: pipeline.finalTrips,
      usedLiveData: pipeline.usedLiveData,
    });
  } catch (error) {
    console.error("rank-trips route failed:", error);

    return NextResponse.json(
      { error: "Failed to rank trips." },
      { status: 500 }
    );
  }
}
