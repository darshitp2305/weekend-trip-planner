/**
 * Next.js API route for 'api/account/analytics'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import { enforceRateLimit, jsonNoStore } from "../../../../lib/apiSecurity";
import { getAuthenticatedUserFromRequest } from "../../../../lib/authSession";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET(request: Request) {
  const rateLimitViolation = enforceRateLimit(request, {
    key: "account-analytics-get",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  try {
    const authUser = await getAuthenticatedUserFromRequest(request);

    if (!authUser?.userId) {
      return jsonNoStore(
        { success: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const prefix = `analytics:${authUser.userId}:`;

    const { data, error } = await supabaseAdmin
      .from("shared_trips")
      .select("trip_data")
      .like("id", `${prefix}%`)
      .order("id", { ascending: false });

    if (error) {
      console.error("account analytics route error:", error);
      return jsonNoStore(
        { success: false, error: "Failed to load account analytics." },
        { status: 500 }
      );
    }

    const events = (data ?? [])
      .map((row) => row.trip_data)
      .sort((a, b) => `${b?.at ?? ""}`.localeCompare(`${a?.at ?? ""}`));

    return jsonNoStore({
      success: true,
      events,
    });
  } catch (error) {
    console.error("account analytics route fatal error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
