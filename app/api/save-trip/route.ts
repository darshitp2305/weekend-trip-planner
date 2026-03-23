import { timingSafeEqual } from "crypto";
import {
  enforceRateLimit,
  enforceSameOrigin,
  isValidPublicTripId,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import { getAuthenticatedUserFromRequest } from "../../../lib/authSession";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import {
  ensureTripEditToken,
  sanitizeTripForPersistence,
  sanitizeTripForResponse,
} from "../../../lib/tripSecurity";
import { TripPlan } from "../../../lib/types";

type SaveTripBody = {
  plan?: TripPlan;
};

function hasMatchingEditToken(received?: string, expected?: string) {
  if (!received || !expected) return false;

  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) {
    return sameOriginViolation;
  }

  const rateLimitViolation = enforceRateLimit(request, {
    key: "save-trip",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitViolation) {
    return rateLimitViolation;
  }

  const oversizedRequest = rejectOversizedJsonRequest(request, 512_000);
  if (oversizedRequest) {
    return oversizedRequest;
  }

  try {
    const body = (await request.json().catch(() => null)) as SaveTripBody | null;
    const rawPlan =
      body?.plan && typeof body.plan === "object" ? body.plan : null;
    const authUser = await getAuthenticatedUserFromRequest(request);

    if (!rawPlan?.id || !isValidPublicTripId(rawPlan.id)) {
      return jsonNoStore(
        { success: false, error: "Missing or invalid trip id." },
        { status: 400 }
      );
    }

    const { data: existingRecord, error: existingError } = await supabaseAdmin
      .from("shared_trips")
      .select("trip_data")
      .eq("id", rawPlan.id)
      .maybeSingle();

    if (existingError) {
      console.error("Supabase save-trip lookup error:", existingError);
      return jsonNoStore(
        { success: false, error: "Failed to validate trip ownership." },
        { status: 500 }
      );
    }

    const existingPlan =
      existingRecord?.trip_data && typeof existingRecord.trip_data === "object"
        ? (existingRecord.trip_data as TripPlan)
        : null;

    const isAuthenticatedOwner = Boolean(
      authUser?.userId &&
        existingPlan?.ownerUserId &&
        authUser.userId === existingPlan.ownerUserId
    );
    const editTokenMatches = hasMatchingEditToken(
      rawPlan.editToken,
      existingPlan?.editToken
    );

    if (existingPlan) {
      if (existingPlan.ownerUserId && !isAuthenticatedOwner) {
        return jsonNoStore(
          { success: false, error: "You do not have permission to edit this trip." },
          { status: 403 }
        );
      }

      if (existingPlan.editToken && !editTokenMatches && !isAuthenticatedOwner) {
        return jsonNoStore(
          { success: false, error: "You do not have permission to edit this trip." },
          { status: 403 }
        );
      }

      if (
        !existingPlan.ownerUserId &&
        !existingPlan.editToken &&
        !authUser?.userId
      ) {
        return jsonNoStore(
          {
            success: false,
            error:
              "This older shared trip can no longer be edited anonymously. Sign in and resave it to claim ownership.",
          },
          { status: 403 }
        );
      }
    }

    const planWithToken = ensureTripEditToken({
      ...rawPlan,
      editToken: existingPlan?.editToken ?? rawPlan.editToken,
    } as TripPlan);

    const sharedTripPlan = sanitizeTripForPersistence({
      ...planWithToken,
      ownerUserId: authUser?.userId ?? existingPlan?.ownerUserId,
      ownerEmail: authUser?.email ?? existingPlan?.ownerEmail,
    });

    const sharedTripRecord = {
      id: sharedTripPlan.id,
      trip_data: sharedTripPlan,
    };

    const records = [sharedTripRecord];

    if (authUser?.userId) {
      records.push({
        id: `user:${authUser.userId}:${sharedTripPlan.id}`,
        trip_data: {
          ...sharedTripPlan,
          ownerUserId: authUser.userId,
          ownerEmail: authUser.email,
        },
      });
    }

    const { error } = await supabaseAdmin.from("shared_trips").upsert(records, {
      onConflict: "id",
    });

    if (error) {
      console.error("Supabase save-trip error:", error);
      return jsonNoStore(
        { success: false, error: "Failed to save trip." },
        { status: 500 }
      );
    }

    const responseTrip = sanitizeTripForResponse(sharedTripPlan, {
      includeEditToken: true,
      includeOwnerFields: Boolean(authUser?.userId),
    });

    return jsonNoStore({
      success: true,
      id: sharedTripPlan.id,
      shareUrl: `/trip/${sharedTripPlan.id}`,
      accountSaved: Boolean(authUser?.userId),
      trip: responseTrip,
    });
  } catch (error) {
    console.error("save-trip route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
