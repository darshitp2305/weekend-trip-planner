import { NextResponse } from "next/server";
import { generateRankedTrips } from "../../../lib/generateRankedTrips";
import { TripInput } from "../../../lib/types";

function isTripInput(value: any): value is TripInput {
  return (
    value &&
    typeof value === "object" &&
    (value.startCity === "Edmonton" || value.startCity === "Calgary") &&
    typeof value.maxDriveHours === "number" &&
    typeof value.budget === "number" &&
    typeof value.tripLengthDays === "number" &&
    typeof value.season === "string" &&
    typeof value.style === "string" &&
    typeof value.veganFriendly === "boolean" &&
    typeof value.includeStaycations === "boolean" &&
    typeof value.strictBudget === "boolean"
  );
}

function normalizeInput(raw: any): TripInput | null {
  if (!raw || typeof raw !== "object") return null;

  const candidate = {
    startCity: raw.startCity,
    maxDriveHours: Number(raw.maxDriveHours),
    budget: Number(raw.budget),
    tripLengthDays: Number(raw.tripLengthDays),
    season: raw.season,
    style: raw.style,
    veganFriendly: Boolean(raw.veganFriendly),
    includeStaycations: Boolean(raw.includeStaycations),
    strictBudget: Boolean(raw.strictBudget),
  };

  if (!isTripInput(candidate)) return null;
  return candidate;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = normalizeInput(body?.input ?? body);

    if (!input) {
      return NextResponse.json(
        { error: "Invalid TripInput payload." },
        { status: 400 }
      );
    }

    const pipeline = await generateRankedTrips(input, {
      shortlistSize: 6,
      finalLimit: 3,
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