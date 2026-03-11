import { NextRequest, NextResponse } from "next/server";
import { enrichRankedTrip } from "../../../lib/enrichTrip";
import { RankedDestination, TripInput } from "../../../lib/types";

type Body = {
  trip: RankedDestination;
  input: TripInput;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;

    if (!body?.trip || !body?.input) {
      return NextResponse.json({
        success: false,
        error: "Missing trip or input in request body.",
      });
    }

    const result = await enrichRankedTrip(body.trip, body.input);

    return NextResponse.json({
      success: true,
      trip: result.trip,
      source: result.source,
    });
  } catch (error) {
    console.error("enrich-trip route fatal error:", error);

    return NextResponse.json({
      success: true,
      trip: null,
      source: "static-fallback",
    });
  }
}