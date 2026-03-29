/**
 * Next.js API route for 'api/auth/logout'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
} from "../../../../lib/apiSecurity";
import { clearUserSessionCookieOnResponse } from "../../../../lib/authSession";

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(request, {
    key: "auth-logout",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  try {
    const response = jsonNoStore({ success: true });
    clearUserSessionCookieOnResponse(response);
    return response;
  } catch (error) {
    console.error("logout route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
