import { NextRequest } from "next/server";
import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import { enrichRankedTrip } from "../../../lib/enrichTrip";
import { RankedDestination, TripInput } from "../../../lib/types";

type Body = {
  trip: RankedDestination;
  input: TripInput;
};

export async function POST(req: NextRequest) {
  const sameOriginViolation = enforceSameOrigin(req);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(req, {
    key: "enrich-trip",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(req, 256_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = (await req.json()) as Body;

    if (!body?.trip || !body?.input) {
      return jsonNoStore(
        {
          success: false,
          error: "Missing trip or input in request body.",
        },
        { status: 400 }
      );
    }

    const result = await enrichRankedTrip(body.trip, body.input);

    return jsonNoStore({
      success: true,
      trip: result.trip,
      source: result.source,
    });
  } catch (error) {
    console.error("enrich-trip route fatal error:", error);

    return jsonNoStore({
      success: true,
      trip: null,
      source: "static-fallback",
    });
  }
}
