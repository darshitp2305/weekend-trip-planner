import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../lib/apiSecurity";
import { getAuthenticatedUserFromRequest } from "../../../lib/authSession";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(request, {
    key: "analytics-post",
    limit: 80,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(request, 32_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = await request.json();
    const authUser = await getAuthenticatedUserFromRequest(request);

    if (!body || typeof body.name !== "string") {
      return jsonNoStore(
        { success: false, error: "Missing analytics event name." },
        { status: 400 }
      );
    }

    console.info("[product-analytics]", {
      id: body.id,
      name: body.name,
      at: body.at,
      tripId: body.tripId,
      destinationName: body.destinationName,
      status: body.status,
      decisionStatus: body.decisionStatus,
      dataSource: body.dataSource,
      ownerUserId: body.ownerUserId,
      metadata: body.metadata,
    });

    if (authUser?.userId && typeof body.id === "string" && body.id.trim()) {
      const recordId = `analytics:${authUser.userId}:${body.id.trim()}`;
      const { error } = await supabaseAdmin.from("shared_trips").upsert(
        [
          {
            id: recordId,
            trip_data: {
              ...body,
              ownerUserId: authUser.userId,
              ownerEmail: authUser.email,
            },
          },
        ],
        { onConflict: "id" }
      );

      if (error) {
        console.error("analytics route save error:", error);
      }
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    console.error("analytics route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
