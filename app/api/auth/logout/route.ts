import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
} from "../../../../lib/apiSecurity";
import { clearUserSessionCookie } from "../../../../lib/authSession";

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
    await clearUserSessionCookie();
    return jsonNoStore({ success: true });
  } catch (error) {
    console.error("logout route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
