import { NextResponse } from "next/server";
import { createUserSessionCookie } from "../../../../lib/authSession";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function GET(request: Request) {
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

    await createUserSessionCookie(data.user.id, data.user.email);

    return NextResponse.redirect(new URL("/", request.url));
  } catch (error) {
    console.error("google auth callback fatal error:", error);
    return NextResponse.redirect(
      new URL("/?authError=google_callback_failed", request.url)
    );
  }
}
