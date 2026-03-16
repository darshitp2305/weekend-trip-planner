import { NextResponse } from "next/server";
import { supabaseAuth } from "../../../../lib/supabaseAuth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = url.origin;
    const callbackUrl = `${origin}/api/auth/callback`;

    const { data, error } = await supabaseAuth.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error || !data?.url) {
      console.error("google auth start error:", error);
      return NextResponse.redirect(
        new URL("/?authError=google_start_failed", request.url)
      );
    }

    return NextResponse.redirect(data.url);
  } catch (error) {
    console.error("google auth start fatal error:", error);
    return NextResponse.redirect(
      new URL("/?authError=google_start_failed", request.url)
    );
  }
}
