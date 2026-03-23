import { NextResponse } from "next/server";
import { enforceRateLimit } from "../../../../lib/apiSecurity";
import { setUserSessionCookieOnResponse } from "../../../../lib/authSession";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function GET(request: Request) {
  const rateLimitViolation = enforceRateLimit(request, {
    key: "auth-google-callback",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitViolation) return rateLimitViolation;

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return NextResponse.redirect(
        new URL("/?authError=missing_auth_code", request.url)
      );
    }

    const { data, error } = await supabaseAuth.auth.exchangeCodeForSession(code);

    if (error || !data?.user?.id || !data.user.email) {
      console.error("google auth callback exchange error:", error);
      return NextResponse.redirect(
        new URL("/?authError=google_callback_failed", request.url)
      );
    }

    const response = NextResponse.redirect(new URL("/", request.url));
    setUserSessionCookieOnResponse(response, data.user.id, data.user.email);
    return response;
  } catch (error) {
    console.error("google auth callback fatal error:", error);
    return NextResponse.redirect(
      new URL("/?authError=google_callback_failed", request.url)
    );
  }
}
