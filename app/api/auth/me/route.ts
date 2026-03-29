/**
 * Next.js API route for 'api/auth/me'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import { enforceRateLimit, jsonNoStore } from "../../../../lib/apiSecurity";
import { getAuthenticatedUserFromRequest } from "../../../../lib/authSession";

export async function GET(request: Request) {
  const rateLimitViolation = enforceRateLimit(request, {
    key: "auth-me",
    limit: 120,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  try {
    const user = await getAuthenticatedUserFromRequest(request);

    return jsonNoStore({
      success: true,
      user: user
        ? {
            id: user.userId,
            email: user.email,
          }
        : null,
    });
  } catch (error) {
    console.error("auth me route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
