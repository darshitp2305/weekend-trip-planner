import { getAuthenticatedUserFromRequest } from "../../../../lib/authSession";
import {
  enforceRateLimit,
  isValidPublicTripId,
  jsonNoStore,
} from "../../../../lib/apiSecurity";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { sanitizeTripForResponse } from "../../../../lib/tripSecurity";
import { TripPlan } from "../../../../lib/types";

type RouteContext = {
  params: Promise<{
    tripId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rateLimitViolation = enforceRateLimit(request, {
    key: "get-trip",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitViolation) {
    return rateLimitViolation;
  }

  try {
    const { tripId } = await context.params;

    if (!tripId || !isValidPublicTripId(tripId)) {
      return jsonNoStore(
        { success: false, error: "Missing or invalid trip id." },
        { status: 400 }
      );
    }

    const authUser = await getAuthenticatedUserFromRequest(request);
    const idsToTry = authUser?.userId
      ? [`user:${authUser.userId}:${tripId}`, tripId]
      : [tripId];

    let foundTrip: TripPlan | null = null;
    let routeError: unknown = null;

    for (const candidateId of idsToTry) {
      const result = await supabaseAdmin
        .from("shared_trips")
        .select("trip_data")
        .eq("id", candidateId)
        .maybeSingle();

      if (result.error) {
        routeError = result.error;
        continue;
      }

      if (result.data?.trip_data && typeof result.data.trip_data === "object") {
        foundTrip = result.data.trip_data as TripPlan;
        routeError = null;
        break;
      }
    }

    if (routeError) {
      console.error("Supabase get-trip error:", routeError);
      return jsonNoStore(
        { success: false, error: "Failed to load trip." },
        { status: 500 }
      );
    }

    if (!foundTrip) {
      return jsonNoStore(
        { success: false, error: "Trip not found." },
        { status: 404 }
      );
    }

    const isOwner = Boolean(
      authUser?.userId &&
        foundTrip.ownerUserId &&
        authUser.userId === foundTrip.ownerUserId
    );

    return jsonNoStore({
      success: true,
      trip: sanitizeTripForResponse(foundTrip, {
        includeEditToken: isOwner,
        includeOwnerFields: isOwner,
      }),
    });
  } catch (error) {
    console.error("get-trip route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
