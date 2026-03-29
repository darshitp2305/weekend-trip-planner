/**
 * Next.js API route for 'api/auth/login'.
 * This handler validates the request, delegates to the relevant planner helpers, and returns the server response shape consumed by the client.
 */

import {
  enforceRateLimit,
  enforceSameOrigin,
  jsonNoStore,
  rejectOversizedJsonRequest,
} from "../../../../lib/apiSecurity";
import { setUserSessionCookieOnResponse } from "../../../../lib/authSession";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function POST(request: Request) {
  const sameOriginViolation = enforceSameOrigin(request);
  if (sameOriginViolation) return sameOriginViolation;

  const rateLimitViolation = enforceRateLimit(request, {
    key: "auth-login",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  const oversizedRequest = rejectOversizedJsonRequest(request, 16_000);
  if (oversizedRequest) return oversizedRequest;

  try {
    const body = await request.json();
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password =
      typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return jsonNoStore(
        { success: false, error: "Email and password are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user?.id || !data.user.email) {
      return jsonNoStore(
        {
          success: false,
          error:
            error?.message === "Email not confirmed"
              ? "Email not confirmed. Either confirm the signup email or disable email confirmation in Supabase."
              : error?.message ?? "Invalid email or password.",
        },
        { status: 401 }
      );
    }

    const response = jsonNoStore({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
    setUserSessionCookieOnResponse(response, data.user.id, data.user.email);
    return response;
  } catch (error) {
    console.error("login route error:", error);
    return jsonNoStore(
      { success: false, error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
