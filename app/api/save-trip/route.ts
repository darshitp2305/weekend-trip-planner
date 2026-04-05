/**
 * Next.js API route for 'api/save-trip'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

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
  mergeCollaborativeTripFields,
  sanitizeTripForPersistence,
  sanitizeTripForResponse,
} from "../../../lib/tripSecurity";
import {
  TripPlanInvariantStage,
  validateTripPlanInvariants,
} from "../../../lib/tripInvariants";
import { TripPlan } from "../../../lib/types";

type SaveTripBody = {
  plan?: TripPlan;
  stage?: TripPlanInvariantStage;
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
    const canClaimAnonymousTrip = Boolean(
      existingPlan &&
        !existingPlan.ownerUserId &&
        !existingPlan.editToken &&
        authUser?.userId
    );
    const hasFullEditAccess = Boolean(
      !existingPlan ||
        isAuthenticatedOwner ||
        editTokenMatches ||
        canClaimAnonymousTrip
    );
    const canPersistCollaborativeShareUpdate = Boolean(
      existingPlan?.status === "finalized" && !hasFullEditAccess
    );

    if (existingPlan) {
      if (!hasFullEditAccess && !canPersistCollaborativeShareUpdate) {
        return jsonNoStore(
          {
            success: false,
            error: existingPlan.ownerUserId || existingPlan.editToken
              ? "You do not have permission to edit this trip."
              : "This older shared trip can no longer be edited anonymously. Sign in and resave it to claim ownership.",
          },
          { status: 403 }
        );
      }
    }

    const planWithAccess = hasFullEditAccess
      ? ensureTripEditToken({
          ...rawPlan,
          editToken: existingPlan?.editToken ?? rawPlan.editToken,
        } as TripPlan)
      : mergeCollaborativeTripFields(existingPlan as TripPlan, rawPlan);

    const inferredStage: TripPlanInvariantStage =
      planWithAccess.status === "finalized" &&
      existingPlan?.status !== "finalized"
        ? "finalize"
        : "save";
    const requestedStage = body?.stage === "finalize" ? "finalize" : "save";
    const validationStage: TripPlanInvariantStage =
      inferredStage === "finalize" || requestedStage === "finalize"
        ? "finalize"
        : "save";
    const invariantResult = validateTripPlanInvariants(planWithAccess, {
      stage: validationStage,
    });

    if (!invariantResult.ok) {
      return jsonNoStore(
        {
          success: false,
          error: invariantResult.message ?? "Trip validation failed.",
          issues: invariantResult.issues,
        },
        { status: 400 }
      );
    }

    const sharedTripPlan = sanitizeTripForPersistence({
      ...planWithAccess,
      ownerUserId: hasFullEditAccess
        ? authUser?.userId ?? existingPlan?.ownerUserId
        : existingPlan?.ownerUserId,
      ownerEmail: hasFullEditAccess
        ? authUser?.email ?? existingPlan?.ownerEmail
        : existingPlan?.ownerEmail,
    });

    const sharedTripRecord = {
      id: sharedTripPlan.id,
      trip_data: sharedTripPlan,
    };

    const records = [sharedTripRecord];

    const shouldCreateAccountRecord = Boolean(authUser?.userId && hasFullEditAccess);

    if (shouldCreateAccountRecord && authUser?.userId) {
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
      includeEditToken: hasFullEditAccess,
      includeOwnerFields: Boolean(
        authUser?.userId && sharedTripPlan.ownerUserId === authUser.userId
      ),
    });

    return jsonNoStore({
      success: true,
      id: sharedTripPlan.id,
      shareUrl: `/trip/${sharedTripPlan.id}`,
      accountSaved: shouldCreateAccountRecord,
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
