import { NextResponse } from "next/server";
import { enforceRateLimit } from "../../../../lib/apiSecurity";

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

    return NextResponse.redirect(
      new URL(`/auth/callback${url.search}`, request.url)
    );
  } catch (error) {
    console.error("google auth callback fatal error:", error);
    return NextResponse.redirect(
      new URL("/?authError=google_callback_failed", request.url)
    );
  }
}
